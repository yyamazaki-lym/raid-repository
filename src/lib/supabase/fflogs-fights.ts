import { createClient } from "./server";
import type { FightRow } from "@/lib/fflogs-progress";

/**
 * 練習ログ (fights) の読み取り (TODO #94 / A-1 + A-2)。
 * 書き込みは `src/lib/server/fflogs-fights.ts` の同期処理のみ。
 */

/** 1 カテゴリ分の上限。零式 1 ティアでも数千 pull には届かない想定。 */
const MAX_FIGHTS = 3000;

export type ReportVideoLink = {
  reportCode: string;
  videoUrl: string | null;
  offsetSeconds: number;
};

export async function fetchCategoryFights(
  categoryId: string,
): Promise<FightRow[]> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("fflogs_fights")
      .select(
        "report_code, fight_id, session_date, name, kill, fight_percentage, last_phase, start_ms, end_ms, report_start_ms",
      )
      .eq("category_id", categoryId)
      .order("start_ms", { ascending: false })
      .limit(MAX_FIGHTS);
    if (error || !data) return [];
    return data.map((r) => ({
      reportCode: r.report_code as string,
      fightId: r.fight_id as number,
      sessionDate: (r.session_date as string | null) ?? null,
      name: (r.name as string | null) ?? null,
      kill: (r.kill as boolean) === true,
      fightPercentage: numberOrNull(r.fight_percentage),
      lastPhase: numberOrNull(r.last_phase),
      startMs: Number(r.start_ms),
      endMs: Number(r.end_ms),
      reportStartMs: r.report_start_ms == null ? null : Number(r.report_start_ms),
    }));
  } catch (err) {
    rethrowNextSentinel(err);
    console.warn("[fflogs-fights] read error:", err);
    return [];
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

/**
 * 同期台帳のうち失敗しているものを返す (UI に「取り込めていない report」を
 * 出すため)。全件が正常なら空配列。
 */
export async function fetchFailedReportSyncs(
  categoryId: string,
): Promise<Array<{ reportCode: string; reason: string | null }>> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("fflogs_report_syncs")
      .select("report_code, reason")
      .eq("category_id", categoryId)
      .eq("ok", false)
      .limit(20);
    if (error || !data) return [];
    return data.map((r) => ({
      reportCode: r.report_code as string,
      reason: (r.reason as string | null) ?? null,
    }));
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
