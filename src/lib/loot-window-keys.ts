/**
 * 週制限の「消化ウィンドウ」設定キー (W-33 ②、2026-09-07)。
 *
 * `app_settings` のキーだけをここに置く (値の読み書きは server 側)。
 * `settings-keys.ts` / `native-defaults.ts` と同じ理由で独立モジュール:
 * client component からもキー名を参照したいが、`app-settings.ts` は
 * `server-only` なので import できない。
 */

/**
 * 何週分を「まだ消化できる週」として開けておくか。値は `"1"` または `"2"`。
 *
 * - `1` (既定 / 7.x): 今週だけ。火曜 17:00 JST を過ぎたら前週は締める。
 * - `2` (8.0 以降): 今週 + 前週。8.0「白銀のワンダラー」ではアラガン
 *   トームストーンが **2 週管理**になり、前週分を遡って取得できる
 *   (調査ノート第 4 回 5-2)。前週の行を開けたままにして、遡り取得を
 *   記録できるようにする。
 *
 * 8.0 の仕様が実装で確認できるのは 2027-01 なので、**設定値**にして
 * 切り替えられる形にしてある (コード側に日付を焼き込まない)。
 */
export const LOOT_WINDOW_WEEKS_KEY = "loot_window_weeks";

/** 未設定時の値 (7.x の挙動)。 */
export const LOOT_WINDOW_WEEKS_DEFAULT = 1;

/** 設定できる上限。2 週より広げる需要は今のところ無い。 */
export const LOOT_WINDOW_WEEKS_MAX = 2;

/**
 * `app_settings` の生値 (文字列 / null) を週数に正規化する。
 * 不正値・未設定は既定 (1) に倒す — 消化チェックは開催前に見る画面なので、
 * 設定ミスで画面が壊れるより従来挙動で出る方が安全。
 */
export function parseLootWindowWeeks(raw: string | null | undefined): number {
  const n = Number((raw ?? "").trim());
  if (!Number.isInteger(n)) return LOOT_WINDOW_WEEKS_DEFAULT;
  if (n < 1 || n > LOOT_WINDOW_WEEKS_MAX) return LOOT_WINDOW_WEEKS_DEFAULT;
  return n;
}
