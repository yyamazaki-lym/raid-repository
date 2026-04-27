"use client";

import Link from "next/link";
import { BarChart3, Film } from "lucide-react";
import { Card } from "@/components/ui/card";
import {
  getJapaneseHolidayName,
  isJapaneseHoliday,
} from "@/lib/japanese-holidays";
import type { JapaneseHolidaysMap } from "@/lib/japanese-holidays";
import type { ScheduleSession } from "@/lib/schedule/next-session";
import type { SessionVideoLink } from "@/lib/server/session-video-link";

/**
 * Simple past-sessions view: a compact horizontal-wrap strip of the
 * 10 most recent past dates, ordered NEWEST → OLDEST so the day
 * closest to "today" sits at the leftmost / first chip.
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
  sessionVideoLinks,
}: {
  sessions: ScheduleSession[];
  holidays?: JapaneseHolidaysMap;
  sessionVideoLinks?: Record<string, SessionVideoLink>;
}) {
  const cutoff = Date.now() - STILL_RELEVANT_MS;
  // Filter to past, sort newest-first, take 10. Newest-first display
  // means the chip you most likely care about (yesterday's session)
  // sits at the leftmost / start of the row.
  const recent = [...sessions]
    .filter((s) => s.date.getTime() < cutoff)
    .sort((a, b) => b.date.getTime() - a.date.getTime())
    .slice(0, SIMPLE_LIMIT);

  if (recent.length === 0) return null;

  return (
    <Card className="glass overflow-hidden p-0">
      <header className="flex items-center justify-between gap-2 border-b border-border/40 bg-secondary/20 px-3 py-2">
        <div className="flex items-center gap-2 font-mono text-[10px] tracking-[0.22em] text-muted-foreground uppercase">
          <span className="inline-flex h-1.5 w-1.5 rounded-full bg-muted-foreground/60" />
          Past · 過去の活動
        </div>
        <span className="font-mono text-[10px] tabular-nums text-muted-foreground/80">
          直近 {recent.length} 件
        </span>
      </header>
      <ul className="flex flex-wrap gap-1.5 p-3">
        {recent.map((s) => (
          <DateChip
            key={s.rawDate}
            session={s}
            holidays={holidays}
            videoLink={sessionVideoLinks?.[s.rawDate] ?? null}
          />
        ))}
      </ul>
    </Card>
  );
}

function DateChip({
  session,
  holidays,
  videoLink,
}: {
  session: ScheduleSession;
  holidays?: JapaneseHolidaysMap;
  videoLink: SessionVideoLink | null;
}) {
  const holiday = isJapaneseHoliday(session.date, holidays);
  const holidayName = holiday
    ? getJapaneseHolidayName(session.date, holidays)
    : null;
  const decided = session.status === "DECISION";
  // Date label: Japanese-style "M月D日（曜）". Anchor the regex to the
  // full YYYY/MM/DD form so a 4-digit year doesn't get mistaken for
  // a month/day pair (the loose `(\d{1,2})/(\d{1,2})` matched "26/04"
  // out of "2026/04/23" and rendered "26月4日"). Fall back to the
  // session.date object if the rawDate string doesn't match — that
  // way client-rendered timezone differences don't surface as bugs.
  const m = session.rawDate.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  const monthDay = m
    ? `${parseInt(m[2]!, 10)}月${parseInt(m[3]!, 10)}日`
    : `${session.date.getMonth() + 1}月${session.date.getDate()}日`;

  const chipColor = holiday
    ? "border-rose-400/45 bg-rose-400/10 text-rose-300"
    : decided
      ? "border-[var(--neon-cyan)]/40 bg-[var(--neon-cyan)]/8 text-[var(--neon-cyan)]"
      : "border-border/50 bg-background/30 text-foreground/85";

  const tooltip = `${session.rawDate}${decided ? " · 確定" : ""}${
    holidayName ? " · " + holidayName : holiday ? " · 祝日" : ""
  }${
    videoLink ? ` · ${videoLink.categoryName}/動画` : ""
  }`;

  // The chip's main affordance is the date itself, which becomes a
  // Link to the matching video when one exists. The tiny Logs button
  // (when set) sits to the right as a separate target.
  return (
    <li
      className={
        "inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[11px] " +
        chipColor
      }
      title={tooltip}
    >
      {videoLink ? (
        <Link
          href={videoLink.href}
          prefetch={false}
          className="group inline-flex items-center gap-0.5 underline decoration-dotted decoration-current/40 underline-offset-4 hover:decoration-current"
        >
          <span className="font-display tabular-nums">{monthDay}</span>
          <span className="text-[10px] opacity-75">（{session.dayOfWeek}）</span>
          <Film
            className="h-2.5 w-2.5 shrink-0 opacity-50 transition-opacity group-hover:opacity-100"
            aria-hidden
          />
        </Link>
      ) : (
        <>
          <span className="font-display tabular-nums">{monthDay}</span>
          <span className="text-[10px] opacity-75">（{session.dayOfWeek}）</span>
        </>
      )}
      {videoLink?.logsUrl && (
        <a
          href={videoLink.logsUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${monthDay} の FFLogs を開く`}
          title={`FFLogs: ${monthDay}`}
          className="inline-flex h-3.5 w-3.5 items-center justify-center rounded text-amber-300 transition-colors hover:bg-amber-400/15 hover:text-amber-200"
        >
          <BarChart3 className="h-2.5 w-2.5" aria-hidden />
        </a>
      )}
    </li>
  );
}
