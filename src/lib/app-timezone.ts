/**
 * アプリの基準タイムゾーン (2026-10-01 監査 U-9)。
 *
 * 日付の扱いはすべて「この TZ の暦日・壁時計」が基準 (raid の開催日、
 * 週制限の区切り、動画タイトルの日付、Discord 通知の時刻)。これまで
 * `9 * 60 * 60 * 1000` が 13 ファイル、`"Asia/Tokyo"` が 8 箇所、`+09:00` が
 * 3 箇所に散っていて、日本以外で運用する fork は 25 箇所前後を手で探して
 * 直す必要があった。ここを唯一の定義にする (`scripts/check-app-timezone.mjs`
 * が、ほかの場所での再定義を止める)。
 *
 * ⚠ **固定オフセット前提。** 多くの計算は「UTC ms + オフセット → getUTC*」で
 * 暦日を出すので、夏時間 (DST) のある TZ に変えると切り替え日の前後で
 * 1 時間ずれる。変えてよいのは DST の無い TZ だけで、3 つの値は互いに一致
 * させること。DB 側 (`supabase/schema.sql` の `AT TIME ZONE 'Asia/Tokyo'`) と
 * `vercel.json` の cron 時刻 (UTC 表記、コメントが JST) はここでは変わらない
 * ので別に直す。関数名・変数名の `jst` は歴史的な名前で、意味は「アプリの TZ」。
 *
 * `@/` を import しない純モジュール (check スクリプトが単体でコンパイルする
 * 純モジュールからも相対 import で使う)。
 */

/** `Intl.DateTimeFormat` の `timeZone` に渡す IANA 名。 */
export const APP_TIME_ZONE = "Asia/Tokyo";

/** UTC からのずれ (ms)。`APP_TIME_ZONE` と一致させる。 */
export const APP_UTC_OFFSET_MS = 9 * 60 * 60 * 1000;

/** ISO 8601 のオフセット表記 (`YYYY-MM-DDTHH:mm:ss` に付けて解釈する)。 */
export const APP_UTC_OFFSET_ISO = "+09:00";
