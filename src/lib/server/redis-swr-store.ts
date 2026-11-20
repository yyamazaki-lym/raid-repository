import "server-only";
import { Redis } from "@upstash/redis";
import type { SwrEntry, SwrStore } from "./redis-swr";

/**
 * `redis-swr.ts` の保存先 (2026-11-20、L-24)。
 *
 * Upstash Redis (本番・デモとも接続済み。`rate-limit.ts` と同じ DB) に置く。
 * env が無ければプロセス内の Map に落とす (`rate-limit.ts` と同じ縮退。手元の
 * dev や fork はこちら)。
 *
 * ⚠ `@upstash/redis` は既定で 5 回まで再試行する (指数バックオフ) ので、
 *   `retry: false` にして要求ごとに打ち切る。読みは描画を待たせるので 1 秒、
 *   書きは after の中なので 5 秒。`signal` に関数を渡すと要求ごとに新しい
 *   時計になり、打ち切ると投げる (`@upstash/redis` の http クライアント)。
 *   既定の `cache: "no-store"` のままなので Next の fetch キャッシュには乗らない。
 */

const READ_TIMEOUT_MS = 1_000;
const WRITE_TIMEOUT_MS = 5_000;

/** 本文の読み込みまで含めて打ち切る (signal は応答の頭までしか見ない)。 */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const e = new Error(`timed out after ${ms}ms`);
      e.name = "TimeoutError";
      reject(e);
    }, ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

function upstashStore(url: string, token: string): SwrStore {
  const reader = new Redis({
    url,
    token,
    retry: false,
    signal: () => AbortSignal.timeout(READ_TIMEOUT_MS),
  });
  const writer = new Redis({
    url,
    token,
    retry: false,
    signal: () => AbortSignal.timeout(WRITE_TIMEOUT_MS),
  });
  return {
    get: (key) => withTimeout(reader.get(key), READ_TIMEOUT_MS),
    set: async (key, entry, ttlSeconds) => {
      await withTimeout(writer.set(key, entry, { ex: ttlSeconds }), WRITE_TIMEOUT_MS);
    },
    del: async (key) => {
      await withTimeout(writer.del(key), WRITE_TIMEOUT_MS);
    },
    acquire: async (key, ttlSeconds) =>
      (await withTimeout(
        writer.set(key, 1, { nx: true, ex: ttlSeconds }),
        WRITE_TIMEOUT_MS,
      )) === "OK",
  };
}

/** プロセス内の保存先 (env が無いとき)。インスタンスを跨がない。 */
export function memoryStore(now: () => number = Date.now): SwrStore {
  const m = new Map<string, { value: unknown; expiresAt: number }>();
  const live = (key: string) => {
    const e = m.get(key);
    if (e && e.expiresAt <= now()) {
      m.delete(key);
      return undefined;
    }
    return e;
  };
  return {
    get: async (key) => live(key)?.value ?? null,
    set: async (key, entry: SwrEntry<unknown>, ttlSeconds) => {
      m.set(key, { value: entry, expiresAt: now() + ttlSeconds * 1000 });
      // カテゴリ数 × 数本しか入らない想定。増えすぎたら古い順に捨てる。
      if (m.size > 256) {
        for (const k of m.keys()) {
          m.delete(k);
          if (m.size <= 128) break;
        }
      }
    },
    del: async (key) => {
      m.delete(key);
    },
    acquire: async (key, ttlSeconds) => {
      if (live(key)) return false;
      m.set(key, { value: 1, expiresAt: now() + ttlSeconds * 1000 });
      return true;
    },
  };
}

let cached: SwrStore | undefined;

/** env を見て保存先を選ぶ (KV_* を優先。`rate-limit.ts` の getRedis と同じ)。 */
export function getSwrStore(): SwrStore {
  if (cached) return cached;
  const url =
    process.env.KV_REST_API_URL?.trim() ||
    process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token =
    process.env.KV_REST_API_TOKEN?.trim() ||
    process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  cached = url && token ? upstashStore(url, token) : memoryStore();
  return cached;
}

/**
 * キーの頭に付けるプロジェクトの区別。本番とデモが同じ Upstash の DB を
 * 使っても混ざらないようにする (`rate-limit.ts` の RL_NAMESPACE と同じ値)。
 */
export const SWR_NAMESPACE =
  process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim() || "local";
