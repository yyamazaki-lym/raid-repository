import "server-only";
import {
  createClient,
  createSupabaseServiceRoleClient,
} from "@/lib/supabase/server";
import { getValidFflogsOAuthToken } from "./fflogs-oauth";
import { getSecretValue } from "./secret-store";
import { buildFflogsScrapeHeaders } from "./fflogs-scrape-request";
import { parseFflogsReportCode } from "@/lib/fflogs-url";
import { jstYmdString } from "@/lib/jst-date";
import { findContentGroups } from "@/lib/content-groups";
import {
  PERMISSION_ERROR_RE,
  PRIVATE_REPORT_REASON,
} from "@/lib/fflogs-sync-reason";

/**
 * FFLogs の pull 単位データ (fights) を portal に materialize する
 * (TODO #94 / A-1 + A-2)。
 *
 * **狙い**: FFLogs には pull 単位で全部入っているのに、portal 側は report
 * URL を動画に紐づけて終わっていた (調査ノート §2 空白 01)。
 * `reportData.report.fights` を取り込んでおけば
 *   - 到達フェーズ / 残 HP% / pull 数の推移 (A-1)
 *   - 日付 → pull 一覧 → 該当 fight / 動画時刻へのジャンプ (A-2)
 * が portal 内で完結する。
 *
 * **マッチングは新規に作らない**。report ↔ カテゴリ / 日付の対応は既存資産
 * だけを使う:
 *   1. `category_links.logs_url` (kind='video')      → category_id
 *   2. `categories.expected_fflogs_zone_ids`         → category_id (1 件に定まる時のみ)
 *   3. レポートの zone 名 / タイトルを `CONTENT_GROUPS` で分類し、カテゴリ名
 *      (+ `fflogs_match_keywords`) と同じグループなら紐づけ。動画リンクも
 *      zone ID も無い固定でログが 1 つも出ない、という取りこぼしを防ぐ。
 *      これは FFLogs 自動リンク (`fflogs.ts`) が既に使っている分類器の再利用で、
 *      新しいマッチングロジックではない
 *   4. `schedule_past_session_logs` / `native_schedule_session_logs` → session_date
 *
 * **個人 DPS は取得しない**。クエリは fight のメタ情報だけで、
 * ランキングや個人成績は 1 度も触らない (調査ノート §1-F の設計原則:
 * 個人の火力を序列化して表示しない)。
 */

// v2 の user エンドポイント。OAuth トークンで自分の Private / Unlisted
// レポートにも到達できる (`fflogs.ts` と同じ宛先)。
const FFLOGS_GRAPHQL_URL = "https://www.fflogs.com/api/v2/user";

/** 1 回の同期で取りに行く report 数の上限 (実行時間を bound するため)。 */
const DEFAULT_REPORT_LIMIT = 40;
/** これより新しいセッションの report は「まだ増える」とみなして再取得する。 */
const REFRESH_WINDOW_DAYS = 14;
const FETCH_TIMEOUT_MS = 20_000;
/** 同期全体の時間予算 (cron の maxDuration=300s に対する余裕込み)。 */
const TIME_BUDGET_MS = 120_000;

export type FflogsFightsSyncResult =
  | {
      ok: true;
      reportsKnown: number;
      reportsFetched: number;
      fightsUpserted: number;
      failed: number;
      truncated: boolean;
      /** 保存済み zone 名から後追いでカテゴリが決まった report 数。 */
      reattributed: number;
    }
  | { ok: false; reason: string };

type ReportRef = {
  code: string;
  categoryId: string | null;
  sessionDate: string | null;
};

type FightPayload = {
  id: number;
  name?: string | null;
  kill?: boolean | null;
  difficulty?: number | null;
  encounterID?: number | null;
  fightPercentage?: number | null;
  lastPhase?: number | null;
  startTime: number;
  endTime: number;
};

export async function syncFflogsFights(opts?: {
  useServiceRole?: boolean;
  limit?: number;
  /**
   * true で恒久失敗 (private レポート等) も再試行する。session cookie を
   * 登録し直した後に admin が手動同期で使う想定。cron (毎日) では false —
   * 結果の変わらない失敗が 40 件の取得枠を毎晩食い潰すのを防ぐ。
   */
  retryPermanentFailures?: boolean;
}): Promise<FflogsFightsSyncResult> {
  const token = await getValidFflogsOAuthToken();
  if (!token) {
    return {
      ok: false,
      reason:
        "FFLogs OAuth が未接続です — 設定ダイアログから接続すると pull 単位のログを取り込めます",
    };
  }

  const db = opts?.useServiceRole
    ? createSupabaseServiceRoleClient()
    : await createClient();
  const deadlineAtMs = Date.now() + TIME_BUDGET_MS;

  const [refs, categories, sessionCookie] = await Promise.all([
    collectReportRefs(db),
    loadCategories(db),
    // private レポートの fallback 用 (fflogs.ts の scrape と同じ保管場所)。
    getSecretValue("fflogs_session_cookie").catch(() => null),
  ]);
  if (refs.size === 0) {
    return {
      ok: true,
      reportsKnown: 0,
      reportsFetched: 0,
      fightsUpserted: 0,
      failed: 0,
      truncated: false,
      reattributed: 0,
    };
  }

  // 既存の同期台帳を読み、再取得が要るものだけに絞る。
  const { data: ledger } = await db
    .from("fflogs_report_syncs")
    .select("report_code, ok, synced_at, session_date, category_id, zone_name, reason");
  const ledgerMap = new Map<
    string,
    {
      ok: boolean;
      syncedAt: string | null;
      sessionDate: string | null;
      categoryId: string | null;
      zoneName: string | null;
      reason: string | null;
    }
  >();
  for (const row of ledger ?? []) {
    ledgerMap.set(row.report_code as string, {
      ok: (row.ok as boolean) ?? false,
      syncedAt: (row.synced_at as string | null) ?? null,
      sessionDate: (row.session_date as string | null) ?? null,
      categoryId: (row.category_id as string | null) ?? null,
      zoneName: (row.zone_name as string | null) ?? null,
      reason: (row.reason as string | null) ?? null,
    });
  }

  const targets: Array<ReportRef & { effectiveDate: string | null }> = [];
  for (const ref of refs.values()) {
    const prev = ledgerMap.get(ref.code);
    // 初回同期まで日付が分からない report もあるので、台帳の日付で補う。
    const effectiveDate = ref.sessionDate ?? prev?.sessionDate ?? null;
    const withDate = { ...ref, effectiveDate };
    if (!prev) {
      targets.push(withDate);
      continue;
    }
    if (!prev.ok) {
      // 恒久失敗 (private) は再試行しても結果が変わらないので、明示指定が
      // 無い限りスキップして取得枠を新規レポートに回す。
      const permanent =
        prev.reason !== null &&
        (PERMISSION_ERROR_RE.test(prev.reason) ||
          prev.reason === PRIVATE_REPORT_REASON);
      if (!permanent || opts?.retryPermanentFailures) targets.push(withDate);
      continue;
    }
    // カテゴリ未確定の report は取り直す。ただし zone 名が既に台帳にあれば
    // 下の「オフライン再解決」で API を叩かずに埋められるので対象外にする
    // (再取得が毎回同じ report で埋まって新しい report に届かなくなるのを防ぐ)。
    if (prev.categoryId === null && (ref.categoryId !== null || !prev.zoneName)) {
      targets.push(withDate);
      continue;
    }
    // 直近のセッションはまだ pull が増えるので取り直す。
    if (isRecent(effectiveDate)) targets.push(withDate);
  }
  // 新しい日付から処理する (見たいのは直近の練習)。日付不明は最優先で
  // 拾う — 一度同期すれば日付が確定し、以後この分岐には来ない。
  targets.sort((a, b) =>
    (b.effectiveDate ?? "9999-99-99").localeCompare(
      a.effectiveDate ?? "9999-99-99",
    ),
  );
  const limit = opts?.limit ?? DEFAULT_REPORT_LIMIT;
  const sliced = targets.slice(0, limit);

  let fetched = 0;
  let upserted = 0;
  let failed = 0;
  let truncated = targets.length > sliced.length;

  for (const ref of sliced) {
    if (Date.now() > deadlineAtMs) {
      truncated = true;
      break;
    }
    let res = await fetchReportFights(token, ref.code);
    fetched += 1;
    if (!res.ok && PERMISSION_ERROR_RE.test(res.reason) && sessionCookie) {
      // private レポート: session cookie があれば内部 JSON で再試行する。
      const viaCookie = await fetchReportFightsViaCookie(sessionCookie, ref.code);
      if (viaCookie.ok) res = viaCookie;
    }
    if (!res.ok) {
      failed += 1;
      const isPermission = PERMISSION_ERROR_RE.test(res.reason);
      await db.from("fflogs_report_syncs").upsert(
        {
          report_code: ref.code,
          category_id: ref.categoryId,
          session_date: ref.sessionDate,
          ok: false,
          // permission エラーは原因と対処が分かる日本語に置き換えて保存する。
          reason: (isPermission ? PRIVATE_REPORT_REASON : res.reason).slice(
            0,
            300,
          ),
          synced_at: new Date().toISOString(),
        },
        { onConflict: "report_code" },
      );
      continue;
    }

    // 動画リンクで決まらなかった場合は zone ID / 内容分類で解決する。
    const categoryId =
      ref.categoryId ??
      resolveCategory(categories, res.zoneId, res.zoneName, res.title);
    const sessionDate =
      ref.sessionDate ?? jstYmdString(new Date(res.startMs));

    if (res.fights.length > 0) {
      const rows = res.fights.map((f) => ({
        report_code: ref.code,
        fight_id: f.id,
        category_id: categoryId,
        session_date: sessionDate,
        name: f.name ?? null,
        kill: f.kill === true,
        fight_percentage:
          typeof f.fightPercentage === "number" ? f.fightPercentage : null,
        last_phase: typeof f.lastPhase === "number" ? f.lastPhase : null,
        difficulty: typeof f.difficulty === "number" ? f.difficulty : null,
        encounter_id: typeof f.encounterID === "number" ? f.encounterID : null,
        // FFLogs の fight.startTime は report 開始からの相対 ms。絶対時刻に直す。
        start_ms: res.startMs + f.startTime,
        end_ms: res.startMs + f.endTime,
        report_start_ms: res.startMs,
      }));
      const { error } = await db
        .from("fflogs_fights")
        .upsert(rows, { onConflict: "report_code,fight_id" });
      if (error) {
        failed += 1;
        console.warn("[fflogs-fights] upsert failed:", error.message);
      } else {
        upserted += rows.length;
      }
    }

    await db.from("fflogs_report_syncs").upsert(
      {
        report_code: ref.code,
        category_id: categoryId,
        session_date: sessionDate,
        title: res.title?.slice(0, 300) ?? null,
        zone_id: res.zoneId,
        zone_name: res.zoneName?.slice(0, 200) ?? null,
        report_start_ms: res.startMs,
        fight_count: res.fights.length,
        ok: true,
        reason: null,
        synced_at: new Date().toISOString(),
      },
      { onConflict: "report_code" },
    );
  }

  // ---- オフライン再解決 + 掃除 (FFLogs を叩かない後処理) ----------------
  //
  // (a) 台帳にありながら category_id が NULL の report を、保存済みの
  //     zone 名 / タイトルで再分類する。動画リンクが後から付いた場合や、
  //     カテゴリの `fflogs_match_keywords` を後から設定した場合に、次の同期で
  //     ここが埋まる (再取得は不要)。fights 側の category_id も追随させる。
  // (b) Trash Fight (encounter_id = 0 / NULL) の既存行を削除する。取り込み側の
  //     フィルタ追加 (2026-08-28) より前に入ったゴミの掃除。
  let reattributed = 0;
  try {
    const { data: orphans } = await db
      .from("fflogs_report_syncs")
      .select("report_code, title, zone_name")
      .is("category_id", null)
      .eq("ok", true);
    for (const row of orphans ?? []) {
      const code = row.report_code as string;
      const cid = resolveCategory(
        categories,
        null,
        (row.zone_name as string | null) ?? null,
        (row.title as string | null) ?? null,
      ) ?? refs.get(code)?.categoryId ?? null;
      if (!cid) continue;
      await db
        .from("fflogs_report_syncs")
        .update({ category_id: cid })
        .eq("report_code", code);
      await db
        .from("fflogs_fights")
        .update({ category_id: cid })
        .eq("report_code", code)
        .is("category_id", null);
      reattributed += 1;
    }
  } catch (e) {
    console.warn("[fflogs-fights] re-attribution failed:", e);
  }

  try {
    await db.from("fflogs_fights").delete().eq("encounter_id", 0);
    await db.from("fflogs_fights").delete().is("encounter_id", null);
  } catch (e) {
    console.warn("[fflogs-fights] trash cleanup failed:", e);
  }

  return {
    ok: true,
    reportsKnown: refs.size,
    reportsFetched: fetched,
    fightsUpserted: upserted,
    failed,
    truncated,
    reattributed,
  };
}

function isRecent(date: string | null): boolean {
  if (!date) return true; // 日付不明は毎回取り直す (件数は少ない)
  const t = Date.parse(`${date}T00:00:00+09:00`);
  if (!Number.isFinite(t)) return true;
  return Date.now() - t < REFRESH_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}

type Db =
  | Awaited<ReturnType<typeof createClient>>
  | ReturnType<typeof createSupabaseServiceRoleClient>;

/**
 * portal が既に知っている report URL を集めて code に正規化する。
 * 新しいマッチングはしない (§ 冒頭のコメント参照)。
 */
async function collectReportRefs(db: Db): Promise<Map<string, ReportRef>> {
  const out = new Map<string, ReportRef>();
  const put = (
    url: string | null,
    categoryId: string | null,
    sessionDate: string | null,
  ) => {
    const code = parseFflogsReportCode(url);
    if (!code) return;
    const prev = out.get(code);
    if (prev) {
      // 情報は足し算 (video リンクから category、セッションから日付)。
      prev.categoryId ??= categoryId;
      prev.sessionDate ??= sessionDate;
      return;
    }
    out.set(code, { code, categoryId, sessionDate });
  };

  const [links, pastLogs, nativeLogs] = await Promise.all([
    db
      .from("category_links")
      .select("category_id, logs_url")
      .eq("kind", "video")
      .not("logs_url", "is", null),
    db.from("schedule_past_session_logs").select("url, raw_date"),
    db
      .from("native_schedule_session_logs")
      .select("url, native_schedule_sessions!inner(raw_date)"),
  ]);

  for (const r of links.data ?? []) {
    put(
      (r as { logs_url: string | null }).logs_url,
      (r as { category_id: string }).category_id,
      null,
    );
  }
  for (const r of pastLogs.data ?? []) {
    put(
      (r as { url: string | null }).url,
      null,
      (r as { raw_date: string | null }).raw_date,
    );
  }
  for (const r of nativeLogs.data ?? []) {
    const joined = (
      r as {
        native_schedule_sessions:
          | { raw_date: string | null }
          | { raw_date: string | null }[]
          | null;
      }
    ).native_schedule_sessions;
    const rawDate = Array.isArray(joined)
      ? (joined[0]?.raw_date ?? null)
      : (joined?.raw_date ?? null);
    put((r as { url: string | null }).url, null, rawDate);
  }
  return out;
}

type CategoryRef = {
  id: string;
  name: string;
  zoneIds: number[];
  keywords: string[];
};

/** カテゴリ一覧 (紐づけ用の最小フィールド)。同期 1 回につき 1 度だけ読む。 */
async function loadCategories(db: Db): Promise<CategoryRef[]> {
  const { data } = await db
    .from("categories")
    .select("id, name, expected_fflogs_zone_ids, fflogs_match_keywords");
  return (data ?? []).map((r) => ({
    id: r.id as string,
    name: (r.name as string) ?? "",
    zoneIds: (r.expected_fflogs_zone_ids as number[] | null) ?? [],
    keywords: (r.fflogs_match_keywords as string[] | null) ?? [],
  }));
}

/**
 * レポート → カテゴリの解決。
 *
 * (a) `expected_fflogs_zone_ids` の一致を最優先 (運用者が明示した対応)
 * (b) 次に zone 名 / タイトルの内容分類 (`CONTENT_GROUPS`) がカテゴリ名または
 *     `fflogs_match_keywords` と同じグループに落ちるもの
 *
 * どちらも「候補が 1 件に定まるときだけ」返す。2 件以上該当したら曖昧なので
 * null にして誤配属を作らない。
 */
function resolveCategory(
  categories: CategoryRef[],
  zoneId: number | null,
  zoneName: string | null,
  title: string | null,
): string | null {
  if (zoneId != null) {
    const byZone = categories.filter((c) => c.zoneIds.includes(zoneId));
    if (byZone.length === 1) return byZone[0]!.id;
    if (byZone.length > 1) return null;
  }

  const reportText = [zoneName, title].filter(Boolean).join(" ");
  if (!reportText) return null;
  const reportGroups = findContentGroups(reportText);
  if (reportGroups.size === 0) return null;

  const byContent = categories.filter((c) => {
    const catGroups = findContentGroups([c.name, ...c.keywords].join(" "));
    for (const g of catGroups) if (reportGroups.has(g)) return true;
    return false;
  });
  return byContent.length === 1 ? byContent[0]!.id : null;
}

type ReportFightsResult =
  | {
      ok: true;
      title: string | null;
      zoneId: number | null;
      zoneName: string | null;
      startMs: number;
      fights: FightPayload[];
    }
  | { ok: false; reason: string };

/**
 * 1 レポート分の fights を取得する。
 *
 * `lastPhase` は FFLogs 側のスキーマ変更で失われても機能全体が死なないよう、
 * GraphQL エラー時に **その項目を落とした最小クエリで 1 度だけ再試行** する。
 */
async function fetchReportFights(
  token: string,
  code: string,
): Promise<ReportFightsResult> {
  const full = `query ($code: String!) {
    reportData {
      report(code: $code) {
        title
        startTime
        zone { id name }
        fights {
          id
          name
          kill
          difficulty
          encounterID
          fightPercentage
          lastPhase
          startTime
          endTime
        }
      }
    }
  }`;
  const minimal = `query ($code: String!) {
    reportData {
      report(code: $code) {
        title
        startTime
        zone { id name }
        fights {
          id
          name
          kill
          difficulty
          encounterID
          startTime
          endTime
        }
      }
    }
  }`;

  const first = await postGraphql(token, full, code);
  if (first.ok) return first;
  // GraphQL エラーのときだけ「フィールド名の不一致かもしれない」と解釈して
  // 最小クエリで 1 度だけ再試行する。HTTP エラー (401 / 5xx) は再試行しない。
  if (first.kind !== "graphql") return { ok: false, reason: first.reason };
  console.warn(
    "[fflogs-fights] full query rejected, retrying minimal:",
    first.reason,
  );
  const second = await postGraphql(token, minimal, code);
  if (second.ok) return second;
  return { ok: false, reason: second.reason };
}

/**
 * private レポートの fallback: FFLogs のレポートページ自身が使う内部 JSON
 * (`/reports/fights-and-participants/<code>/0`) を session cookie 付きで叩く。
 *
 * 既存の「private レポートの一覧を cookie scrape で取る」方針 (fflogs.ts)
 * の延長で、新しい認証面は増やしていない。非公式エンドポイントなので
 * フィールド名のゆれ (boss/encounterID, start_time/startTime,
 * bossPercentage/fightPercentage) を許容する防御的パースにし、形が想定と
 * 違ったら黙って失敗に落とす (v2 の結果に上書きはしない)。
 */
async function fetchReportFightsViaCookie(
  sessionCookie: string,
  code: string,
): Promise<ReportFightsResult> {
  try {
    const res = await fetch(
      `https://www.fflogs.com/reports/fights-and-participants/${encodeURIComponent(code)}/0`,
      {
        cache: "no-store",
        headers: {
          ...buildFflogsScrapeHeaders(sessionCookie),
          Accept: "application/json,*/*",
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      },
    );
    if (!res.ok) {
      return { ok: false, reason: `fflogs internal ${res.status}` };
    }
    const ctype = res.headers.get("content-type") ?? "";
    if (!/json/i.test(ctype)) {
      // ログイン画面 HTML 等 = cookie が失効している。
      return { ok: false, reason: "session cookie が無効の可能性" };
    }
    const json = (await res.json()) as {
      fights?: Array<Record<string, unknown>> | null;
      start?: number | null;
      startTime?: number | null;
      title?: string | null;
      zone?: number | { id?: number; name?: string } | null;
      zoneName?: string | null;
    };
    if (!Array.isArray(json.fights)) {
      return { ok: false, reason: "fights が取得できません (形式不一致)" };
    }
    const startMs = num(json.start) ?? num(json.startTime);
    if (startMs === null) {
      return { ok: false, reason: "レポート開始時刻が取得できません" };
    }
    const fights: FightPayload[] = [];
    for (const f of json.fights) {
      const id = num(f.id);
      const st = num(f.start_time) ?? num(f.startTime);
      const et = num(f.end_time) ?? num(f.endTime);
      const enc = num(f.boss) ?? num(f.encounterID);
      if (id === null || st === null || et === null) continue;
      if (enc === null || enc <= 0) continue; // trash は取り込まない
      fights.push({
        id,
        name: typeof f.name === "string" ? f.name : null,
        kill: f.kill === true,
        difficulty: num(f.difficulty),
        encounterID: enc,
        // 内部 JSON の bossPercentage / fightPercentage は 100 倍値のことが
        // ある。読み出し側の normalizePercentage が 0-100 に畳むので、
        // ここではそのまま保存する。
        fightPercentage: num(f.fightPercentage) ?? num(f.bossPercentage),
        lastPhase:
          num(f.lastPhase) ?? num(f.lastPhaseForPercentageDisplay),
        startTime: st,
        endTime: et,
      });
    }
    const zoneObj = json.zone;
    return {
      ok: true,
      title: typeof json.title === "string" ? json.title : null,
      zoneId:
        typeof zoneObj === "number" ? zoneObj : num(zoneObj?.id ?? null),
      zoneName:
        typeof json.zoneName === "string"
          ? json.zoneName
          : typeof zoneObj === "object" && zoneObj && typeof zoneObj.name === "string"
            ? zoneObj.name
            : null,
      startMs,
      fights,
    };
  } catch (e) {
    return {
      ok: false,
      reason: e instanceof Error ? e.message : "fetch failed",
    };
  }
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

async function postGraphql(
  token: string,
  query: string,
  code: string,
): Promise<
  | (ReportFightsResult & { ok: true })
  | { ok: false; reason: string; kind: "http" | "graphql" | "empty" }
> {
  try {
    const res = await fetch(FFLOGS_GRAPHQL_URL, {
      method: "POST",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ query, variables: { code } }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        ok: false,
        kind: "http",
        reason:
          res.status === 401
            ? "FFLogs OAuth トークンが無効です — 設定で再認証してください"
            : `fflogs v2 ${res.status}: ${text.slice(0, 200)}`,
      };
    }
    const json = (await res.json()) as {
      errors?: Array<{ message?: string }>;
      data?: {
        reportData?: {
          report?: {
            title?: string | null;
            startTime?: number | null;
            zone?: { id?: number | null; name?: string | null } | null;
            fights?: FightPayload[] | null;
          } | null;
        } | null;
      };
    };
    if (json.errors?.length) {
      return {
        ok: false,
        kind: "graphql",
        reason: json.errors[0]?.message ?? "GraphQL error",
      };
    }
    const report = json.data?.reportData?.report;
    if (!report || typeof report.startTime !== "number") {
      return { ok: false, kind: "empty", reason: "レポートが取得できません" };
    }
    return {
      ok: true,
      title: report.title ?? null,
      zoneId: report.zone?.id ?? null,
      zoneName: report.zone?.name ?? null,
      startMs: report.startTime,
      fights: (report.fights ?? []).filter(
        (f) =>
          typeof f?.id === "number" &&
          typeof f?.startTime === "number" &&
          // Trash Fight を除外する。FFLogs は雑魚戦を encounterID = 0 で返す
          // ので、ボス戦 (正の encounterID) だけを pull として取り込む。
          // これを入れないと道中の雑魚が「残 HP 不明の pull」として練習ログに
          // 混ざる (2026-08-28 ユーザー報告)。
          typeof f?.encounterID === "number" &&
          f.encounterID > 0,
      ),
    };
  } catch (e) {
    return {
      ok: false,
      kind: "http",
      reason: e instanceof Error ? e.message : "fetch failed",
    };
  }
}
