import { extractDateFromTitle } from "@/lib/title-date";

/**
 * 動画 (category_links kind='video') の「JST 暦日」解決を一元化する
 * pure モジュール (2026-07-12、日付登録 Logs ↔ 動画の橋渡し対応)。
 *
 * 従来この解決ロジックは `session-video-link.ts` (TOP の動画紐付け表示)
 * にインラインで存在した。日付から登録した FFLogs URL を同日の動画へ
 * 橋渡しする `session-logs-video-bridge.ts` が「TOP の表示と完全に同じ
 * 同日判定」を必要とするため、ここに移設して両者で共有する。
 * (`extractDateFromTitle` を title-date.ts へ切り出した 1.9.17 と同じ動機。)
 *
 * 注意: fflogs.ts の auto マッチャにも同型の `jstCalendarDate` が存在する
 * が、auto はタイトル日付必須 (posted_at fallback なし) の strict 仕様で
 * 意図的に別物。統合は退行面積が広がるため見送り (2026-07-12)。
 */

export type JstYmd = { y: number; m: number; d: number };

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * posted_at プリフィルタの緩衝幅 (TODO #55)。セッション/対象日の
 * posted_at 範囲クエリに使う。uploadDate と raid 日が稀にずれる分
 * (翌日以降のアップロード・タイトル日付とのずれ) を吸収する余白。
 */
export const VIDEO_POSTED_AT_BUFFER_MS = 7 * 24 * 60 * 60 * 1000;

/** Convert a UTC instant to its JST calendar Y/M/D. */
export function toJstYmd(ms: number): JstYmd {
  const j = new Date(ms + JST_OFFSET_MS);
  return {
    y: j.getUTCFullYear(),
    m: j.getUTCMonth() + 1,
    d: j.getUTCDate(),
  };
}

/** Map キー用の "y-m-d" 文字列 (ゼロ埋めなし、両側で同関数を使う前提)。 */
export function jstYmdKey(d: JstYmd): string {
  return `${d.y}-${d.m}-${d.d}`;
}

/**
 * 動画 1 行の JST 暦日解決 (優先順位は docstring 参照):
 *   1. `extractDateFromTitle(title)` — タイトル内に書かれた日付
 *      (ユーザーが手で書く raid date なので最も信頼できる)。
 *      年なし形式 ("4/1") には posted_at の JST 年をヒントに使う。
 *   2. `posted_at` の JST 暦日 — アップロード/投稿日時 fallback。
 *   3. どちらも無ければ null (= 日付ベースの紐付け対象外。created_at は
 *      単なる DB 行作成時刻で信頼性が低いため使わない)。
 */
export function resolveVideoJstYmd(
  title: string | null | undefined,
  postedAt: string | null,
): JstYmd | null {
  const postedMs = postedAt ? new Date(postedAt).getTime() : NaN;
  const postedJst = Number.isNaN(postedMs) ? null : toJstYmd(postedMs);
  const titleD = extractDateFromTitle(title ?? "", postedJst?.y);
  return titleD ?? postedJst;
}
