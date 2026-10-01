"use client";

import { useSyncExternalStore } from "react";

/**
 * 描画に使う「現在時刻」(2026-10-01 監査 U-14)。
 *
 * client component の描画中に `Date.now()` を読むと、サーバー描画と
 * hydration で別の時刻を見る。JST 0:00 や開催開始の瞬間をまたぐと、
 * 「本日 / 明日」「挑戦中」や過去 / 予定の振り分けがサーバーと
 * クライアントで食い違い、hydration エラーになる (閲覧端末の時計が
 * ずれているとこの窓が広がる)。
 *
 * サーバー描画で使った時刻 (`serverNowMs`、page が 1 回だけ読んで props で
 * 渡す) を hydration にも使い、そのあと 30 秒刻みの実時刻へ切り替える。
 * `useSyncExternalStore` の `getServerSnapshot` は、サーバー描画と
 * hydration の両方で呼ばれるので、2 つが必ず同じ値になる。
 */

const TICK_MS = 30_000;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  if (timer === null) {
    timer = setInterval(() => {
      for (const l of listeners) l();
    }, TICK_MS);
  }
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/** 30 秒単位に丸めた現在時刻 (同じ tick の間は同じ値を返す)。 */
function getSnapshot(): number {
  return Math.floor(Date.now() / TICK_MS) * TICK_MS;
}

export function useHydrationSafeNow(serverNowMs: number): number {
  return useSyncExternalStore(subscribe, getSnapshot, () => serverNowMs);
}
