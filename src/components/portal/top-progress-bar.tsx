"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  getPendingServerSnapshot,
  getPendingSnapshot,
  subscribePending,
} from "@/lib/navigation-pending-store";

/**
 * 2.1 (2026-05-01) TODO #54 part2: 上端 cyan progress bar の自前実装。
 *
 * 旧実装 (`next-nprogress-bar`) は Next.js 16 + React 19 で本番ビルド時に
 * バーが描画されないため、Next.js 16 標準の `useLinkStatus` (15.3+) を使う
 * 構成に置換。各 `<PortalLink>` が `<NavReporter />` 経由で
 * `navigation-pending-store` の参照カウンタを ++/-- し、本コンポーネントは
 * `useSyncExternalStore` で購読して描画する。
 *
 * 進捗演出は NProgress 風 4 フェーズ:
 *   - idle  : 非表示
 *   - start : 0% → 70% (200ms) — クリック直後の即時フィードバック
 *   - creep : 70% → 90% (1500ms) — 完了が遅い時のじわじわ進行感
 *   - finish: 90% → 100% (200ms) → fade out (300ms)
 *
 * ユーザの cold start 体感 (秒オーダー) で creep が必ず可視化されるので
 * 「何かが起きている」がきちんと伝わる。一方で短い prefetch 済み遷移では
 * start に到達する前に finish に飛ぶので flash が抑えられる。
 */
type Phase = "idle" | "start" | "creep" | "finish";

const WIDTH_BY_PHASE: Record<Phase, string> = {
  idle: "0%",
  start: "70%",
  creep: "90%",
  finish: "100%",
};

const DURATION_BY_PHASE: Record<Phase, string> = {
  idle: "0ms",
  start: "200ms",
  creep: "1500ms",
  finish: "200ms",
};

export function TopProgressBar() {
  const pending = useSyncExternalStore(
    subscribePending,
    getPendingSnapshot,
    getPendingServerSnapshot,
  );
  const [phase, setPhase] = useState<Phase>("idle");

  useEffect(() => {
    // 依存は `pending` のみ。`phase` を依存に含めると `setPhase` で
    // phase が動くたびに effect が再走 → cleanup が走って未発火タイマー
    // (creep / idle) が clear され、phase=finish のまま永続化する race
    // が起きる (2.1 part2 初回実装で実観測)。`setPhase` を関数形式で
    // 使うことで stale closure を避けつつ依存を最小化。
    if (pending) {
      setPhase("start");
      const t = setTimeout(() => setPhase("creep"), 200);
      return () => clearTimeout(t);
    }
    setPhase((prev) =>
      prev === "idle" || prev === "finish" ? prev : "finish",
    );
    const t = setTimeout(() => {
      setPhase((prev) => (prev === "finish" ? "idle" : prev));
    }, 500);
    return () => clearTimeout(t);
  }, [pending]);

  if (phase === "idle") return null;

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-[2px]"
    >
      <div
        className="h-full bg-[var(--neon-cyan)] shadow-[0_0_8px_var(--neon-cyan)]"
        style={{
          width: WIDTH_BY_PHASE[phase],
          opacity: phase === "finish" ? 0 : 1,
          transition: `width ${DURATION_BY_PHASE[phase]} ease-out, opacity 300ms ease-out 100ms`,
        }}
      />
    </div>
  );
}
