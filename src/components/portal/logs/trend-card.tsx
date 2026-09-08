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
 * ## 目盛りと凡例 (2026-09-08 実機要望)
 *
 * 「横軸も欲しい。現状どこまで達したかが一目で分かる」「薄い線の意味が
 * 分かりにくい」。2 つとも**画面に情報が出ていなかった**もので、線の意味は
 * この docstring にしか書いていなかった。
 *
 *   - **到達度の目盛り** (100 / 50 / 0%) を SVG の左に置く
 *   - **期間** (最初と最後のセッション日) を SVG の下に置く
 *   - **凡例** (薄い線 = その日 / 濃い線 = 最高到達 / 緑の点 = 初討伐)
 *
 * ⚠ **目盛りの文字を SVG の中に置いてはいけない。** この SVG は
 * `preserveAspectRatio="none"` で横に伸縮させており (300×56 の内部座標を
 * カード幅に合わせて引き伸ばす)、中のテキストも一緒に横に潰れる / 伸びる。
 * だから目盛り・期間・凡例はすべて **HTML 側**に出し、SVG は線だけを描く。
 * 2026-09-07 版の「目盛りの数字は出さない (幅が足りない)」という判断は、
 * 数字を SVG 内に置く前提だったもの。左に gutter を作れば幅は足りる。
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
  const first = points[0]!;
  const daily = sparklinePath(points.map((p) => p.progress), W, H);
  const best = sparklinePath(points.map((p) => p.bestProgress), W, H);
  const clearIndex = points.findIndex((p) => p.hasClear);
  const bestPct = Math.round(last.bestProgress);

  return (
    <section className="flex flex-col gap-2 rounded-md border border-border/40 bg-secondary/10 px-3 py-2">
      <header className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
        <h3 className="inline-flex items-center gap-1.5 font-mono text-[11px] tracking-[0.16em] text-muted-foreground uppercase">
          <TrendingUp className="h-3 w-3 text-[var(--neon-cyan)]" aria-hidden />
          {m.trend.title}
        </h3>
        <span className="font-mono text-[12px] text-muted-foreground tabular-nums">
          {m.trend.sessions(points.length)} ·{" "}
          {m.trend.cumulative(last.cumulativePulls)}
          {truncated ? ` · ${m.trend.truncated}` : ""}
        </span>
      </header>

      {/* 到達度の目盛り (左) + グラフ。目盛りは HTML 側なので横に伸びても
          潰れない (docstring の ⚠)。gutter は 100% の 4 文字ぶん。 */}
      <div className="flex items-stretch gap-1.5">
        <div
          className="flex w-8 shrink-0 flex-col justify-between py-px text-right font-mono text-[11px] text-muted-foreground/70 tabular-nums"
          aria-hidden
        >
          <span>{m.trend.axisPercent(100)}</span>
          <span>{m.trend.axisPercent(50)}</span>
          <span>{m.trend.axisPercent(0)}</span>
        </div>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="h-14 min-w-0 flex-1"
          role="img"
          aria-label={m.trend.chartAria(points.length, bestPct)}
        >
          {/* 25 / 50 / 75% のガイド線。50% は左の目盛りと対応する。
              0 / 100% は枠に当たるので線を引かない。 */}
          {[0.25, 0.5, 0.75].map((r) => (
            <line
              key={r}
              x1={0}
              x2={W}
              y1={H * r}
              y2={H * r}
              stroke="currentColor"
              strokeWidth={0.5}
              className={r === 0.5 ? "text-border/70" : "text-border/40"}
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
      </div>

      {/* 期間 (X 軸)。日付だけを両端に置く — セッションごとの目盛りは
          55 セッションだと文字が重なるので出さない。 */}
      <div className="flex items-baseline gap-1.5">
        <span className="w-8 shrink-0" aria-hidden />
        <span className="flex min-w-0 flex-1 justify-between font-mono text-[11px] text-muted-foreground/70 tabular-nums">
          <span>{first.date}</span>
          <span>{last.date}</span>
        </span>
      </div>

      {/* 凡例。2 本の線の違いが画面のどこにも書いていなかった
          (2026-09-08 実機報告「薄い線の意味が分かりにくい」)。 */}
      <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] leading-tight text-muted-foreground">
        <li className="inline-flex items-center gap-1.5">
          <span
            className="h-0 w-4 shrink-0 border-t-2 border-[var(--neon-cyan)]"
            aria-hidden
          />
          {m.trend.legendBest}
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span
            className="h-0 w-4 shrink-0 border-t border-[var(--neon-cyan)]/35"
            aria-hidden
          />
          {m.trend.legendDaily}
        </li>
        {clearIndex >= 0 && (
          <li className="inline-flex items-center gap-1.5">
            <span
              className="h-2 w-2 shrink-0 rounded-full bg-emerald-300"
              aria-hidden
            />
            {m.trend.legendClear}
          </li>
        )}
      </ul>

      <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[12px] tabular-nums">
        <span className="text-[var(--neon-cyan)]">
          {m.trend.bestProgress(bestPct)}
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
