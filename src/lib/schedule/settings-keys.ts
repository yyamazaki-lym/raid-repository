/**
 * スケジュール機能まわりの `app_settings` キー定数 (2026-07-12 監査 A-2)。
 *
 * `schedule-top-text-keys.ts` / `native-defaults.ts` と同じ理由の独立純定数
 * モジュール: server-only ファイル (`source-mode.ts` 等) や "use client"
 * ファイルからの再 export は import 境界の制約を踏むため、どちらの境界からも
 * 安全に import できる plain TS に置く。
 *
 * `fetchPortalSettings()` (app-settings.ts) が TOP 描画で必要な全キーを
 * 1 SELECT に束ねるため、キー文字列をここへ集約した。
 */

export const SCHEDULE_SOURCE_MODE_KEY = "schedule_source_mode";

export const SCHEDULE_URL_KEY = "schedule_url";

/** 凡例 (出欠選択肢) マスターの CSV。native モードのみ参照。 */
export const NATIVE_CHOICE_VALUES_KEY = "native_schedule_choice_values";
