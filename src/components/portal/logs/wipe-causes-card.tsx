/**
 * 練習ログ: ワイプ原因の内訳カード (2026-09-06 W-1)。
 *
 * 2026-09-07 に `logs-view.tsx` から切り出した (#20)。分割の経緯と依存の
 * 向きは `./README.md` を参照。
 */
"use client";

import { type WipeCauseCount } from "@/lib/fflogs-fight-detail";
import { phaseTextToneClass } from "@/lib/fflogs-progress";
import { useMessages } from "@/lib/i18n/client";
import { PERF_BAR, PERF_TEXT } from "@/lib/perf-tone";

/**
 * ワイプ原因の内訳カード (2026-09-06 W-1)。「初死亡の致命技」を技名で数え、
 * 多い順に並べる。絶ではどのフェーズで崩れたかも添える。
 * 誰が落ちたかは出さない (pull 行のジョブ略称までが粒度の上限)。
 */
export function WipeCausesCard({
  causes,
  wipeCount,
  phaseCounts,
  truncated,
}: {
  causes: WipeCauseCount[];
  wipeCount: number;
  phaseCounts: Array<{ phase: number; count: number }>;
  truncated: boolean;
}) {
  const m = useMessages();
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border/40 bg-secondary/15 px-3 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-[11px] tracking-[0.14em] text-muted-foreground uppercase">
          {m.logs.wipeCauses}
        </span>
        <span
          className="font-mono text-[11px] tracking-[0.12em] text-muted-foreground/70"
          title={m.logs.wipeCausesHint}
        >
          {m.logs.wipeCausesSub(wipeCount)}
          {truncated ? m.logs.shownOnly : ""}
        </span>
      </div>
      <ul className="flex flex-col gap-0.5" aria-label={m.logs.wipeCausesAria}>
        {causes.map((c) => (
          <li
            key={c.ability}
            className="flex items-center gap-2 font-mono text-[11px] tabular-nums"
          >
            <span className={"min-w-0 flex-1 truncate " + PERF_TEXT.bad} title={c.ability}>
              {c.ability}
            </span>
            <span className="relative h-1.5 w-20 shrink-0 overflow-hidden rounded-sm bg-secondary/50">
              <span
                className={"absolute inset-y-0 left-0 rounded-sm " + PERF_BAR.bad}
                style={{
                  width: `${Math.max(4, Math.round((c.count / Math.max(1, wipeCount)) * 100))}%`,
                }}
                aria-hidden
              />
            </span>
            <span className="w-8 shrink-0 text-right text-muted-foreground">
              ×{c.count}
            </span>
          </li>
        ))}
      </ul>
      {phaseCounts.length > 0 && (
        <ul
          className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5"
          aria-label={m.logs.wipePhaseAria}
          title={m.logs.wipePhaseTitle}
        >
          {phaseCounts.map((p) => (
            <li
              key={p.phase}
              className="inline-flex items-baseline gap-1 whitespace-nowrap font-mono text-[12px] tabular-nums"
            >
              <span className={phaseTextToneClass(p.phase)}>
                P{p.phase}
              </span>
              <span className="text-muted-foreground">{p.count}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
