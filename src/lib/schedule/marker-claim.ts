/**
 * 「送ったら印を付ける」二重送信防止を、**先に印を取ってから送る**順へ
 * 反転するための取り合いロジック (2026-10-01 監査 C-4)。
 *
 * 出欠催促 (`attendance-reminder.ts`) は `app_settings` の 1 行 (key = 印の
 * 置き場、value = 送信済みの印) で二重送信を止めている。以前は
 * 「印を読む → Discord へ送る → 印を書く」の順だったため、同じ分に 2 回
 * 起動されると両方が古い印を読んで両方送った (本番と公開デモの pg_cron が
 * 同じ本番 route を毎時 0 分に叩いていた)。開催確定の通知 (native の
 * `last_notified_at`) は 2026-06 に先取りへ直してあり、こちらだけ残っていた。
 *
 * 1 行に対する条件付き書き込みは Postgres の行ロックで直列化される。
 * 後から来た方は先の書き込みが確定してから条件を評価し直すので、
 * 同じ印を 2 回取ることはない。
 *
 * ⚠ このファイルは `@/` エイリアスも Supabase も import しない純モジュール
 *   (`scripts/check-marker-claim.mjs` が偽の行で取り合いを再現して検査する)。
 */

export type MarkerClaimOps = {
  /** 行があり、値が NULL でも印でもないとき印に書き換える。書き換えたら true。 */
  replaceDifferent: () => Promise<boolean>;
  /** 行があり、値が NULL のとき印に書き換える。書き換えたら true。 */
  replaceNull: () => Promise<boolean>;
  /** 行が無いとき印で作る (既にあれば何もしない)。作ったら true。 */
  insertIfAbsent: () => Promise<boolean>;
};

/**
 * 印を取れたら true。false は「既に同じ印が付いている = 送信済み」。
 * 各操作の DB エラーは throw させ、呼び出し側で送信しない扱いにする
 * (取れたか分からないまま送ると二重送信に戻る)。
 *
 * 3 段に分けるのは、PostgREST のフィルタで `value IS DISTINCT FROM 印` を
 * 1 回で書けないため (`neq` は NULL の行に当たらない / `or` は印の文字列に
 * 括弧や記号が入るので引用が要る)。どの段も条件付きの 1 文なので、
 * 段の間に別の実行が割り込んでも同じ印を 2 回取ることはない。
 */
export async function claimMarker(ops: MarkerClaimOps): Promise<boolean> {
  if (await ops.replaceDifferent()) return true;
  if (await ops.replaceNull()) return true;
  return ops.insertIfAbsent();
}
