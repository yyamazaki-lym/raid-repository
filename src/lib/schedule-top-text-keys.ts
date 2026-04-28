/**
 * `app_settings` テーブルで運用ルール / 注意事項の portal 側 override を
 * 保存するキー。
 *
 * 注意: このキー定数は server / client 両方から参照されるため、`"use client"`
 * 指令付きの `schedule-top-text-store.ts` ではなく独立した plain TS モジュールに
 * 配置している。`"use client"` ファイルからの非コンポーネント export は server
 * component 経由で Server Reference proxy に変換されてしまい、文字列として
 * 受け取れない (実際にこの問題で `fetchAppSetting()` が常に null を返す
 * バグが発生したため独立化した — 1.9 (2026-04-28))。
 */
export const SCHEDULE_TOP_TEXT_OVERRIDE_KEY = "schedule_top_text_override";
