import "server-only";
import {
  DISCORD_RETRY_MAX_WAIT_MS,
  retryAfterMsFrom429,
  shouldRetryAfter429,
} from "@/lib/discord-rate-limit";

/**
 * Discord REST を叩く共通の fetch (2026-10-01 監査 C-9)。
 *
 * 429 を受けたら `retry_after` だけ待って **1 回だけ** 送り直す。待ち時間が
 * 上限 (10 秒) を超える・読めない・待つと `deadlineAt` を越えるときは送り
 * 直さず、429 の応答をそのまま返す (呼び出し側の `!res.ok` 処理に乗る)。
 * 429 は「処理していない」の意味なので、POST を送り直しても二重投稿には
 * ならない。
 *
 * 1 回ごとに新しい timeout signal を作る (1 回目の signal を使い回すと、
 * 待っている間に 2 回目の持ち時間が削られる)。本文は文字列で受け取る
 * (送り直しで同じ本文を再送するため、stream は受け付けない)。
 */
export type DiscordFetchInit = {
  method?: "GET" | "POST";
  headers: Record<string, string>;
  body?: string;
  /** 1 回の要求の timeout。 */
  timeoutMs: number;
  /** これを越えて待たない (epoch ms)。省略時は締切なし。 */
  deadlineAt?: number;
};

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function discordFetch(
  url: string,
  init: DiscordFetchInit,
): Promise<Response> {
  const once = () =>
    fetch(url, {
      method: init.method ?? "GET",
      headers: init.headers,
      body: init.body,
      cache: "no-store",
      signal: AbortSignal.timeout(init.timeoutMs),
    });

  const first = await once();
  if (first.status !== 429) return first;

  const text = await first.text().catch(() => "");
  let bodyRetryAfter: unknown = null;
  try {
    bodyRetryAfter = (JSON.parse(text) as { retry_after?: unknown })
      .retry_after;
  } catch {
    // 本文が JSON でなければヘッダだけで判断する
  }
  const waitMs = retryAfterMsFrom429(
    bodyRetryAfter,
    first.headers.get("retry-after"),
  );
  const remainingMs =
    init.deadlineAt === undefined
      ? Number.POSITIVE_INFINITY
      : init.deadlineAt - Date.now();
  // 本文は読み終えたので、呼び出し側が読めるよう作り直して返す。
  const as429 = () =>
    new Response(text, { status: 429, headers: first.headers });
  if (
    !shouldRetryAfter429(waitMs, {
      maxWaitMs: DISCORD_RETRY_MAX_WAIT_MS,
      remainingMs,
    })
  ) {
    console.warn("[discord-api] 429, not retrying", {
      path: new URL(url).pathname,
      waitMs,
    });
    return as429();
  }
  console.warn("[discord-api] 429, retrying once", {
    path: new URL(url).pathname,
    waitMs,
  });
  await sleep(waitMs!);
  return once();
}
