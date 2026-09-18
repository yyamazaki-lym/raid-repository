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

/**
 * 同期式スケジュールの登録リスト (JSON)。2026-09-18 の複数スケジュール
 * 切替で追加。選択中の URL は従来どおり `SCHEDULE_URL_KEY` に置き、
 * ここはリスト (id / url / 表示名) だけを持つ。描画パスでは参照しない
 * ので `fetchPortalSettings()` の一括 SELECT には載せない。
 * 形式は `@/lib/schedule/registered-schedules` を参照。
 */
export const SCHEDULE_URLS_KEY = "schedule_urls";

/**
 * native モードで **表示中のスケジュール** の id (2026-09-18 段階 1)。
 *
 * 同期式の `SCHEDULE_URL_KEY` と同じ役割で、切替はこの 1 キーの差し替え。
 * 一覧は `native_schedules` テーブルが持つ。未設定 / 不正値のときは
 * `DEFAULT_NATIVE_SCHEDULE_ID` にフォールバックする (schema が既定行を
 * この固定 id で作る)。TOP 描画パスが読むので `fetchPortalSettings()` の
 * 一括 SELECT に載せる。
 */
export const NATIVE_ACTIVE_SCHEDULE_ID_KEY = "native_schedule_active_id";

/**
 * 既定スケジュールの固定 id。`supabase/schema.sql` 5e 章が同じ値で 1 行
 * 作り、既存セッションをこの id に寄せる。**両者は必ず一致させる。**
 */
export const DEFAULT_NATIVE_SCHEDULE_ID =
  "00000000-0000-0000-0000-0000000005e1";

/** スケジュール名の上限。`schema.sql` の CHECK (1..60) と揃える。 */
export const NATIVE_SCHEDULE_NAME_MAX = 60;

/** 登録できるスケジュールの数。同期式 (20) と揃える。 */
export const MAX_NATIVE_SCHEDULES = 20;

/** id が uuid の形をしているか (app_settings の値を信用しないための門番)。 */
export function isNativeScheduleId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value.trim(),
    )
  );
}
