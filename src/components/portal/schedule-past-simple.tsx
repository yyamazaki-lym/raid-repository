"use client";

import Link from "next/link";
import { BarChart3, Film } from "lucide-react";
import { Card } from "@/components/ui/card";
import {
  getJapaneseHolidayName,
  isJapaneseHoliday,
} from "@/lib/japanese-holidays";
import type { JapaneseHolidaysMap } from "@/lib/japanese-holidays";
import { useRealtimeScheduleMemos } from "@/lib/schedule-memos-client";
import type { ScheduleSession } from "@/lib/schedule/next-session";
import type { SessionVideoLink } from "@/lib/server/session-video-link";
import {
  SessionMemoDot,
  SessionMemoPopover,
} from "./session-memo-popover";

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
// Reduced from 10 → 7: adding the video Link icon + Logs icon made
// each chip ~30% wider, so 10 was wrapping to a second line on most
// viewports. Seven fits comfortably on a single line at common widths.
const SIMPLE_LIMIT = 7;

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
      <ul className="flex flex-wrap gap-1.5 px-3 py-2">
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
  const memos = useRealtimeScheduleMemos(session.rawDate, []);
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

  // The chip's date text is plain (no link / no underline) so the
  // visual stays calm. Action icons sit at the right edge: a small
  // Film icon links into the matched video card, and a BarChart3
  // icon opens FFLogs when the matched video has logs_url set.
  // `font-mono` + `leading-none` on every child so all glyphs share
  // the same baseline / x-height — `font-display` was misaligning
  // against the default-font 曜 parens.
  // Fixed h-6 + items-center so the date text is dead-centered
  // vertically — `py-* + leading-none` was producing slight optical
  // asymmetry where the smaller 曜 glyphs sat above the date center.
  return (
    <li
      className={
        "inline-flex h-6 items-center gap-1 rounded-sm border px-1.5 font-mono text-[11px] leading-none " +
        chipColor
      }
      title={tooltip}
    >
      {/* Date+曜 wrapped in a memo popover trigger. Click reveals
          per-session shared notes. The dot indicator sits AFTER all
          icons (rightmost) so it doesn't crowd the date label.
          Single span so date and 曜 share the same baseline / size /
          line-height — earlier two-span layout (different text sizes)
          made the optical center drift. */}
      <SessionMemoPopover
        rawDate={session.rawDate}
        displayDate={`${monthDay}（${session.dayOfWeek}）`}
        memos={memos}
      >
        <span className="tabular-nums">
          {monthDay}（{session.dayOfWeek}）
        </span>
      </SessionMemoPopover>
      {videoLink && (
        <Link
          href={videoLink.href}
          prefetch={false}
          aria-label={`${videoLink.categoryName}/動画「${videoLink.videoTitle}」を開く`}
          title={`${videoLink.categoryName}/動画 → 「${videoLink.videoTitle}」`}
          className="inline-flex h-3.5 w-3.5 items-center justify-center rounded text-current/80 transition-colors hover:bg-current/15 hover:text-current"
        >
          <Film className="h-2.5 w-2.5" aria-hidden />
        </Link>
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
      <SessionMemoDot count={memos.length} className="ml-0.5" />
    </li>
  );
}
