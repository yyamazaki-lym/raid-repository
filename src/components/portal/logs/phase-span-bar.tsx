/**
 * 練習ログ: 1 pull のフェーズ滞在バー (2026-09-06 W-2)。
 *
 * 2026-09-07 に `logs-view.tsx` から切り出した (#20)。分割の経緯と依存の
 * 向きは `./README.md` を参照。
 */
"use client";

import { type PhaseSpan, formatMs } from "@/lib/fflogs-fight-detail";
import { phaseBarToneClass } from "@/lib/fflogs-progress";
import { useMessages } from "@/lib/i18n/client";

/**
 * 1 pull のフェーズ滞在バー (2026-09-06 W-2)。区間チップの隣に置く小さな
 * 帯で、幅 = 戦闘時間に対する各フェーズの割合。hover で各フェーズの秒数。
 */
export function PhaseSpanBar({ spans }: { spans: PhaseSpan[] }) {
  const m = useMessages();
  const total = spans.reduce((acc, s) => acc + s.dur, 0);
  if (total <= 0) return null;
  const label = spans.map((s) => `P${s.id} ${formatMs(s.dur)}`).join(" / ");
  return (
    <span
      className="flex h-1.5 w-16 shrink-0 overflow-hidden rounded-sm bg-secondary/50"
      role="img"
      aria-label={m.logs.phaseSpanAria(label)}
      title={label}
    >
      {spans.map((s, i) => (
        <span
          key={`${s.id}:${i}`}
          className={phaseBarToneClass(s.id)}
          style={{ width: `${(s.dur / total) * 100}%` }}
        />
      ))}
    </span>
  );
}
