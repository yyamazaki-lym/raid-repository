/**
 * TODO #40 (2.1) → TODO #82 (2.4, 2026-06-09): proxy.ts 用の rate limiter。
 *
 * Discord OAuth callback と cron endpoint に連続リクエストが来ると
 * Discord API quota (120/min) が枯渇し、サイト全体の OAuth 機能が
 * 止まるリスクがあるため、最小限の防御として実装。
 *
 * バックエンド戦略 (TODO #82):
 *   - **Upstash Redis** が利用可能なら分散 fixed-window を採用
 *     (`@upstash/ratelimit` の `fixedWindow` algorithm)。Vercel Fluid
 *     Compute は instance 跨ぎで状態を共有しないため、分散 store を
 *     入れないと instance 数 × limit まで実効的に緩んでいた。
 *   - env 未設定 / Redis 呼び出し失敗時は **in-memory fallback** に
 *     graceful degrade。fork ユーザーが Vercel Marketplace で Upstash
 *     を入れる前 (= TODO #82 適用初期) でも従来挙動が壊れないように。
 *
 * 制限:
 *   - in-memory fallback 経路では従来通り「per-instance per-IP」になる。
 *     完全な分散 rate limit は Upstash 経路でのみ得られる。
 *   - 固定ウィンドウ (sliding ではない) — 軽量で十分。攻撃者が
 *     ウィンドウの境界をまたいで bursty に来た場合の最大は
 *     `2 * limit` req / window。本用途では問題にならない。
 *
 * Vercel Marketplace 連携手順 (ユーザー側 1 回作業):
 *   1. Vercel Dashboard → 該当プロジェクト → Storage → Browse Marketplace
 *   2. 「Upstash for Redis」を選択して Connect (旧 Vercel KV 後継)
 *   3. 環境 (Production / Preview / Development) を選んで Add
 *   4. `KV_REST_API_URL` / `KV_REST_API_TOKEN` が自動で env に注入される
 *      (本実装は KV_* / UPSTASH_REDIS_REST_* の両 prefix に対応)
 *
 * 対応 env (どちらでも動く):
 *   - `KV_REST_API_URL` / `KV_REST_API_TOKEN` (Vercel Marketplace
 *     「Upstash for Redis」が注入する prefix、旧 Vercel KV 後継)
 *   - `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` (Upstash
 *     アカウント直接連携 / Marketplace 非経由)
 *
 * Vercel KV (`@vercel/kv` package) は 2026 年に提供終了済で
 * 「Upstash for Redis」に統合された (env prefix は KV_* のまま温存)。
 */

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

export type RateLimitResult = {
  /** True iff the request is within the limit. */
  allowed: boolean;
  /** Seconds until the bucket resets — only meaningful when blocked. */
  retryAfterSeconds: number;
};

// ---- in-memory fallback (per-instance) ----------------------------------

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

function checkInMemory(
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

// ---- Upstash Redis backend (cross-instance) -----------------------------

/**
 * `Ratelimit` インスタンスは `(scope, limit, windowMs)` の組ごとに 1 つ
 * 必要 (内部で固有 prefix を持つため)。proxy.ts は同じ rule を毎リクエスト
 * 使うので module-level でキャッシュして重複生成を避ける。
 *
 * Redis client は env から自動取得。両方の prefix に対応:
 * - **Vercel Marketplace「Upstash for Redis」** (旧 Vercel KV 後継):
 *   `KV_REST_API_URL` / `KV_REST_API_TOKEN` を注入
 * - **Upstash 直接アカウント連携** (Marketplace 非経由 / 他環境):
 *   `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`
 *
 * いずれも対応 (KV_* を優先)。両方欠けていたら `null` を返して
 * in-memory fallback に倒す。
 */
let cachedRedis: Redis | null | undefined = undefined; // undefined = まだ判定していない
function getRedis(): Redis | null {
  if (cachedRedis !== undefined) return cachedRedis;
  const url =
    process.env.KV_REST_API_URL?.trim() ||
    process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token =
    process.env.KV_REST_API_TOKEN?.trim() ||
    process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) {
    cachedRedis = null;
    return null;
  }
  try {
    cachedRedis = new Redis({ url, token });
  } catch (err) {
    console.warn("[rate-limit] failed to init Upstash Redis, falling back", err);
    cachedRedis = null;
  }
  return cachedRedis;
}

const ratelimiters = new Map<string, Ratelimit>();
function getRatelimiter(
  scope: string,
  limit: number,
  windowMs: number,
): Ratelimit | null {
  const redis = getRedis();
  if (!redis) return null;
  const key = `${scope}:${limit}:${windowMs}`;
  let rl = ratelimiters.get(key);
  if (!rl) {
    rl = new Ratelimit({
      redis,
      // 固定ウィンドウ。`limit` 回 / `windowMs` ms。
      limiter: Ratelimit.fixedWindow(limit, `${windowMs} ms`),
      prefix: `rl:${scope}`,
      analytics: false,
    });
    ratelimiters.set(key, rl);
  }
  return rl;
}

async function checkUpstash(
  scope: string,
  identifier: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult | null> {
  const rl = getRatelimiter(scope, limit, windowMs);
  if (!rl) return null;
  try {
    const result = await rl.limit(identifier);
    if (result.success) {
      return { allowed: true, retryAfterSeconds: 0 };
    }
    // result.reset は wall-clock ms (Date.now() と比較できる UNIX epoch)。
    const retryMs = Math.max(0, result.reset - Date.now());
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil(retryMs / 1000)),
    };
  } catch (err) {
    // ネットワークエラー / Redis 障害時は fail-open に倒す。
    // (rate-limit 自体が落ちて全リクエストを 429 にするより、瞬間的に
    // limit が緩む方が運用上マシ)。in-memory fallback を呼ぶ。
    console.warn("[rate-limit] upstash error, falling back to in-memory", err);
    return null;
  }
}

// ---- public API ---------------------------------------------------------

/**
 * 固定ウィンドウ rate limit。`scope` で route group を分け、`identifier`
 * (通常は IP) ごとに独立カウンタ。
 *
 * Upstash Redis env がセットされていれば分散実装 (instance 跨ぎで共有)、
 * 未設定なら in-memory fallback (per-instance per-IP)。
 *
 * @param limit    1 ウィンドウあたりの許容回数
 * @param windowMs ウィンドウ長 (ms)
 */
export async function checkRateLimit(
  scope: string,
  identifier: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  const upstash = await checkUpstash(scope, identifier, limit, windowMs);
  if (upstash) return upstash;
  return checkInMemory(scope, identifier, limit, windowMs);
}

/**
 * Vercel / 一般的な reverse proxy 配下から client IP を抽出。
 * `x-forwarded-for` の先頭エントリ (originating client) を採用。
 * fallback は `x-real-ip` → "unknown" (=共有 bucket になる、暴走を防ぐ
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
