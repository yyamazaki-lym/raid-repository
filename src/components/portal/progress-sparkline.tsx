/**
 * コンテンツカードの日別到達度スパークライン (UI-2、2026-09-08)。
 *
 * 調査ノート第 4 回 8-3 UI-2。カード上で「今どこまで来たか」が**タブを
 * 開かずに**分かるようにする。線は練習ログの進行トレンド (W-4) と同じ
 * `sparklinePath()` で組み、ライブラリは入れない (`fflogs-trend.ts` の
 * docstring 参照 — 折れ線 1 本に 50〜200 KB の bundle は釣り合わない)。
 *
 * ## 色と読み取りやすさ
 *
 * 線色は到達度の 5 段階スケール (`perf-tone.ts`) の **最新の到達度**で決める。
 * WCAG 1.4.11 (非テキストコントラスト 3:1) を満たす -300 系を使い、
 * **数値を必ず併記**する — 線の色だけでは「78% まで来た」は伝わらないし、
 * 色覚多様性にも弱い (調査ノートのリスク欄「スパークラインの線色は
 * 1.4.11 の 3:1」への回答)。
 *
 * ## 出さない条件
 *
 * 2 日未満は線にならないので描かない (1 点だと水平線が出るだけで、
 * 「伸びているか」を何も語らない)。カードの高さを揃えるための
 * プレースホルダも置かない — スパークラインはカード中央列の可変高な
 * 位置にあり、右カラムのバッジ列 (高さ固定) とは別扱いで良い。
 */
"use client";

import { sparklinePath } from "@/lib/fflogs-trend";
import { PERF_TEXT, perfForProgress } from "@/lib/perf-tone";
import { useMessages } from "@/lib/i18n/client";

export type ProgressSparkPoint = {
  date: string;
  progress: number;
  pulls: number;
  hasClear: boolean;
};

const W = 96;
const H = 16;

export function ProgressSparkline({ points }: { points: ProgressSparkPoint[] }) {
  const m = useMessages();
  if (points.length < 2) return null;

  const values = points.map((p) => p.progress);
  const path = sparklinePath(values, W, H);
  const latest = values[values.length - 1]!;
  const best = Math.max(...values);
  const cleared = points.some((p) => p.hasClear);
  const totalPulls = points.reduce((acc, p) => acc + p.pulls, 0);
  const tone = PERF_TEXT[perfForProgress(cleared ? 100 : latest)];
  const label = cleared
    ? m.categoryList.sparkCleared
    : m.categoryList.sparkBest(Math.round(best));
  const title = m.categoryList.sparkTitle(points.length, totalPulls, label);

  return (
    <span
      className="mt-1 inline-flex items-center gap-1.5"
      title={title}
      aria-label={title}
    >
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        // 線そのものは装飾。読み取れる情報は隣の数値と title が持つ。
        aria-hidden
        className={"shrink-0 overflow-visible " + tone}
      >
        {/* 100% (討伐) の目安線。線が上端に届いたらクリア。 */}
        <line
          x1="0"
          y1="0.5"
          x2={W}
          y2="0.5"
          stroke="currentColor"
          strokeWidth="1"
          strokeDasharray="2 3"
          opacity="0.25"
        />
        <polyline
          points={path}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className={"font-mono text-[11px] tabular-nums " + tone}>
        {label}
      </span>
    </span>
  );
}
