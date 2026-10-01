/**
 * コンテンツ (categories) とリンク (category_links) の文字数上限
 * (2026-10-01 監査 U-7)。
 *
 * ## 直した問題
 *
 * `categories.name` / `categories.description` と `category_links.title` /
 * `url` / `description` は、画面の `maxLength`・Server Action の検査・DB の
 * CHECK の**三層とも上限が無かった**。巨大な貼り付けで一覧の行・RSC の
 * 転送量・Realtime の配信が膨らむ。
 *
 * ## 上限の決め方
 *
 * DB の CHECK (`supabase/schema.sql` の `categories_text_sane` /
 * `category_links_text_sane`) と同じ値をここに置き、画面と Server Action は
 * ここから読む。自動取り込み (Discord / Google フォト) は利用者に直させる
 * 機会が無いので、上限を超えたら**切り詰めて**保存する (`clampText`)。
 * 利用者が入力した値は切り詰めずにエラーで返す (黙って切ると入力が消える)。
 *
 * 値は「実データが届かない余裕のある上限」。YouTube のタイトルは最大 100 字、
 * ページの og:title も通常は数十字なので、普段の取り込みには影響しない。
 *
 * ⚠ import を持たない純モジュール (`scripts/check-text-limits.mjs` が
 *   単体コンパイルして検査し、schema の CHECK と値を突き合わせる)。
 */

export const CATEGORY_NAME_MAX = 200;
export const CATEGORY_DESCRIPTION_MAX = 4000;
export const LINK_TITLE_MAX = 1000;
export const LINK_URL_MAX = 4096;
export const LINK_DESCRIPTION_MAX = 4000;

/**
 * `max` 文字 (コードポイント) を超えていたら切り詰める。
 *
 * ⚠ `String#slice` だとサロゲートペア (絵文字) の途中で切れて、片割れの
 * サロゲートが残る (Postgres の UTF-8 に入らず保存が失敗する)。コード
 * ポイント単位で数え、DB の `char_length` と同じ単位にする。
 */
export function clampText(value: string, max: number): string {
  if (value.length <= max) return value;
  const chars = Array.from(value);
  return chars.length <= max ? value : chars.slice(0, max).join("");
}
