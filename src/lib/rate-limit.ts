/**
 * TODO #40 (2.1): proxy.ts 用のシンプルな in-memory rate limiter。
 *
 * Discord OAuth callback と cron endpoint に連続リクエストが来ると
 * Discord API quota (120/min) が枯渇し、サイト全体の OAuth 機能が
 * 止まるリスクがあるため、最小限の防御として実装。
 *
 * 制限:
 *   - Vercel function instance 跨ぎでは状態を共有しないため、
 *     instance が複数立ち上がる本番では実質「per-instance per-IP」
 *     の rate limit になる。完全な分散 rate limit は Upstash Redis
 *     等が必要だが、本 TODO はシンプル版で十分という判断 (HANDOFF)。
 *   - in-memory Map は同 instance のリクエスト間でのみ共有される。
 *     proxy.ts は Node.js runtime デフォルトなので Edge より sticky。
 *
 * 戦略: 固定ウィンドウ (sliding ではない) — 軽量で十分。攻撃者が
 * ウィンドウの境界をまたいで bursty に来た場合の最大は `2 * limit`
 * req / window。本用途では問題にならない。
 */

type Bucket = {
  count: number;
  /** Wall-clock ms when this bucket should reset to 0. */
  resetAt: number;
};

const buckets = new Map<string, Bucket>();

/**
 * 古いエントリを除去 (memory leak 防止)。Map のサイズが閾値を超えたら
 * resetAt が過去のものを掃く。proxy.ts はリクエスト毎に呼ばれるので
 * 自然な GC 機会になる。
 */
const MAX_BUCKETS = 5_000;
function maybeCleanup(now: number) {
  if (buckets.size < MAX_BUCKETS) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export type RateLimitResult = {
  /** True iff the request is within the limit. */
  allowed: boolean;
  /** Seconds until the bucket resets — only meaningful when blocked. */
  retryAfterSeconds: number;
};

/**
 * 固定ウィンドウ rate limit。`scope` で route group を分け、`identifier`
 * (通常は IP) ごとに独立カウンタ。
 *
 * @param limit    1 ウィンドウあたりの許容回数
 * @param windowMs ウィンドウ長 (ms)
 */
export function checkRateLimit(
  scope: string,
  identifier: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  maybeCleanup(now);
  const key = `${scope}:${identifier}`;
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

/**
 * Vercel / 一般的な reverse proxy 配下から client IP を抽出。
 * `x-forwarded-for` の先頭エントリ (originating client) を採用。
 * fallback は `x-real-ip` → 空文字 (=共有 bucket になる、暴走を防ぐ
 * 観点では fail-closed)。
 */
export function clientIpFromHeaders(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = headers.get("x-real-ip");
  if (real && real.trim()) return real.trim();
  return "unknown";
}
