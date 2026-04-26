"use client";

import { useEffect, useState } from "react";
import { Eye, EyeOff, ExternalLink } from "lucide-react";
import { NextSessionCard } from "./next-session-card";
import { ScheduleList } from "./schedule-list";
import type { NextSessionResult, ScheduleFetchResult } from "@/lib/schedule/next-session";

/**
 * Client wrapper that owns the past-sessions visibility state and
 * renders the page header (compact icon toggle + ext-site link), the
 * next-session card, and the full schedule list.
 *
 * UX:
 *   - Desktop: hover the eye icon to peek; click to pin/unpin
 *   - Mobile/touch: tap the eye icon to pin/unpin (no hover capability,
 *     so the click is the only mechanism — same as before but clutter-
 *     free since we no longer show "過去日程表示" / "非表示" text)
 *
 * Pinned state persists in localStorage under `STORAGE_KEY` so the user
 * doesn't have to re-toggle on every visit.
 */

const STORAGE_KEY = "raid-repo:show-past";

type Props = {
  result: ScheduleFetchResult;
  nextResult: NextSessionResult;
  scheduleUrl: string;
};

export function SchedulePageBody({ result, nextResult, scheduleUrl }: Props) {
  // Pinned: durable on/off, persisted across visits.
  const [pinned, setPinned] = useState(false);
  // Hovered: ephemeral peek mode while the cursor is over the eye icon.
  // Useless on touch devices (no hover) — there the click does the work.
  const [hovered, setHovered] = useState(false);
  const showPast = pinned || hovered;

  // Restore pinned state on mount.
  useEffect(() => {
    try {
      if (window.localStorage.getItem(STORAGE_KEY) === "1") {
        setPinned(true);
      }
    } catch {
      // ignore — localStorage unavailable in some embedded contexts
    }
  }, []);

  // Persist pinned changes.
  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, pinned ? "1" : "0");
    } catch {
      // ignore
    }
  }, [pinned]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-xl leading-tight text-foreground sm:text-2xl">
            Schedule
          </h1>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => setPinned((v) => !v)}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            aria-pressed={pinned}
            aria-label={pinned ? "過去日程を隠す" : "過去日程を表示"}
            title={
              pinned
                ? "クリックで非表示にする"
                : "ホバーで一時表示・クリックで固定表示（タップでも切替）"
            }
            className={
              "inline-flex h-8 w-8 items-center justify-center rounded-md border transition-colors " +
              (pinned
                ? "border-[var(--neon-cyan)]/60 bg-[var(--neon-cyan)]/10 text-[var(--neon-cyan)] shadow-[0_0_10px_-4px_var(--neon-cyan)]"
                : "border-border/60 text-muted-foreground hover:border-[var(--neon-cyan)]/60 hover:text-foreground")
            }
          >
            {showPast ? (
              <EyeOff className="h-4 w-4" aria-hidden />
            ) : (
              <Eye className="h-4 w-4" aria-hidden />
            )}
          </button>
          <a
            href={scheduleUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="元サイトを開く"
            title="元サイトを開く"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border/60 text-muted-foreground transition-colors hover:border-[var(--neon-cyan)]/60 hover:text-foreground"
          >
            <ExternalLink className="h-4 w-4" aria-hidden />
          </a>
        </div>
      </div>

      <NextSessionCard result={nextResult} />

      <ScheduleList
        result={result}
        showPast={showPast}
        scheduleUrl={scheduleUrl}
      />
    </div>
  );
}
