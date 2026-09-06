/**
 * 表示言語 (2026-09-06、第 1 段)。
 *
 * - 言語は **ユーザーごと** の設定で、cookie `rr_locale` に持つ (固定全員で
 *   共有する app_settings ではない)。サーバーは cookie を読んで辞書を選び、
 *   `<html lang>` も追従する。URL にプレフィックスは付けない (既存リンクや
 *   Discord 通知の URL を壊さないため)。
 * - 既定は日本語。cookie が無い / 壊れているときも日本語。
 * - 第 1 段で日英化するのはログイン / 拒否 / ヘッダー / メインタブ /
 *   スケジュール画面の枠 (次回開催カード・予定表の見出しやトグル)。
 *   出欠 popover や設定の各セクション、他タブは第 2 段以降。
 */

export const LOCALES = ["ja", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "ja";
export const LOCALE_COOKIE = "rr_locale";
/** 1 年。設定なので長め (更新のたびに延びる)。 */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isLocale(v: unknown): v is Locale {
  return typeof v === "string" && (LOCALES as readonly string[]).includes(v);
}

export const LOCALE_LABELS: Record<Locale, string> = {
  ja: "日本語",
  en: "English",
};
