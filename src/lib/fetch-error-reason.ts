/**
 * `fetch` の失敗を、保存・表示してよい短い理由に直す (2026-10-01 監査の
 * 「要確認」項目の確定、純関数)。
 *
 * ⚠ **例外のメッセージをそのまま使わない。** Node (undici) はヘッダの値が
 * 不正なとき `Headers.append: "<値>" is an invalid header value.` を投げる
 * — **値がそのまま載る**。FFLogs の session cookie を載せる取得でこれを
 * 理由にすると、cookie に改行などが混ざっていた場合に、メンバー全員が読める
 * `fflogs_report_syncs.reason` や同期結果の表示に cookie が出る (実測で確認)。
 *
 * 返すのは固定の語と、ネットワーク層のエラーコード (`ECONNRESET` などの
 * 英大文字・数字・`_` だけ) に限る。
 *
 * `@/` を import しない純モジュール (scripts/check-fetch-error-reason.mjs)。
 */
export function fetchErrorReason(e: unknown): string {
  if (e && typeof e === "object") {
    const name = (e as { name?: unknown }).name;
    if (name === "TimeoutError") return "timeout";
    if (name === "AbortError") return "aborted";
    const message = (e as { message?: unknown }).message;
    if (name === "TypeError" && typeof message === "string" && /header/i.test(message)) {
      return "invalid request header";
    }
    const cause = (e as { cause?: unknown }).cause;
    const code =
      cause && typeof cause === "object" ? (cause as { code?: unknown }).code : undefined;
    if (typeof code === "string" && /^[A-Z0-9_]{2,40}$/.test(code)) {
      return `fetch failed (${code})`;
    }
  }
  return "fetch failed";
}
