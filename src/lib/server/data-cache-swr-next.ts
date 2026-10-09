import "server-only";
import { unstable_cache } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { after } from "next/server";
import type { SwrDeps } from "./data-cache-swr";

/**
 * `data-cache-swr.ts` に本物の Next を差し込む口 (2026-10-09)。
 *
 * helper 本体は next を import しない (検査から偽物も差し込むため) ので、
 * 本物はここで 1 回だけ渡す。使う側 (`sheet-table.ts`) は `unstable_cache`
 * を import せず、これを渡すだけにする — 直接呼ぶと、描画中に取り直しを
 * 積む旧方式に戻ってしまう (`check-sheet-swr.mjs` で見ている)。
 */
export const nextSwrDeps: SwrDeps = {
  unstable_cache,
  after,
  now: Date.now,
  rethrow: unstable_rethrow,
};
