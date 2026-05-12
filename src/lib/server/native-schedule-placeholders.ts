import "server-only";

import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

/**
 * TODO #81 (2.1, 2026-05-12): native スケジュール経路で、当月分の row が
 * `native_schedule_sessions` に 1 件も無くても「当月全日付」が upcoming
 * セクションに並ぶようにするための auto-insert util。
 *
 * `page.tsx` の native ブランチで `fetchNativeSchedule()` の前に呼ばれ、
 * 「JST 今日 0:00 〜 当月末日」(+ 当月末日まで残り 7 日以内なら翌月分も) の
 * 日付に対して不足分の placeholder row を bulk upsert する。
 *
 * # 設計判断
 *
 * - **rawDate format**: sync 互換 `YYYY/MM/DD(曜) HH:MM~HH:MM` を採用
 *   ([candidate-date-dialog.tsx:91-105](src/components/portal/native-schedule/candidate-date-dialog.tsx:91)
 *   と同式)。`schedule_session_memos` / `schedule_past_session_logs` が
 *   rawDate を join key にしているので、sync 経路と key 空間を共有できる。
 * - **start_time / end_time**: 2.1 (2026-05-12) で **placeholder は NULL を
 *   入れる**運用に変更。NULL = `app_settings.native_schedule_default_{start,end}_time`
 *   を表示時にフォールバック (fetchNativeSchedule / buildMessage で COALESCE)。
 *   日個別 override が必要なら session-time-edit-popover で NOT NULL を書き込む。
 *   raw_date 文字列には default time を埋める (sync 経路と key 空間を共有する
 *   ためのフォーマット維持)。同一 raw_date で再投入時の上書きは **しない**
 *   (UNIQUE 制約 + `ignoreDuplicates`)。
 * - **過去日付は投入しない**: TODO #80 の cutoff (JST 今日 0:00) より前は
 *   upcoming に出ないため、auto-insert しても見えない。DB の gomi を避ける。
 * - **service_role 経由 (RLS バイパス)**: `native_schedule_sessions` への
 *   INSERT は `auth.jwt() -> app_metadata -> is_admin = 'true'` を要求する
 *   RLS だが、本関数は user 入力を受け取らず「当月日付 + app_settings の
 *   default time」だけで決定的に生成するため、admin gate を通さなくても
 *   悪用余地がない。非 admin user の page アクセス時にも placeholder を
 *   揃えたいため service_role で RLS バイパスする。
 * - **失敗は握りつぶし**: page render を止めないため、SELECT/INSERT エラーは
 *   `console.warn` のみで return。`DYNAMIC_SERVER_USAGE` / `NEXT_*` digest は
 *   再 throw する ([app-settings.ts:34-43](src/lib/supabase/app-settings.ts:34)
 *   と同パターン)。
 */

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

const DOW_LABELS = ["日", "月", "火", "水", "木", "金", "土"] as const;

/** 当月末日まで残り何日以内になったら翌月分も先行投入するか。 */
const PLACEHOLDER_PREMONTH_THRESHOLD_DAYS = 7;

export const NATIVE_DEFAULT_START_TIME_KEY = "native_schedule_default_start_time";
export const NATIVE_DEFAULT_END_TIME_KEY = "native_schedule_default_end_time";

export const FALLBACK_DEFAULT_START_TIME = "21:00";
export const FALLBACK_DEFAULT_END_TIME = "23:00";

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

type DefaultsInput = {
  startTime?: string | null;
  endTime?: string | null;
};

export async function ensureNativeMonthlyPlaceholders(
  defaults?: DefaultsInput,
): Promise<void> {
  // 1. app_settings 由来の default time を normalize (page.tsx 側の bulk fetch
  //    結果を注入してもらう前提)。不正値は fallback。
  const startTime =
    defaults?.startTime && TIME_RE.test(defaults.startTime)
      ? defaults.startTime
      : FALLBACK_DEFAULT_START_TIME;
  const endTime =
    defaults?.endTime && TIME_RE.test(defaults.endTime)
      ? defaults.endTime
      : FALLBACK_DEFAULT_END_TIME;

  // 2. JST 今日。`Date.now() + JST_OFFSET_MS` の UTC field をそのまま
  //    JST のカレンダー値として読む既存パターン
  //    (schedule-list.tsx:1768-1779, discord-schedule.ts:36)。
  const nowJst = new Date(Date.now() + JST_OFFSET_MS);
  const jstYear = nowJst.getUTCFullYear();
  const jstMonth = nowJst.getUTCMonth(); // 0-indexed
  const jstDay = nowJst.getUTCDate();

  // 3. 当月末日。Date.UTC(year, month+1, 0) で次月 0 日 = 当月末日。
  const currentMonthLastDay = new Date(
    Date.UTC(jstYear, jstMonth + 1, 0),
  ).getUTCDate();

  // 4. 翌月まで延長するか?
  const includeNextMonth =
    jstDay >= currentMonthLastDay - (PLACEHOLDER_PREMONTH_THRESHOLD_DAYS - 1);

  // 5. 候補日付配列。JST 今日 (jstDay) 〜 当月末日 + (条件付き) 翌月 1 日 〜 翌月末日。
  type Cand = { y: number; m: number; d: number };
  const candidates: Cand[] = [];
  for (let d = jstDay; d <= currentMonthLastDay; d++) {
    candidates.push({ y: jstYear, m: jstMonth, d });
  }
  if (includeNextMonth) {
    const nextYear = jstMonth === 11 ? jstYear + 1 : jstYear;
    const nextMonth = jstMonth === 11 ? 0 : jstMonth + 1;
    const nextMonthLastDay = new Date(
      Date.UTC(nextYear, nextMonth + 1, 0),
    ).getUTCDate();
    for (let d = 1; d <= nextMonthLastDay; d++) {
      candidates.push({ y: nextYear, m: nextMonth, d });
    }
  }

  if (candidates.length === 0) return;

  // 6. rawDate / parsedDate / day_of_week 組立 (CandidateDateDialog 同式)。
  const pad = (n: number) => String(n).padStart(2, "0");
  const [sh, sm] = startTime.split(":").map(Number);
  const rows = candidates.map((c) => {
    // 曜日: local-TZ Date でその日付の getDay() (CandidateDateDialog と同じ)。
    const dow = DOW_LABELS[new Date(c.y, c.m, c.d).getDay()] ?? "日";
    const rawDate = `${c.y}/${pad(c.m + 1)}/${pad(c.d)}(${dow}) ${startTime}~${endTime}`;
    // parsedDate: 開始時刻を JST で表した瞬間の UTC ISO string。
    const parsedDate = new Date(
      Date.UTC(c.y, c.m, c.d, sh, sm, 0, 0) - JST_OFFSET_MS,
    ).toISOString();
    return {
      raw_date: rawDate,
      parsed_date: parsedDate,
      // 2.1 (2026-05-12): start_time / end_time は NULL を入れて
      // app_settings の default に追従させる。日個別 override が必要なら
      // session-time-edit-popover で後から書き込む。
      start_time: null as string | null,
      end_time: null as string | null,
      day_of_week: dow,
      // status は schema default 'CANDIDATE'、note / created_by_id / last_notified_at は NULL。
    };
  });

  // 7. service_role client で bulk upsert。raw_date UNIQUE + ignoreDuplicates で
  //    既存 row (admin 手動追加 / CANCELLED 化済 / 既存 placeholder) は完全 skip。
  try {
    const supabase = createSupabaseServiceRoleClient();
    const { error } = await supabase
      .from("native_schedule_sessions")
      .upsert(rows, { onConflict: "raw_date", ignoreDuplicates: true });
    if (error) {
      console.warn("[native-placeholders] upsert error:", error.message);
    }
  } catch (err) {
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
    console.warn("[native-placeholders] unexpected error:", err);
  }
}
