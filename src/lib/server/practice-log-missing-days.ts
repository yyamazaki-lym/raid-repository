import "server-only";

import { unstable_cache } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createClient,
  createSupabaseServiceRoleClient,
} from "@/lib/supabase/server";
import { jstYmdString } from "@/lib/jst-date";
import { getScheduleSourceMode } from "@/lib/schedule/source-mode";
import { planPastSessionMerge } from "@/lib/schedule/past-session-dedup";
import {
  missingPracticeDays,
  readAllPages,
  type HeldScheduleDay,
  type MissingDaysResult,
  type PracticeDayRef,
} from "@/lib/practice-log-manual";

/**
 * 練習ログの「ログが欠けている日」(2026-11-08)。
 *
 * 判定は純関数 `missingPracticeDays` (`src/lib/practice-log-manual.ts`)。ここは
 * 3 つを読んで渡すだけ:
 *
 *   1. スケジュールの開催日 — 自前作成式は確定 (DECISION) で有志練習でない日
 *      (全スケジュール。出席サマリーと同じ母数)、同期式は過去の日程から除外した
 *      日を外し、時刻違いの重複をまとめたもの (`planPastSessionMerge`)
 *   2. ログのある日 — 全コンテンツ (`practice_log_days`、schema.sql 13c-5)
 *   3. 手動の記録のある日 — 全コンテンツ
 *
 * 読むのは 1 年前から (それより古い欠けは表示しない。1000 行の上限にも当たらない)。
 *
 * ## 公開デモ
 *
 * `practice_log_days` はデモでは service_role にしか配らない (schema.sql 15 章。
 * スパークラインと同じ)。デモでは見る人に関係なくサーバーが service role で
 * 計算し、Data Cache に 60 秒置く (`category-progress.ts` と同じ)。デモの表は
 * 誰にでも全行開いているので見える範囲は変わらない。
 */

/** 遡る日数。 */
const WINDOW_DAYS = 365;
/** 公開デモの共有キャッシュの秒数。 */
const DEMO_CACHE_SECONDS = 60;

type Db = SupabaseClient;
type ScheduleMode = "sync" | "native";

function isPublicDemo(): boolean {
  return process.env.PUBLIC_DEMO_MODE === "true";
}

/** 欠けている日。読めなければ null (画面はカードを出さない)。 */
export async function fetchMissingPracticeDays(
  categoryId: string,
): Promise<MissingDaysResult | null> {
  try {
    const mode = await getScheduleSourceMode();
    if (mode === "disabled") return null;
    const today = jstYmdString(new Date());
    if (isPublicDemo()) return await demoCache(categoryId, mode, today);
    return await computeWith(
      (await createClient()) as unknown as Db,
      categoryId,
      mode,
      today,
    );
  } catch (err) {
    rethrowNextSentinel(err);
    console.warn("[practice-log-missing-days] failed:", err);
    return null;
  }
}

/** 公開デモ: 引数 (コンテンツ・モード・今日) ごとに 60 秒置く。失敗 (null) も置く。 */
const demoCache = unstable_cache(
  async (categoryId: string, mode: ScheduleMode, today: string) =>
    computeWith(createSupabaseServiceRoleClient() as unknown as Db, categoryId, mode, today),
  ["practice-log-missing-days-demo"],
  { revalidate: DEMO_CACHE_SECONDS },
);

/**
 * 読み取りと判定の本体。⚠ cookie / headers を読まないこと — デモでは
 * `unstable_cache` の中で呼ぶ。
 */
async function computeWith(
  db: Db,
  categoryId: string,
  mode: ScheduleMode,
  today: string,
): Promise<MissingDaysResult | null> {
  const from = jstYmdString(new Date(Date.now() - WINDOW_DAYS * 86_400_000));
  // 開催日は JST の暦日で判定するので、UTC の境目で落ちないよう 1 日広く読む。
  const fromIso = new Date(Date.now() - (WINDOW_DAYS + 1) * 86_400_000).toISOString();
  const nowIso = new Date().toISOString();

  // ⚠ どちらも 1000 行の上限で切れないようページで読み切る (2026-11-09、レビューで
  // 検出)。以前は 1 回で読んでいたので、コンテンツ × 日が 1000 行を超えると古い日の
  // 「ログがある」が抜け、ログのある開催日が欠けている日に出た。並び順は
  // practice_log_days の ORDER BY (day DESC, category_id) と、下の order で決める。
  const [daysRes, manualRes, held] = await Promise.all([
    readAllPages<{ category_id: string | null; day: string }>((lo, hi) =>
      db
        .rpc("practice_log_days", { p_from: from })
        .range(lo, hi)
        .then((r) => ({ rows: r.data as Array<{ category_id: string | null; day: string }> | null, error: r.error })),
    ),
    readAllPages<{ category_id: string; session_date: string }>((lo, hi) =>
      db
        .from("practice_log_manual_days")
        .select("category_id, session_date")
        .gte("session_date", from)
        .order("session_date", { ascending: false })
        .order("category_id", { ascending: true })
        .range(lo, hi)
        .then((r) => ({ rows: r.data as Array<{ category_id: string; session_date: string }> | null, error: r.error })),
    ),
    readHeldDays(db, mode, fromIso, nowIso),
  ]);
  // ⚠ 読み取りの失敗・読み切れなかったときを「ログが無い」と扱わない (全部の
  // 開催日が欠けて見える)。
  if (
    daysRes.error ||
    daysRes.truncated ||
    manualRes.error ||
    manualRes.truncated ||
    held === null
  ) {
    console.warn("[practice-log-missing-days] read failed:", {
      days: daysRes.error ?? (daysRes.truncated ? "truncated" : null),
      manual: manualRes.error ?? (manualRes.truncated ? "truncated" : null),
      schedule: held === null,
    });
    return null;
  }
  const practiceDays: PracticeDayRef[] = [
    ...daysRes.rows.map((r) => ({ categoryId: r.category_id ?? null, date: r.day })),
    ...manualRes.rows.map((r) => ({ categoryId: r.category_id, date: r.session_date })),
  ];
  return missingPracticeDays({ categoryId, heldDays: held, practiceDays, today });
}

/** 開催日 (確定・中止でない・有志練習でない)。読めなければ null。 */
async function readHeldDays(
  db: Db,
  mode: ScheduleMode,
  fromIso: string,
  nowIso: string,
): Promise<HeldScheduleDay[] | null> {
  if (mode === "native") {
    const { data, error } = await db
      .from("native_schedule_sessions")
      .select("raw_date, parsed_date, status, is_optional")
      .eq("status", "DECISION")
      .gte("parsed_date", fromIso)
      .lte("parsed_date", nowIso)
      .order("parsed_date", { ascending: false })
      .limit(1000);
    if (error) return null;
    return ((data ?? []) as Array<{ raw_date: string; parsed_date: string; is_optional?: boolean }>)
      .filter((r) => r.is_optional !== true)
      .map((r) => ({ date: jstYmdString(new Date(r.parsed_date)), label: r.raw_date }));
  }
  // 同期式: 出席サマリー (`attendance-summary-actions.ts`) と同じ読み方。除外した
  // 行と、除外した行と同じ開催 (時刻違いの重複) は数えず、同じ開催は 1 つにまとめる。
  const { data, error } = await db
    .from("schedule_past_sessions")
    .select("raw_date, parsed_date, attendances, start_time, end_time, source, created_at, excluded_at")
    .gte("parsed_date", fromIso)
    .lte("parsed_date", nowIso)
    .order("parsed_date", { ascending: false })
    .limit(1000);
  if (error) return null;
  const rows = (data ?? []) as Array<{
    raw_date: string;
    parsed_date: string;
    attendances: Record<string, string> | null;
    start_time: string | null;
    end_time: string | null;
    source: string | null;
    created_at: string | null;
    excluded_at: string | null;
  }>;
  const keep = new Set(
    planPastSessionMerge({
      sheet: [],
      excluded: rows
        .filter((r) => !!r.excluded_at)
        .map((r) => ({
          rawDate: r.raw_date,
          startMs: new Date(r.parsed_date).getTime(),
          startTime: r.start_time ?? "",
          endTime: r.end_time ?? "",
        })),
      stored: rows
        .filter((r) => !r.excluded_at)
        .map((r) => ({
          rawDate: r.raw_date,
          startMs: new Date(r.parsed_date).getTime(),
          startTime: r.start_time ?? "",
          endTime: r.end_time ?? "",
          hasAttendances: !!r.attendances && Object.keys(r.attendances).length > 0,
          createdAt: r.created_at ?? null,
          source: r.source ?? null,
        })),
    }).additions.map((c) => c.rawDate),
  );
  return rows
    .filter((r) => keep.has(r.raw_date))
    .map((r) => ({ date: jstYmdString(new Date(r.parsed_date)), label: r.raw_date }));
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
