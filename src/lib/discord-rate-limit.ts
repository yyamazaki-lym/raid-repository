/**
 * Discord REST のレート制限応答の読み取り (純関数、2026-10-01 監査 C-9)。
 *
 * これまで Discord が 429 を返すと、取り込みはそのチャンネルを「失敗」で
 * 終え、通知 3 本 (日程・催促・練習ログ) は投稿を落としていた。429 は
 * 「処理していない」の意味なので、指定された時間だけ待てば同じ要求を
 * 送り直してよい (POST でも二重投稿にならない)。
 *
 * - 待ち時間は本文の `retry_after` (秒、小数あり) を優先し、無ければ
 *   `Retry-After` ヘッダ (秒) を読む
 * - 再試行は 1 回だけ。待ち時間が上限を超える (= global 制限で長く
 *   止められている) か、待つと締切を越えるなら、送り直さずに失敗として返す
 * - 成功応答でもバケットの残りが 0 なら、次の要求の前に `reset-after`
 *   だけ待つ (取り込みのページ送り用。上限つき)
 *
 * `@/` を import しない純モジュール (scripts/check-discord-import-budget.mjs
 * が tsc で単体コンパイルして境界を確かめる)。
 */

/** 429 のあと送り直すまでに待ってよい上限。これを超える指示なら諦める。 */
export const DISCORD_RETRY_MAX_WAIT_MS = 10_000;

/** バケット残り 0 のときに次の要求の前で待つ上限。 */
export const DISCORD_PREEMPTIVE_WAIT_CAP_MS = 5_000;

function parseSeconds(v: string | null): number | null {
  if (v === null) return null;
  const t = v.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * 429 応答から待ち時間 (ms、切り上げ) を読む。読めなければ null。
 * `bodyRetryAfter` は応答本文 JSON の `retry_after` をそのまま渡す。
 */
export function retryAfterMsFrom429(
  bodyRetryAfter: unknown,
  headerRetryAfter: string | null,
): number | null {
  const fromBody =
    typeof bodyRetryAfter === "number" &&
    Number.isFinite(bodyRetryAfter) &&
    bodyRetryAfter >= 0
      ? bodyRetryAfter
      : null;
  const sec = fromBody ?? parseSeconds(headerRetryAfter);
  if (sec === null) return null;
  return Math.ceil(sec * 1000);
}

/**
 * 429 のあと 1 回だけ送り直してよいか。待ち時間が読めて、上限以内で、
 * 待ち終わっても締切の手前であること。
 */
export function shouldRetryAfter429(
  waitMs: number | null,
  opts: { maxWaitMs: number; remainingMs: number },
): boolean {
  if (waitMs === null) return false;
  if (waitMs > opts.maxWaitMs) return false;
  return waitMs < opts.remainingMs;
}

/**
 * 成功応答の `X-RateLimit-Remaining` が 0 なら、次の要求の前に待つ ms。
 * 残りがある・ヘッダが無い・読めないときは 0。上限 `capMs` で頭打ち。
 */
export function preemptiveWaitMs(
  remaining: string | null,
  resetAfter: string | null,
  capMs: number,
): number {
  if (remaining === null || remaining.trim() !== "0") return 0;
  const sec = parseSeconds(resetAfter);
  if (sec === null) return 0;
  return Math.min(Math.ceil(sec * 1000), capMs);
}
