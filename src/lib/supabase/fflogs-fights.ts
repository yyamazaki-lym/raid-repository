import { createClient } from "./server";
import {
  buildFloorMap,
  normalizePercentage,
  type FightRow,
} from "@/lib/fflogs-progress";
import {
  phaseSpans,
  summarizeWipe,
  type StoredDeathEvent,
  type StoredPhaseTransition,
  phaseTimeTotals,
  type PhaseSpan,
  type PhaseTimeTotal,
  firstPhaseReaches,
  type PhaseFirstReach,
} from "@/lib/fflogs-fight-detail";

/**
 * 練習ログ (fights) の読み取り (TODO #94 / A-1 + A-2)。
 * 書き込みは `src/lib/server/fflogs-fights.ts` の同期処理のみ。
 */

/**
 * 明細の上限 (2026-09-07 に 1200 → 20000)。
 *
 * 以前の 1200 は「1 pull ≈ 200 B なので数千 pull で RSC ペイロードが MB 級に
 * なる」という見立てで置いていたが、実機の絶竜詩が 1047 pull まで来て上限が
 * 目前になったため実測し直した (`scripts/check-fights-payload.mjs`):
 *
 *   | pull  | raw     | gzip   | brotli |
 *   |-------|---------|--------|--------|
 *   | 1200  | 0.63 MB |  46 KB |  24 KB |
 *   | 6000  | 3.16 MB | 228 KB |  99 KB |
 *
 * (絶 = phases 込みの重い側。零式は約 3/4。) raw は確かに MB 級だが、同じ
 * report code / 日付 / ボス名 / 技名が何十行も並ぶため圧縮が 14 倍効き、
 * **転送量は 6000 pull でも gzip 228 KB / brotli 99 KB**。描画も「直近 10 日
 * + 人が開いた日だけ」なので DOM は pull 数に比例しない。よって実質の上限は
 * 不要と判断した。
 *
 * ここに残す 20000 は事故の安全弁 — 誤分類で別コンテンツが大量に流れ込んだ
 * ときにページを巻き込まないための値で、通常の固定運用では到達しない
 * (週 3 日 × 5 年 × 40 pull ≈ 31000 なので、超長期では届き得る)。
 * 打ち切ったときは従来どおり `truncated` を立てて UI に明示する。
 */
const MAX_FIGHTS = 20000;
/**
 * 1 回のリクエストで返る最大行数 (2026-09-07)。
 *
 * PostgREST は **既定で 1000 行** を上限にしており、`.limit(1200)` を付けても
 * 1000 行しか返らない。実機: 絶竜詩 (1047 pull) で最古の 47 pull —
 * 2022-04-30 のセッション丸ごと — が明細から消えていた (総 pull 数は count
 * クエリなので 1047 のまま = 「pull はあるのに日が出てこない」)。
 * `range()` でページングして MAX_FIGHTS まで取り切る。
 */
const PAGE_SIZE = 1000;

/**
 * `fflogs_fights` をカテゴリ単位で取り切る (2026-09-07)。
 *
 * 1 ページ目で `count` を取り、**残りのページは並列**に投げる。直列だと
 * 6000 pull で 6 往復 = レイテンシがそのまま 6 倍になり、上限を上げた分だけ
 * ページが遅くなってしまう。並列なら実質 2 往復で済む。
 *
 * 並び順は `start_ms` 降順 + `fight_id` 降順。同時刻の pull があっても
 * ページ境界で行がずれない (第 2 キーが無いと ORDER BY が非決定になり、
 * 同じ行が 2 ページに出たり抜けたりする)。
 *
 * 戻り値の `count` はカテゴリ全体の pull 数 (打ち切りに影響されない)。
 * 1 ページ目が失敗したら null、2 ページ目以降が失敗したらそこまでの
 * 部分結果を返す (呼び出し側が `truncated` を立てる)。
 */
async function fetchAllCategoryFightRows(
  supabase: Awaited<ReturnType<typeof createClient>>,
  columns: string,
  categoryId: string,
): Promise<{ rows: Array<Record<string, unknown>>; count: number | null } | null> {
  const fetchPage = (from: number, to: number, withCount: boolean) =>
    supabase
      .from("fflogs_fights")
      .select(columns, withCount ? { count: "exact" } : undefined)
      .eq("category_id", categoryId)
      .order("start_ms", { ascending: false })
      .order("fight_id", { ascending: false })
      .range(from, to);

  const first = await fetchPage(0, PAGE_SIZE - 1, true);
  if (first.error || !first.data) {
    console.warn("[fflogs-fights] fights fetch failed:", first.error?.message);
    return null;
  }
  const rows = first.data as unknown as Array<Record<string, unknown>>;
  const count = first.count ?? null;
  const total = Math.min(count ?? rows.length, MAX_FIGHTS);
  // 1 ページで収まった / これ以上無い。
  if (rows.length < PAGE_SIZE || rows.length >= total) return { rows, count };

  const starts: number[] = [];
  for (let from = PAGE_SIZE; from < total; from += PAGE_SIZE) starts.push(from);
  const pages = await Promise.all(
    starts.map((from) => fetchPage(from, Math.min(from + PAGE_SIZE, total) - 1, false)),
  );
  // Promise.all は順序を保つので、失敗ページで打ち切れば行は連続した
  // prefix のまま (穴あきにならない)。
  for (const page of pages) {
    if (page.error || !page.data) {
      console.warn("[fflogs-fights] fights page failed:", page.error?.message);
      break;
    }
    rows.push(...(page.data as unknown as Array<Record<string, unknown>>));
  }
  return { rows, count };
}

export type ReportVideoLink = {
  /** 行 ID (2026-09-07 に 1 レポート N 動画へ移行したので report_code は一意でない)。 */
  id: string;
  reportCode: string;
  videoUrl: string | null;
  offsetSeconds: number;
  /** 「前半」「ヒラ視点」等の表示名。空なら UI が「動画 1」と振る。 */
  label: string | null;
  sortOrder: number;
};

export type CategoryFights = {
  fights: FightRow[];
  /** カテゴリ全体の pull 数 (明細が打ち切られていても正確)。 */
  totalPulls: number;
  /**
   * カテゴリ全体のクリア数 (明細が打ち切られていても正確)。
   * 複数層のカテゴリでは最終層 (最大 encounter_id) の kill のみを数える
   * (2026-08-28: 消化で全層に kill が付き「討伐」が情報にならないため)。
   */
  totalClears: number;
  /** 明細が MAX_FIGHTS で打ち切られたか。 */
  truncated: boolean;
};

export async function fetchCategoryFights(
  categoryId: string,
  opts?: {
    /**
     * フェーズ滞在区間 (`phases`) を明細に含めるか (2026-09-06 W-2)。
     * フェーズ表示は絶に限る (2026-08-28 の判断) ので、零式では false にして
     * RSC payload を増やさない。既定 false。
     */
    includePhases?: boolean;
    /**
     * 絶 (単一 encounter のコンテンツ) か (2026-09-06)。true なら層クラスタ
     * (`buildFloorMap`) を作らない。拡張をまたいだ絶は旧 zone と Legacy zone で
     * encounter ID が別になり得るため、クラスタ判定に掛けると片方の kill が
     * 「最終層以外」として数から落ちる。
     */
    ultimate?: boolean;
  },
): Promise<CategoryFights> {
  const empty: CategoryFights = {
    fights: [],
    totalPulls: 0,
    totalClears: 0,
    truncated: false,
  };
  try {
    const supabase = await createClient();
    const columns =
      "report_code, fight_id, session_date, name, kill, fight_percentage, last_phase, difficulty, encounter_id, party_dps, deaths, death_events, phase_transitions, start_ms, end_ms, report_start_ms";
    const paged = await fetchAllCategoryFightRows(supabase, columns, categoryId);
    if (!paged) return empty;
    const { rows: data, count } = paged;
    const includePhases = opts?.includePhases === true;
    const fights = data.map((r) => {
      const startMs = Number(r.start_ms);
      const endMs = Number(r.end_ms);
      const kill = (r.kill as boolean) === true;
      // jsonb 列は保存形 (fflogs-fight-detail.ts) のまま来る。形が違う
      // (旧データ / 手で触った) 場合は null 扱いにして表示側を壊さない。
      const deathEvents = asDeathEvents(r.death_events);
      const transitions = asPhaseTransitions(r.phase_transitions);
      return {
      reportCode: r.report_code as string,
      fightId: r.fight_id as number,
      sessionDate: (r.session_date as string | null) ?? null,
      name: (r.name as string | null) ?? null,
      kill: (r.kill as boolean) === true,
      // 100 倍値で入っている環境があるためここで 0-100 に正規化する。
      fightPercentage: normalizePercentage(numberOrNull(r.fight_percentage)),
      lastPhase: numberOrNull(r.last_phase),
      encounterId: numberOrNull(r.encounter_id),
      difficulty: numberOrNull(r.difficulty),
      partyDps: numberOrNull(r.party_dps),
      deaths: numberOrNull(r.deaths),
      wipe: summarizeWipe(deathEvents, transitions, kill),
      phases: includePhases
        ? phaseSpans(transitions, Math.max(0, endMs - startMs))
        : null,
      startMs,
      endMs,
      reportStartMs: r.report_start_ms == null ? null : Number(r.report_start_ms),
      };
    });
    const totalPulls = count ?? fights.length;

    // クリア数: 複数層なら最終層の kill のみ。層はクラスタ判定
    // (buildFloorMap — レポートに混ざった別コンテンツの encounter を除外)
    // を明細から出し、count クエリで正確に数える (明細打ち切りに影響され
    // ない — ティアの層構成は不変なので直近 1200 件に最終層は必ず現れる)。
    const floors = opts?.ultimate ? null : buildFloorMap(fights);
    let clearQuery = supabase
      .from("fflogs_fights")
      .select("report_code", { count: "exact", head: true })
      .eq("category_id", categoryId)
      .eq("kill", true);
    if (floors) {
      clearQuery = clearQuery.eq("encounter_id", floors.finalEncounterId);
    }
    const clearRes = await clearQuery;

    return {
      fights,
      totalPulls,
      totalClears: clearRes.count ?? 0,
      truncated: totalPulls > fights.length,
    };
  } catch (err) {
    rethrowNextSentinel(err);
    console.warn("[fflogs-fights] read error:", err);
    return empty;
  }
}

/** report ごとの動画紐づけ + オフセット (A-2)。 */
export async function fetchReportVideoLinks(
  reportCodes: string[],
): Promise<Record<string, ReportVideoLink[]>> {
  if (reportCodes.length === 0) return {};
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("fflogs_report_videos")
      .select("id, report_code, video_url, offset_seconds, label, sort_order")
      .in("report_code", reportCodes)
      .order("sort_order", { ascending: true })
      .order("updated_at", { ascending: true });
    if (error || !data) return {};
    // 2026-09-07: 1 レポートに複数動画 (前半/後半・視点違い) が紐づくので
    // report_code → 配列。並びは sort_order → 登録順で安定させる (UI の
    // 「動画 1 / 2」の番号と pull 行のチップ順がリロードで入れ替わらない)。
    const out: Record<string, ReportVideoLink[]> = {};
    for (const r of data) {
      const code = r.report_code as string;
      (out[code] ??= []).push({
        id: String(r.id),
        reportCode: code,
        videoUrl: (r.video_url as string | null) ?? null,
        offsetSeconds: Number(r.offset_seconds ?? 0),
        label: (r.label as string | null) ?? null,
        sortOrder: Number(r.sort_order ?? 0),
      });
    }
    return out;
  } catch (err) {
    rethrowNextSentinel(err);
    console.warn("[fflogs-fights] video link read error:", err);
    return {};
  }
}

export type FailedReportSync = {
  reportCode: string;
  reason: string | null;
  /** true = どのコンテンツにも割り当てられていない失敗 (全カテゴリで表示)。 */
  unassigned: boolean;
};

/**
 * 同期台帳のうち失敗しているものを返す (UI に「取り込めていない report」を
 * 出すため)。**カテゴリ未割当の失敗も含める** — 2026-08-28 実機で、
 * 取得に失敗して zone も分からないレポートが category_id NULL のまま
 * どのページにも出ず、「同期したのにログが出ない」理由が見えなかったため。
 */
export async function fetchFailedReportSyncs(
  categoryId: string,
): Promise<FailedReportSync[]> {
  try {
    const supabase = await createClient();
    const [mine, orphan] = await Promise.all([
      supabase
        .from("fflogs_report_syncs")
        .select("report_code, reason")
        .eq("category_id", categoryId)
        .eq("ok", false)
        .limit(20),
      supabase
        .from("fflogs_report_syncs")
        .select("report_code, reason")
        .is("category_id", null)
        .eq("ok", false)
        .limit(20),
    ]);
    const out: FailedReportSync[] = [];
    for (const r of mine.data ?? []) {
      out.push({
        reportCode: r.report_code as string,
        reason: (r.reason as string | null) ?? null,
        unassigned: false,
      });
    }
    for (const r of orphan.data ?? []) {
      out.push({
        reportCode: r.report_code as string,
        reason: (r.reason as string | null) ?? null,
        unassigned: true,
      });
    }
    return out;
  } catch (err) {
    rethrowNextSentinel(err);
    return [];
  }
}

/** jsonb `death_events` の防御的パース (要素の形が違えば捨てる)。 */
function asDeathEvents(v: unknown): StoredDeathEvent[] | null {
  if (!Array.isArray(v)) return null;
  const out: StoredDeathEvent[] = [];
  for (const e of v) {
    if (!e || typeof e !== "object") continue;
    const o = e as Record<string, unknown>;
    const t = numberOrNull(o.t);
    if (t === null) continue;
    const id = numberOrNull(o.id);
    out.push({
      t,
      job: typeof o.job === "string" ? o.job : null,
      ability: typeof o.ability === "string" ? o.ability : null,
      ...(id !== null ? { id } : {}),
      ...(typeof o.ja === "string" && o.ja !== "" ? { ja: o.ja } : {}),
    });
  }
  return out;
}

/** jsonb `phase_transitions` の防御的パース。 */
function asPhaseTransitions(v: unknown): StoredPhaseTransition[] | null {
  if (!Array.isArray(v)) return null;
  const out: StoredPhaseTransition[] = [];
  for (const e of v) {
    if (!e || typeof e !== "object") continue;
    const o = e as Record<string, unknown>;
    const id = numberOrNull(o.id);
    const t = numberOrNull(o.t);
    if (id === null || t === null) continue;
    out.push({ id, t });
  }
  return out.length > 0 ? out : null;
}

function numberOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function rethrowNextSentinel(err: unknown): void {
  if (
    err &&
    typeof err === "object" &&
    "digest" in err &&
    typeof (err as { digest?: unknown }).digest === "string"
  ) {
    const digest = (err as { digest: string }).digest;
    if (digest === "DYNAMIC_SERVER_USAGE" || digest.startsWith("NEXT_")) {
      throw err;
    }
  }
}

/**
 * カテゴリの **全 pull** のフェーズ滞在時間 (2026-09-07)。
 *
 * 練習ログの「フェーズ滞在時間」カードは、明細が MAX_FIGHTS で打ち切られる
 * カテゴリでは表示中の pull だけの合計になっていた (実機: 絶竜詩 1047 pull
 * で「表示中の分」)。ここでは軽い列 (開始 / 終了 / フェーズ遷移 jsonb) だけを
 * 1000 件ずつ全件読み、`phaseSpans` → `phaseTimeTotals` で合計する。
 * 絶 (フェーズ管理コンテンツ) のページからだけ呼ぶ。
 *
 * 戻り値の `pulls` は区間が取れた pull 数 (= 合計の母数)。フェーズ遷移が
 * 保存されていない pull (古い同期分) は数えない。
 *
 * 2026-09-07: あわせて「各フェーズへの初到達」(`firstReach`) も返す。こちらは
 * フェーズ遷移が無い pull でも `last_phase` があれば数えられるので、全 pull を
 * 対象にする (pull 数がフェーズ滞在時間の母数とは一致しない)。
 */
export async function fetchCategoryPhaseTotals(categoryId: string): Promise<{
  totals: PhaseTimeTotal[];
  pulls: number;
  firstReach: PhaseFirstReach[];
} | null> {
  const supabase = await createClient();
  const spansList: Array<PhaseSpan[] | null> = [];
  const reaches: Array<{
    startMs: number;
    durationMs: number;
    reachedPhase: number | null;
    date: string | null;
  }> = [];
  try {
    // 明細と同じ並列ページングで全 pull を取る (2026-09-07)。以前は直列
    // 20 ページのループを自前で持っていたが、上限の管理が 2 箇所に分かれて
    // いると片方だけ古い値のまま残る (実際 1200 と 20000 でずれていた)。
    const paged = await fetchAllCategoryFightRows(
      supabase,
      "start_ms, end_ms, phase_transitions, last_phase, session_date",
      categoryId,
    );
    if (!paged) return null;
    for (const r of paged.rows) {
      const startMs = Number(r.start_ms);
      const endMs = Number(r.end_ms);
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;
      const durationMs = Math.max(0, endMs - startMs);
      const transitions = asPhaseTransitions(r.phase_transitions);
      if (transitions !== null) spansList.push(phaseSpans(transitions, durationMs));
      // 到達フェーズ: last_phase が基本。遷移が取れていればその最大 ID とも
      // 突き合わせる (片方しか無いレポートがあるため)。
      const lastPhase = numberOrNull(r.last_phase);
      const maxTransition =
        transitions && transitions.length > 0
          ? Math.max(...transitions.map((t) => t.id))
          : null;
      const reachedPhase =
        lastPhase === null && maxTransition === null
          ? null
          : Math.max(lastPhase ?? 0, maxTransition ?? 0);
      reaches.push({
        startMs,
        durationMs,
        reachedPhase,
        date: typeof r.session_date === "string" ? r.session_date : null,
      });
    }
  } catch (e) {
    console.warn("[fflogs-fights] phase totals fetch threw:", e);
    return null;
  }
  const totals = phaseTimeTotals(spansList);
  if (totals.length === 0) return null;
  return {
    totals,
    pulls: spansList.filter((s) => s !== null).length,
    firstReach: firstPhaseReaches(reaches),
  };
}
