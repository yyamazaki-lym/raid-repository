/**
 * Realtime 購読の「戻ってきたときに取り直すか」の判定 (2026-10-01 監査 U-5)。
 *
 * ## 直した問題
 *
 * Supabase Realtime は、切れている間に起きた変更を**後から再送しない**。
 * スマホでポータルを背面に回す / PC がスリープする / 回線が落ちると
 * WebSocket が切れ、戻ったときに再接続はするが、その間の日付メモ・
 * リンク・マクロ・カテゴリなどの変更は画面に届かない。購読フックは購読エラー (CHANNEL_ERROR /
 * TIMED_OUT / CLOSED) のときだけ 1 回取り直していたので、エラーにならずに
 * 静かに再接続した場合は、次に誰かが変更するかリロードするまで古いまま
 * 表示し続けた (`visibilitychange` / `online` を見ているコードは 0 件だった)。
 *
 * ## 方針
 *
 * - `online` (回線が戻った) は必ず取り直す
 * - タブが見えるようになったときは、**一定時間以上隠れていた場合だけ**
 *   取り直す。タブを一瞬切り替えただけで毎回全フックが SELECT し直すのを
 *   避ける (隠れている間も短時間なら WebSocket は生きている)
 *
 * ⚠ このファイルは import を持たない純モジュール
 *   (`scripts/check-realtime-resume.mjs` が単体コンパイルして検査する)。
 */

/** これ以上隠れていたら、見えるようになったときに取り直す。 */
export const RESUME_REFETCH_MIN_HIDDEN_MS = 30_000;

/**
 * タブが見えるようになった時点で取り直すか。`hiddenAtMs` は隠れた時刻
 * (隠れていなかった / 不明なら null)。
 */
export function shouldRefetchOnVisible(
  hiddenAtMs: number | null,
  nowMs: number,
  minHiddenMs: number = RESUME_REFETCH_MIN_HIDDEN_MS,
): boolean {
  if (hiddenAtMs === null || !Number.isFinite(hiddenAtMs)) return false;
  return nowMs - hiddenAtMs >= minHiddenMs;
}
