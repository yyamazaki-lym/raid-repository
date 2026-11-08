import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "./server";
import { parseManualSegments, type ManualDay } from "@/lib/practice-log-manual";

/**
 * 練習ログの手動の記録 (2026-11-08、schema.sql 6b-13) の読み取り。
 * 書き込みは `src/lib/server/practice-log-manual-actions.ts` (admin)。
 */

/** 読む列。週のまとめ (service role) も同じ列で読む。 */
export const MANUAL_DAY_COLUMNS = "id, session_date, segments, log_minutes, note";

/** 1 行を `ManualDay` に。区間が 1 つも読めない行は捨てる (null)。 */
export function rowToManualDay(r: Record<string, unknown>): ManualDay | null {
  const date = typeof r.session_date === "string" ? r.session_date : null;
  if (!date) return null;
  const segments = parseManualSegments(r.segments);
  if (segments.length === 0) return null;
  const minutes = r.log_minutes === null || r.log_minutes === undefined ? null : Number(r.log_minutes);
  return {
    id: String(r.id),
    date,
    segments,
    logMinutes: minutes !== null && Number.isFinite(minutes) && minutes > 0 ? minutes : null,
    note: typeof r.note === "string" && r.note.length > 0 ? r.note : null,
  };
}

/**
 * 1 コンテンツの手動の記録 (新しい日から)。1 日 1 行なので数年でも数百行
 * (PostgREST の 1000 行の上限には、毎日記録しても 2 年半かかる)。
 */
export async function fetchManualDaysWith(
  supabase: SupabaseClient,
  categoryId: string,
): Promise<ManualDay[] | null> {
  const { data, error } = await supabase
    .from("practice_log_manual_days")
    .select(MANUAL_DAY_COLUMNS)
    .eq("category_id", categoryId)
    .order("session_date", { ascending: false })
    .limit(1000);
  if (error || !data) {
    console.warn("[practice-log-manual] read failed:", error?.message);
    return null;
  }
  return (data as Array<Record<string, unknown>>)
    .map(rowToManualDay)
    .filter((d): d is ManualDay => d !== null);
}

/** 練習ログの画面用 (見る人のクライアント = RLS が効く)。失敗したら空。 */
export async function fetchCategoryManualDays(categoryId: string): Promise<ManualDay[]> {
  try {
    const supabase = await createClient();
    return (await fetchManualDaysWith(supabase as unknown as SupabaseClient, categoryId)) ?? [];
  } catch (err) {
    rethrowNextSentinel(err);
    console.warn("[practice-log-manual] read error:", err);
    return [];
  }
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
