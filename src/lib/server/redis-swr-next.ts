import "server-only";
import { createHash } from "node:crypto";
import { after } from "next/server";
import { unstable_rethrow } from "next/navigation";
import type { SwrDeps } from "./redis-swr";
import { getSwrStore } from "./redis-swr-store";

/**
 * `redis-swr.ts` を Next の上で使うための部品 (after・時計・ログ・保存先)。
 *
 * ログは `[tag] event` で、キーは末尾 8 文字だけ出す (URL や ID を出さない)。
 * `written` (info) は出した直後の観測用 — 書き込みが本番の runtime logs で
 * 引き金の要求に記録されるのを確かめたら `logWrites` を外す。
 */
export function nextSwrDeps(
  tag: string,
  opts: { logWrites?: boolean } = {},
): SwrDeps {
  return {
    store: getSwrStore(),
    after,
    now: Date.now,
    log: (level, event, key, detail) => {
      if (event === "written" && !opts.logWrites) return;
      console[level](`[${tag}] ${event}`, { key: key.slice(-8), ...detail });
    },
    rethrow: unstable_rethrow,
  };
}

/** 保存先のキーに入れる引数のハッシュ (URL や ID をキーにもログにも出さない)。 */
export const hashArg = (arg: string): string =>
  createHash("sha256").update(arg).digest("hex").slice(0, 32);
