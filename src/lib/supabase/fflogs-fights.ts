import { createClient } from "./server";
import {
  buildFloorMap,
  normalizePercentage,
  type FightRow,
} from "@/lib/fflogs-progress";

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
        "report_code, fight_id, session_date, name, kill, fight_percentage, last_phase, difficulty, encounter_id, start_ms, end_ms, report_start_ms",
        { count: "exact" },
      )
      .eq("category_id", categoryId)
      .order("start_ms", { ascending: false })
      .limit(MAX_FIGHTS);
    const { data, error, count } = listRes;
    if (error || !data) return empty;
    const fights = data.map((r) => ({
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
      startMs: Number(r.start_ms),
      endMs: Number(r.end_ms),
      reportStartMs: r.report_start_ms == null ? null : Number(r.report_start_ms),
    }));
    const totalPulls = count ?? fights.length;

    // クリア数: 複数層なら最終層の kill のみ。層はクラスタ判定
    // (buildFloorMap — レポートに混ざった別コンテンツの encounter を除外)
    // を明細から出し、count クエリで正確に数える (明細打ち切りに影響され
    // ない — ティアの層構成は不変なので直近 1200 件に最終層は必ず現れる)。
    const floors = buildFloorMap(fights);
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
