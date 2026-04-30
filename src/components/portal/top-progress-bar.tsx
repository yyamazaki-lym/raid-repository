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
    // setState を effect body から sync に呼ぶと React 19 の
    // `react-hooks/set-state-in-effect` rule に引っかかるため、最初の
    // 遷移も setTimeout(0) でマクロタスクに飛ばしてから phase を進める。
    // 体感ラグは 1 frame 以下で UX 上は不可視。
    // idle/finish → start → creep
    if (pending && (phase === "idle" || phase === "finish")) {
      const tStart = setTimeout(() => setPhase("start"), 0);
      const tCreep = setTimeout(() => setPhase("creep"), 220);
      return () => {
        clearTimeout(tStart);
        clearTimeout(tCreep);
      };
    }
    // start/creep → finish → idle
    if (!pending && (phase === "start" || phase === "creep")) {
      const tFinish = setTimeout(() => setPhase("finish"), 0);
      const tIdle = setTimeout(() => setPhase("idle"), 520);
      return () => {
        clearTimeout(tFinish);
        clearTimeout(tIdle);
      };
    }
  }, [pending, phase]);

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
