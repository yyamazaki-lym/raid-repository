/**
 * 練習ログ: 進行トレンド (W-4、2026-09-07)。
 *
 * 「日ごとのバー」を時系列化して、累積 pull に対する到達度の伸びを 1 枚で
 * 見せる。**グラフライブラリは入れない** — 必要なのは折れ線 2 本と点なので
 * インライン SVG で足りる (recharts / chart.js は 50〜200 KB の client
 * bundle が乗るので、この規模では釣り合わない。調査ノート第 4 回 W-4 の
 * デメリット欄「グラフ描画ライブラリの追加 (bundle)」への回答)。
 *
 * 折れ線は 2 本:
 *   - 薄い方 = その日の到達度 (上下する)
 *   - 濃い方 = そこまでの最高到達 (下がらない)
 * 片方だけだと「調子の悪い日」か「伸びの傾向」のどちらかが読めない。
 *
 * 分割の経緯と依存の向きは `./README.md` を参照。
 */
"use client";

import { TrendingUp } from "lucide-react";
import {
  clearPace,
  sparklinePath,
  trendSeries,
  type TrendInput,
} from "@/lib/fflogs-trend";
import { useMessages } from "@/lib/i18n/client";

/** SVG の内部座標系 (viewBox)。実寸は CSS 側で伸縮させる。 */
const W = 300;
const H = 56;

export function TrendCard({
  days,
  truncated,
}: {
  days: ReadonlyArray<TrendInput>;
  /** 明細が打ち切られているか (トレンドの母数に注記を出す)。 */
  truncated: boolean;
}) {
  const m = useMessages();
  const points = trendSeries(days);
  // 2 点未満だと「傾向」が存在しないので出さない (1 セッションで折れ線を
  // 描いても水平線が 1 本出るだけ)。
  if (points.length < 2) return null;

  const pace = clearPace(points);
  const last = points[points.length - 1]!;
  const daily = sparklinePath(points.map((p) => p.progress), W, H);
  const best = sparklinePath(points.map((p) => p.bestProgress), W, H);
  const clearIndex = points.findIndex((p) => p.hasClear);

  return (
    <section className="flex flex-col gap-2 rounded-md border border-border/40 bg-secondary/10 px-3 py-2">
      <header className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
        <h3 className="inline-flex items-center gap-1.5 font-mono text-[10px] tracking-[0.16em] text-muted-foreground uppercase">
          <TrendingUp className="h-3 w-3 text-[var(--neon-cyan)]" aria-hidden />
          {m.trend.title}
        </h3>
        <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
          {m.trend.sessions(points.length)} ·{" "}
          {m.trend.cumulative(last.cumulativePulls)}
          {truncated ? ` · ${m.trend.truncated}` : ""}
        </span>
      </header>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-14 w-full"
        role="img"
        aria-label={m.trend.chartAria(
          points.length,
          Math.round(last.bestProgress),
        )}
      >
        {/* 25 / 50 / 75% のガイド線。目盛りの数字は出さない (幅が足りない)。
            hover で読む値ではないので、位置の目安だけ与える。 */}
        {[0.25, 0.5, 0.75].map((r) => (
          <line
            key={r}
            x1={0}
            x2={W}
            y1={H * r}
            y2={H * r}
            stroke="currentColor"
            strokeWidth={0.5}
            className="text-border/40"
          />
        ))}
        <polyline
          points={daily}
          fill="none"
          stroke="currentColor"
          strokeWidth={1}
          className="text-[var(--neon-cyan)]/35"
        />
        <polyline
          points={best}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.75}
          strokeLinejoin="round"
          className="text-[var(--neon-cyan)]"
        />
        {/* 初討伐の日に印。クリア後は最高到達が 100 で張り付くので、
            線だけでは「いつクリアしたか」が読めない。 */}
        {clearIndex >= 0 && (
          <circle
            cx={(clearIndex / (points.length - 1)) * W}
            cy={
              H -
              (Math.min(100, Math.max(0, points[clearIndex]!.bestProgress)) /
                100) *
                H
            }
            r={3}
            className="fill-emerald-300"
          />
        )}
      </svg>

      <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[10px] tabular-nums">
        <span className="text-[var(--neon-cyan)]">
          {m.trend.bestProgress(Math.round(last.bestProgress))}
        </span>
        {pace ? (
          <span className="text-amber-200/85" title={m.trend.paceTitle}>
            {m.trend.pace(pace.sessionsToClear, pace.pullsToClear)}
          </span>
        ) : (
          <span className="text-muted-foreground/70" title={m.trend.noPaceTitle}>
            {m.trend.noPace}
          </span>
        )}
      </p>
    </section>
  );
}
