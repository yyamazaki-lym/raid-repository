import "server-only";
import {
  createClient,
  createSupabaseServiceRoleClient,
} from "@/lib/supabase/server";
import { getValidFflogsOAuthToken } from "./fflogs-oauth";
import { parseFflogsReportCode } from "@/lib/fflogs-url";
import { jstYmdString } from "@/lib/jst-date";

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
 *   3. `schedule_past_session_logs` / `native_schedule_session_logs` → session_date
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

  const refs = await collectReportRefs(db);
  if (refs.size === 0) {
    return {
      ok: true,
      reportsKnown: 0,
      reportsFetched: 0,
      fightsUpserted: 0,
      failed: 0,
      truncated: false,
    };
  }

  // 既存の同期台帳を読み、再取得が要るものだけに絞る。
  const { data: ledger } = await db
    .from("fflogs_report_syncs")
    .select("report_code, ok, synced_at, session_date");
  const ledgerMap = new Map<
    string,
    { ok: boolean; syncedAt: string | null; sessionDate: string | null }
  >();
  for (const row of ledger ?? []) {
    ledgerMap.set(row.report_code as string, {
      ok: (row.ok as boolean) ?? false,
      syncedAt: (row.synced_at as string | null) ?? null,
      sessionDate: (row.session_date as string | null) ?? null,
    });
  }

  const targets: ReportRef[] = [];
  for (const ref of refs.values()) {
    const prev = ledgerMap.get(ref.code);
    if (!prev) {
      targets.push(ref);
      continue;
    }
    if (!prev.ok) {
      targets.push(ref);
      continue;
    }
    // 直近のセッションはまだ pull が増えるので取り直す。
    if (isRecent(ref.sessionDate ?? prev.sessionDate)) targets.push(ref);
  }
  // 新しい日付から処理する (見たいのは直近の練習)。
  targets.sort((a, b) => (b.sessionDate ?? "").localeCompare(a.sessionDate ?? ""));
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
    const res = await fetchReportFights(token, ref.code);
    fetched += 1;
    if (!res.ok) {
      failed += 1;
      await db.from("fflogs_report_syncs").upsert(
        {
          report_code: ref.code,
          category_id: ref.categoryId,
          session_date: ref.sessionDate,
          ok: false,
          reason: res.reason.slice(0, 300),
          synced_at: new Date().toISOString(),
        },
        { onConflict: "report_code" },
      );
      continue;
    }

    // zone id から category を引く (video リンクで決まらなかった場合のみ)。
    const categoryId =
      ref.categoryId ?? (await categoryIdByZone(db, res.zoneId));
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
        report_start_ms: res.startMs,
        fight_count: res.fights.length,
        ok: true,
        reason: null,
        synced_at: new Date().toISOString(),
      },
      { onConflict: "report_code" },
    );
  }

  return {
    ok: true,
    reportsKnown: refs.size,
    reportsFetched: fetched,
    fightsUpserted: upserted,
    failed,
    truncated,
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

/**
 * zone id からカテゴリを引く。`categories.expected_fflogs_zone_ids` は
 * FFLogs auto-link 用に既に運用されている設定なので、それを再利用する。
 * 2 件以上該当する場合は曖昧なので null (誤配属を作らない)。
 */
async function categoryIdByZone(
  db: Db,
  zoneId: number | null,
): Promise<string | null> {
  if (zoneId == null) return null;
  const { data } = await db
    .from("categories")
    .select("id, expected_fflogs_zone_ids")
    .contains("expected_fflogs_zone_ids", [zoneId]);
  if (!data || data.length !== 1) return null;
  return (data[0] as { id: string }).id;
}

type ReportFightsResult =
  | {
      ok: true;
      title: string | null;
      zoneId: number | null;
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
        zone { id }
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
        zone { id }
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
  return second.ok ? second : { ok: false, reason: second.reason };
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
            zone?: { id?: number | null } | null;
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
      startMs: report.startTime,
      fights: (report.fights ?? []).filter(
        (f) => typeof f?.id === "number" && typeof f?.startTime === "number",
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
