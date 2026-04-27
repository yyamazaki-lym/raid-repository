"use client";

import { useRef } from "react";
import Link from "next/link";
import { BarChart3, Film } from "lucide-react";
import { Card } from "@/components/ui/card";
import {
  getJapaneseHolidayName,
  isJapaneseHoliday,
} from "@/lib/japanese-holidays";
import { safeHref } from "@/lib/url-safe";
import type { JapaneseHolidaysMap } from "@/lib/japanese-holidays";
import {
  useRealtimeScheduleMemos,
  type ScheduleSessionMemo,
} from "@/lib/schedule-memos-client";
import type { ScheduleSession } from "@/lib/schedule/next-session";
import type { SessionVideoLink } from "@/lib/server/session-video-link";
import {
  SessionMemoDot,
  SessionMemoPopover,
  type SessionMemoPopoverHandle,
} from "./session-memo-popover";

// Stable reference for the realtime hook's initial param. Passing `[]`
// inline creates a fresh array on every render, which trips the hook's
// "initial reference changed → reset state" guard and clobbers the
// fetched memos. Module-level constant keeps the reference identity.
const EMPTY_MEMOS: ScheduleSessionMemo[] = [];

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
  sessionLogsByDate,
}: {
  sessions: ScheduleSession[];
  holidays?: JapaneseHolidaysMap;
  sessionVideoLinks?: Record<string, SessionVideoLink>;
  /** FFLogs URLs keyed by `rawDate` — fallback when no video. */
  sessionLogsByDate?: Record<string, string>;
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
          Past
          <span className="font-sans text-[11px] tracking-normal normal-case text-muted-foreground/85">
            · 過去の活動
          </span>
        </div>
        <span className="font-mono text-[10px] tabular-nums text-muted-foreground/80">
          直近 {recent.length} 件
        </span>
      </header>
      <ul className="flex flex-wrap gap-1.5 px-3 py-2.5">
        {recent.map((s) => (
          <DateChip
            key={s.rawDate}
            session={s}
            holidays={holidays}
            videoLink={sessionVideoLinks?.[s.rawDate] ?? null}
            sessionLogsUrl={sessionLogsByDate?.[s.rawDate] ?? null}
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
  sessionLogsUrl,
}: {
  session: ScheduleSession;
  holidays?: JapaneseHolidaysMap;
  videoLink: SessionVideoLink | null;
  /** Fallback FFLogs URL for sessions without a matching video. */
  sessionLogsUrl: string | null;
}) {
  const { memos, refetch: refetchMemos } = useRealtimeScheduleMemos(
    session.rawDate,
    EMPTY_MEMOS,
  );
  // Ref to the popover so the (separately-rendered) memo dot can
  // open it. Keeping the dot outside the popover wrapper preserves
  // the chip's left-to-right reading order: date → icons → dot.
  const popoverRef = useRef<SessionMemoPopoverHandle>(null);
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

  const hasLogs = Boolean(videoLink?.logsUrl ?? sessionLogsUrl);
  const tooltip = `${session.rawDate}${decided ? " · 確定" : ""}${
    holidayName ? " · " + holidayName : holiday ? " · 祝日" : ""
  }${
    videoLink ? ` · ${videoLink.categoryName}/動画` : ""
  }${hasLogs && !videoLink?.logsUrl ? " · FFLogs" : ""}`;

  // The chip's date text is plain (no link / no underline) so the
  // visual stays calm. Action icons sit at the right edge: a small
  // Film icon links into the matched video card, and a BarChart3
  // icon opens FFLogs when the matched video has logs_url set.
  // `font-mono` + `leading-none` on every child so all glyphs share
  // the same baseline / x-height — `font-display` was misaligning
  // against the default-font 曜 parens.
  // Padding-only sizing (no fixed height, no leading-none). Lets the
  // line-box render naturally so CJK glyph metrics don't fight a
  // forced 1.0 line-height — produces symmetric top / bottom space.
  return (
    <li
      className={
        // 1.9.29: use `leading-6` (24px) so the line-box exactly fills
        // the h-6 (24px) box. The browser's natural baseline-center
        // within the line-box puts the glyphs at the chip's optical
        // center reliably across system Japanese font fallbacks. Earlier
        // tries with `leading-none` (collapsed) and `leading-tight`
        // (1.25× = 13.75px line-box in a 24px box) both left visible
        // top/bottom asymmetry.
        "inline-flex h-6 items-center gap-1 rounded-md border px-2 text-[11px] tabular-nums leading-6 transition-colors " +
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
        ref={popoverRef}
        rawDate={session.rawDate}
        displayDate={`${monthDay}（${session.dayOfWeek}）`}
        memos={memos}
        onRefresh={refetchMemos}
        currentLogsUrl={videoLink?.logsUrl ?? sessionLogsUrl ?? null}
        sessionDetails={{
          parsedDate: session.date.toISOString(),
          startTime: session.startTime,
          endTime: session.endTime,
          dayOfWeek: session.dayOfWeek,
        }}
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
          className="inline-flex h-4 w-4 items-center justify-center rounded text-current/75 transition-all hover:bg-current/15 hover:text-current"
        >
          <Film className="h-2.5 w-2.5" aria-hidden />
        </Link>
      )}
      {(() => {
        // Same priority as schedule-list: video.logs_url first, then
        // session-level fallback. Lets the chip surface a Logs icon
        // for sessions that have no recorded video. safeHref drops
        // anything that isn't http(s) so a malformed/dangerous URL
        // can't reach the DOM.
        const logsUrl = safeHref(videoLink?.logsUrl ?? sessionLogsUrl);
        if (!logsUrl) return null;
        return (
          <a
            href={logsUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${monthDay} の FFLogs を開く`}
            title={`FFLogs: ${monthDay}`}
            className="inline-flex h-4 w-4 items-center justify-center rounded text-amber-300/85 transition-all hover:bg-amber-400/15 hover:text-amber-200 hover:shadow-[0_0_8px_-2px_rgba(251,191,36,0.55)]"
          >
            <BarChart3 className="h-2.5 w-2.5" aria-hidden />
          </a>
        );
      })()}
      <SessionMemoDot
        count={memos.length}
        className="ml-0.5"
        onClick={() => popoverRef.current?.open()}
      />
    </li>
  );
}
