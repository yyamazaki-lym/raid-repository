/**
 * 練習ログ: ログが欠けている日 (2026-11-08)。
 *
 * スケジュールの開催日のうち、どのコンテンツにもログも手動の記録も無い日
 * (ユーザーの選択。判定は `@/lib/practice-log-manual` の
 * `missingPracticeDays`、読み取りは `server/practice-log-missing-days.ts`)。
 * 見るのは誰でも、「記録する」は admin だけ (手動の記録のダイアログを開く)。
 *
 * 欠けている日が無ければ何も描かない (空の枠で「何も無い」を主張しない)。
 */
"use client";

import { useState } from "react";
import { CalendarX2, PencilLine } from "lucide-react";
import { useMessages } from "@/lib/i18n/client";
import type { MissingDaysResult } from "@/lib/practice-log-manual";

/** 最初に見せる日数。 */
const INITIAL = 5;

export function MissingDaysCard({
  missing,
  onRecord,
}: {
  missing: MissingDaysResult;
  /** admin のみ: その日の手動の記録を足す。 */
  onRecord?: (date: string) => void;
}) {
  const m = useMessages();
  const [showAll, setShowAll] = useState(false);
  const days = missing.days;
  if (days.length === 0) return null;
  const shown = showAll ? days : days.slice(0, INITIAL);
  return (
    <section className="flex flex-col gap-1.5 rounded-md border border-amber-400/30 bg-amber-400/5 px-3 py-2">
      <h3 className="inline-flex items-center gap-1.5 font-mono text-[11px] tracking-[0.16em] text-amber-200/90 uppercase">
        <CalendarX2 className="h-3 w-3 shrink-0" aria-hidden />
        {m.logsMissing.title}
        <span className="tracking-normal text-amber-200/70 normal-case tabular-nums">
          {m.logsMissing.count(days.length)}
        </span>
      </h3>
      <p className="text-[11px] leading-relaxed text-muted-foreground">{m.logsMissing.hint}</p>
      <ul className="flex flex-col gap-1">
        {shown.map((d) => (
          <li key={d.date} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="font-mono text-[12px] text-foreground/85 tabular-nums">{d.date}</span>
            <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
              {d.label}
            </span>
            {onRecord && (
              <button
                type="button"
                onClick={() => onRecord(d.date)}
                title={m.logsMissing.recordTitle(d.date)}
                className="inline-flex shrink-0 items-center gap-1 rounded-sm border border-amber-400/40 px-1.5 py-0.5 font-mono text-[11px] text-amber-200 transition-colors hover:bg-amber-400/15"
              >
                <PencilLine className="h-3 w-3 shrink-0" aria-hidden />
                {m.logsMissing.record}
              </button>
            )}
          </li>
        ))}
      </ul>
      {days.length > INITIAL && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="self-start rounded px-1 font-mono text-[11px] tracking-[0.12em] text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          {showAll ? m.logsMissing.showLess : m.logsMissing.showAll(days.length - INITIAL)}
        </button>
      )}
    </section>
  );
}
