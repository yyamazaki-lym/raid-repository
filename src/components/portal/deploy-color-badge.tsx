"use client";

import { useEffect, useState } from "react";
import { useMessages } from "@/lib/i18n/client";

/**
 * ヘッダーの「v1.9 (date) · BETA」バッジ。色は 2 ルート:
 *
 *   - **当日**: `releaseDate` (= 最新 changelog エントリーの日付) と JST の
 *     現在日付が一致する場合は `hashColor` (commit SHA から派生する 7 色
 *     サイクルのうちのいずれか) を使用。push 直後の deploy 反映を視覚的に
 *     確認するための色。
 *   - **翌日以降**: 日付が跨いだら `defaultColor` (= サイクル先頭の cyan)
 *     にリセット。「今日は新しいコミットなし = 静かな状態」を示す。
 *
 * SSR/CSR 不一致を避けるため、`initialColor` は親 (server component) が
 * 同じロジックで計算して渡す。クライアントマウント後は `setInterval`
 * で 1 分ごとに JST 日付を再評価し、deep midnight rollover にも追従。
 *
 * テーマ切替で意味が変わらないよう Tailwind 標準色を採用 (`--neon-*`
 * トークンは theme で色相が変わるため不適)。
 */

type Props = {
  /** push のたびに変わるハッシュ色 (当日表示用) */
  hashColor: string;
  /** 翌日以降に使う固定色 (= DEPLOY_COLORS[0]) */
  defaultColor: string;
  /** RELEASES[0].date — 比較対象の日付 (`YYYY-MM-DD`) */
  releaseDate: string | null;
  /** SSR で計算済みの初期色 (hydration mismatch 回避) */
  initialColor: string;
  /** バッジに表示するコンテンツ (version + date + stage) */
  children: React.ReactNode;
};

/** Asia/Tokyo の今日の日付を `YYYY-MM-DD` で返す */
function jstDateString(): string {
  const now = new Date();
  // toLocaleString は server timezone と独立に Asia/Tokyo 表示を返す
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return parts; // "YYYY-MM-DD" — en-CA は ISO 形式
}

export function DeployColorBadge({
  hashColor,
  defaultColor,
  releaseDate,
  initialColor,
  children,
}: Props) {
  const [color, setColor] = useState(initialColor);

  useEffect(() => {
    const compute = () => {
      const today = jstDateString();
      setColor(today === releaseDate ? hashColor : defaultColor);
    };
    compute();
    // 1 分粒度で再評価。日付跨ぎ (00:00 JST) を ~60s 以内にキャッチ。
    const id = window.setInterval(compute, 60_000);
    return () => window.clearInterval(id);
  }, [hashColor, defaultColor, releaseDate]);

  const m = useMessages();
  return (
    <span
      className={`flex items-center gap-1.5 font-mono text-[10px] tabular-nums tracking-[0.16em] sm:text-[11px] ${color}`}
      title={m.header.deployTitle}
    >
      {children}
    </span>
  );
}

// `pickInitialColor` was previously exported here for server-side
// initial-color computation, but Next.js 16 disallows calling regular
// (non-component) exports from a "use client" file in server components.
// The same JST-date logic is now inlined directly in site-header.tsx
// (server component). See `pickInitialColor` there.
