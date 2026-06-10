/**
 * TODO #81 (2.1, 2026-05-12) で導入した native スケジュール default 時刻
 * 周辺の定数を、server / client 両方の境界から import できるよう純粋な
 * `.ts` モジュールに切り出し (server-only ファイル `native-schedule-placeholders.ts`
 * は Client Component から import 不可、Next.js が build エラーを出す)。
 *
 * TODO #81 follow-up (2.6, 2026-06-10): CandidateDateDialog (Client) が
 * 時刻 input の初期値に使う `FALLBACK_DEFAULT_*` を必要としたため切り出し。
 * `native-schedule-placeholders.ts` (server) もこのファイルから re-import する。
 *
 * - `*_KEY`: `app_settings` テーブルの key 名 (DB に保存される文字列)
 * - `FALLBACK_DEFAULT_*`: app_settings に未設定 / 無効な値が入っているときの
 *   フォールバック (= 旧 hardcode 値そのまま)
 */

export const NATIVE_DEFAULT_START_TIME_KEY = "native_schedule_default_start_time";
export const NATIVE_DEFAULT_END_TIME_KEY = "native_schedule_default_end_time";

export const FALLBACK_DEFAULT_START_TIME = "21:00";
export const FALLBACK_DEFAULT_END_TIME = "23:00";
