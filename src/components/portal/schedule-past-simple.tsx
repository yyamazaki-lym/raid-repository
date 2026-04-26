"use client";

import { Card } from "@/components/ui/card";
import { isJapaneseHoliday } from "@/lib/japanese-holidays";
import type { ScheduleSession } from "@/lib/schedule/next-session";

/**
 * Simple past-sessions view: a compact horizontal-wrap strip of the
 * 10 most recent past dates, ordered chronologically (oldest → newest)
 * so the day closest to "today" sits at the rightmost / bottom.
 *
 * No participant data, no time-of-day — just dates. For users who only
 * want to glance at "when did we do something recently". The detailed
 * full table at the bottom of the page is the secondary, opt-in view.
 *
 * Holiday dates are colored rose. Confirmed (DECISION) dates get a
 * subtle cyan tint to remain consistent with the upcoming list.
 */

const STILL_RELEVANT_MS = 6 * 60 * 60 * 1000;
const SIMPLE_LIMIT = 10;

export function SchedulePastSimple({
  sessions,
  holidays,
}: {
  sessions: ScheduleSession[];
  holidays?: readonly string[];
}) {
  const cutoff = Date.now() - STILL_RELEVANT_MS;
  // Filter to past, sort newest-first, take 10, reverse to chronological.
  const recentChronological = [...sessions]
    .filter((s) => s.date.getTime() < cutoff)
    .sort((a, b) => b.date.getTime() - a.date.getTime())
    .slice(0, SIMPLE_LIMIT)
    .reverse();

  if (recentChronological.length === 0) return null;

  return (
    <Card className="glass overflow-hidden p-0">
      <header className="flex items-center justify-between gap-2 border-b border-border/40 bg-secondary/20 px-3 py-2">
        <div className="flex items-center gap-2 font-mono text-[10px] tracking-[0.22em] text-muted-foreground uppercase">
          <span className="inline-flex h-1.5 w-1.5 rounded-full bg-muted-foreground/60" />
          Past · 過去の活動
        </div>
        <span className="font-mono text-[10px] tabular-nums text-muted-foreground/80">
          直近 {recentChronological.length} 件 · 古い順
        </span>
      </header>
      <ul className="flex flex-wrap gap-1.5 p-3">
        {recentChronological.map((s) => (
          <DateChip key={s.rawDate} session={s} holidays={holidays} />
        ))}
      </ul>
    </Card>
  );
}

function DateChip({
  session,
  holidays,
}: {
  session: ScheduleSession;
  holidays?: readonly string[];
}) {
  const holiday = isJapaneseHoliday(session.date, holidays);
  const decided = session.status === "DECISION";
  // Date label: Japanese-style "M月D日（曜）" instead of MM/DD which
  // reads as a Western format. Extract month/day from the raw
  // "YYYY/MM/DD" portion of the rawDate string.
  const datePart = session.rawDate.split(" ")[0] ?? session.rawDate;
  const m = datePart.match(/(\d{1,2})\/(\d{1,2})/);
  const monthDay = m ? `${parseInt(m[1]!, 10)}月${parseInt(m[2]!, 10)}日` : datePart;

  return (
    <li
      className={
        "inline-flex items-center gap-0.5 rounded-sm border px-1.5 py-0.5 text-[11px] " +
        (holiday
          ? "border-rose-400/45 bg-rose-400/10 text-rose-300"
          : decided
            ? "border-[var(--neon-cyan)]/40 bg-[var(--neon-cyan)]/8 text-[var(--neon-cyan)]"
            : "border-border/50 bg-background/30 text-foreground/85")
      }
      title={`${session.rawDate}${decided ? " · 確定" : ""}${holiday ? " · 祝日" : ""}`}
    >
      <span className="font-display tabular-nums">{monthDay}</span>
      <span className="text-[10px] opacity-75">（{session.dayOfWeek}）</span>
    </li>
  );
}
