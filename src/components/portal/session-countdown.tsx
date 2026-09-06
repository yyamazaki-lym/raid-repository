"use client";

import { useSyncExternalStore } from "react";
import { formatCountdown } from "@/lib/schedule/attendance-times";
import { useLocale, useMessages } from "@/lib/i18n/client";

/**
 * 次回開催カードの「開始まで N 時間 M 分」(2026-09-06、調査ノート第 4 回 W-14)。
 *
 * カード本体はサーバー描画のスナップショットなので「本日」までしか出せない。
 * ここだけ client で 30 秒ごとに現在時刻を読み直し、開始 24 時間以内なら
 * 残り時間を出す。開始後 / 24 時間より先は何も描かない (親の「本日 / 明日 /
 * あと N 日」に任せる)。
 *
 * 現在時刻は `useSyncExternalStore` の外部ストアとして読む: サーバー
 * スナップショットは 0 (= 描かない) で、hydration 後に実時刻へ切り替わる。
 * effect 内 setState を使わないのは repo の react-hooks ルールに合わせたもの。
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

/** 30 秒単位に丸めた現在時刻 (同一 tick 内で安定した値を返す)。 */
function getSnapshot(): number {
  return Math.floor(Date.now() / TICK_MS) * TICK_MS;
}
function getServerSnapshot(): number {
  return 0;
}

export function SessionCountdown({
  startMs,
  className = "",
}: {
  /** 開催開始の UTC ms。 */
  startMs: number;
  className?: string;
}) {
  const now = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const locale = useLocale();
  const m = useMessages();
  if (now === 0) return null;
  const label = formatCountdown(startMs, now, locale);
  if (!label) return null;
  return (
    <span
      className={
        "font-mono text-[11px] tracking-normal whitespace-nowrap text-muted-foreground tabular-nums " +
        className
      }
      title={m.schedule.countdownTitle}
    >
      {label}
    </span>
  );
}
