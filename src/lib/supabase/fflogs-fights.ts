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
} from "@/lib/fflogs-fight-detail";

/**
 * 練習ログ (fights) の読み取り (TODO #94 / A-1 + A-2)。
 * 書き込みは `src/lib/server/fflogs-fights.ts` の同期処理のみ。
 */

/**
 * client へ渡す明細の上限。1 pull ≈ 200 バイトの JSON なので、
 * 数千 pull を全部送ると RSC ペイロードが MB 級になる。合計値は別途
 * count クエリで正確に取り、明細だけ直近 N 件に絞る。
 */
const MAX_FIGHTS = 1200;

export type ReportVideoLink = {
  reportCode: string;
  videoUrl: string | null;
  offsetSeconds: number;
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
    const listRes = await supabase
      .from("fflogs_fights")
      .select(
        "report_code, fight_id, session_date, name, kill, fight_percentage, last_phase, difficulty, encounter_id, party_dps, deaths, death_events, phase_transitions, start_ms, end_ms, report_start_ms",
        { count: "exact" },
      )
      .eq("category_id", categoryId)
      .order("start_ms", { ascending: false })
      .limit(MAX_FIGHTS);
    const { data, error, count } = listRes;
    if (error || !data) return empty;
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
): Promise<Record<string, ReportVideoLink>> {
  if (reportCodes.length === 0) return {};
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("fflogs_report_videos")
      .select("report_code, video_url, offset_seconds")
      .in("report_code", reportCodes);
    if (error || !data) return {};
    const out: Record<string, ReportVideoLink> = {};
    for (const r of data) {
      out[r.report_code as string] = {
        reportCode: r.report_code as string,
        videoUrl: (r.video_url as string | null) ?? null,
        offsetSeconds: Number(r.offset_seconds ?? 0),
      };
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
 */
export async function fetchCategoryPhaseTotals(
  categoryId: string,
): Promise<{ totals: PhaseTimeTotal[]; pulls: number } | null> {
  const supabase = await createClient();
  const PAGE = 1000;
  const MAX_PAGES = 20;
  const spansList: Array<PhaseSpan[] | null> = [];
  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const { data, error } = await supabase
        .from("fflogs_fights")
        .select("start_ms, end_ms, phase_transitions")
        .eq("category_id", categoryId)
        .not("phase_transitions", "is", null)
        .order("start_ms", { ascending: false })
        .range(page * PAGE, page * PAGE + PAGE - 1);
      if (error) {
        console.warn("[fflogs-fights] phase totals fetch failed:", error.message);
        return null;
      }
      const rows = (data ?? []) as Array<Record<string, unknown>>;
      for (const r of rows) {
        const startMs = Number(r.start_ms);
        const endMs = Number(r.end_ms);
        if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;
        spansList.push(
          phaseSpans(asPhaseTransitions(r.phase_transitions), Math.max(0, endMs - startMs)),
        );
      }
      if (rows.length < PAGE) break;
    }
  } catch (e) {
    console.warn("[fflogs-fights] phase totals fetch threw:", e);
    return null;
  }
  const totals = phaseTimeTotals(spansList);
  if (totals.length === 0) return null;
  return { totals, pulls: spansList.filter((s) => s !== null).length };
}
