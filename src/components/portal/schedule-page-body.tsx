"use client";

import { useEffect, useState } from "react";
import { History, Table, ExternalLink } from "lucide-react";
import { NextSessionCard } from "./next-session-card";
import {
  RecruitmentTemplatesButton,
  RecruitmentTopCopyButton,
} from "./recruitment-templates-button";
import { ScheduleList } from "./schedule-list";
import { SchedulePastSimple } from "./schedule-past-simple";
import type { JapaneseHolidaysMap } from "@/lib/japanese-holidays";
import type { RecruitmentTemplate } from "@/lib/recruitment-templates-client";
import type { NextSessionResult, ScheduleFetchResult } from "@/lib/schedule/next-session";
import type { SessionVideoLink } from "@/lib/server/session-video-link";

/**
 * Client wrapper that owns the past-sessions visibility state and
 * renders the page header (compact icon toggles + ext-site link),
 * the next-session card, and the schedule list.
 *
 * Two independent past-view modes:
 *   - Simple: a compact 10-date chronological strip between the
 *     "next session" card and the upcoming-sessions card. Date-only
 *     by default, no participant columns. Toggled by the History icon.
 *   - Detailed: the full table at the bottom of the page (with
 *     participants + time-of-day). Toggled by the Table icon.
 *
 * Each toggle has its own pinned state (localStorage-persisted) plus
 * a transient hover state for desktop peek.
 */

const SIMPLE_KEY = "raid-repo:show-past";
const DETAIL_KEY = "raid-repo:show-past-detail";

type Props = {
  result: ScheduleFetchResult;
  nextResult: NextSessionResult;
  scheduleUrl: string;
  /** Pre-fetched Japanese holidays map (date → holiday name). */
  holidays?: JapaneseHolidaysMap;
  /** Pre-fetched PT-募集 templates (server-rendered initial state). */
  recruitmentTemplates?: RecruitmentTemplate[];
  /** Categories for the recruitment-templates dialog category picker. */
  recruitmentCategories?: { id: string; name: string }[];
  /**
   * Pre-built map of `session.rawDate` → matching video page link.
   * Used by the schedule date cells to deep-link into the video.
   */
  sessionVideoLinks?: Record<string, SessionVideoLink>;
  /**
   * Pre-built map of `session.rawDate` → FFLogs URL stored on the
   * past-session row. Surfaced as a Logs icon in the date cell even
   * when no matching video exists.
   */
  sessionLogsByDate?: Record<string, string>;
  /**
   * True if the group has at least one cleared Ultimate (`絶...` +
   * status = `クリア済`). Drives the schedule-legend label MEMBERS
   * → LEGENDS swap (1.9.16).
   */
  hasUltimateClear?: boolean;
};

export function SchedulePageBody({
  result,
  nextResult,
  scheduleUrl,
  holidays,
  recruitmentTemplates = [],
  recruitmentCategories = [],
  sessionVideoLinks,
  sessionLogsByDate,
  hasUltimateClear = false,
}: Props) {
  // Two-toggle state: simple list (top) and detailed table (bottom).
  // Both default to off; pinned values persist via localStorage.
  //
  // Simple toggle is click-only — the hover-peek pattern was found
  // disorienting (the strip flickering in/out as the cursor crossed
  // the icon). Detail keeps the hover-peek since it's a more drastic
  // change the user typically wants to glance at before pinning.
  const [pinnedSimple, setPinnedSimple] = useState(false);

  const [pinnedDetail, setPinnedDetail] = useState(false);
  const [hoveredDetail, setHoveredDetail] = useState(false);
  const showDetail = pinnedDetail || hoveredDetail;

  useEffect(() => {
    try {
      if (window.localStorage.getItem(SIMPLE_KEY) === "1") setPinnedSimple(true);
      if (window.localStorage.getItem(DETAIL_KEY) === "1") setPinnedDetail(true);
    } catch {
      // ignore — localStorage unavailable in some embedded contexts
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(SIMPLE_KEY, pinnedSimple ? "1" : "0");
    } catch {
      // ignore
    }
  }, [pinnedSimple]);

  useEffect(() => {
    try {
      window.localStorage.setItem(DETAIL_KEY, pinnedDetail ? "1" : "0");
    } catch {
      // ignore
    }
  }, [pinnedDetail]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-xl leading-tight text-foreground sm:text-2xl">
            Schedule
          </h1>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {/* Simple toggle: click-only (no hover-peek — felt
              disorienting as the strip flashed in/out under the
              cursor). State is solely the pinned bool. */}
          <ToggleButton
            pinned={pinnedSimple}
            hovered={false}
            onPin={() => setPinnedSimple((v) => !v)}
            onHover={() => {}}
            ariaLabel={pinnedSimple ? "過去日程の簡易表示を隠す" : "過去日程の簡易表示"}
            title={
              pinnedSimple
                ? "簡易表示: ON（クリックで非表示）"
                : "簡易表示: OFF（クリック/タップで表示）"
            }
            Icon={History}
          />
          <ToggleButton
            pinned={pinnedDetail}
            hovered={hoveredDetail}
            onPin={() => setPinnedDetail((v) => !v)}
            onHover={setHoveredDetail}
            ariaLabel={pinnedDetail ? "過去日程の詳細表示を隠す" : "過去日程の詳細表示"}
            title={
              pinnedDetail
                ? "詳細表示: ON — 参加者付きの全件表（下部に表示）"
                : "詳細表示: OFF — 参加者付きの全件表（クリックで下部に表示）"
            }
            Icon={Table}
          />
          <RecruitmentTemplatesButton
            initial={recruitmentTemplates}
            categories={recruitmentCategories}
          />
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

      <NextSessionCard
        result={nextResult}
        recruitmentTopButton={
          recruitmentTemplates.length > 0 ? (
            <RecruitmentTopCopyButton initial={recruitmentTemplates} />
          ) : null
        }
      />

      {/* Simple past strip — fits between NextSession and Upcoming
          without disturbing the main layout. Shown only when the
          History toggle is pinned (no hover-peek for this one). */}
      {pinnedSimple && result.ok && (
        <SchedulePastSimple
          sessions={result.data.sessions}
          holidays={holidays}
          sessionVideoLinks={sessionVideoLinks}
          sessionLogsByDate={sessionLogsByDate}
        />
      )}

      <ScheduleList
        result={result}
        showDetailedPast={showDetail}
        scheduleUrl={scheduleUrl}
        holidays={holidays}
        sessionVideoLinks={sessionVideoLinks}
        sessionLogsByDate={sessionLogsByDate}
        hasUltimateClear={hasUltimateClear}
      />
    </div>
  );
}

/**
 * Compact toggle button used for both past-view modes. Shares the
 * three-state visual treatment (off / hover-peek / pinned-on) so the
 * user gets consistent feedback regardless of which toggle they're
 * interacting with.
 */
function ToggleButton({
  pinned,
  hovered,
  onPin,
  onHover,
  ariaLabel,
  title,
  Icon,
}: {
  pinned: boolean;
  hovered: boolean;
  onPin: () => void;
  onHover: (value: boolean) => void;
  ariaLabel: string;
  title: string;
  Icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
}) {
  const active = pinned || hovered;
  return (
    <button
      type="button"
      onClick={onPin}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      aria-pressed={pinned}
      aria-label={ariaLabel}
      title={title}
      className={
        "inline-flex h-8 w-8 items-center justify-center rounded-md border transition-colors " +
        (pinned
          ? "border-[var(--neon-cyan)]/60 bg-[var(--neon-cyan)]/10 text-[var(--neon-cyan)] shadow-[0_0_10px_-4px_var(--neon-cyan)]"
          : "border-border/60 text-muted-foreground hover:border-[var(--neon-cyan)]/60 hover:text-foreground")
      }
    >
      <Icon
        className={
          "h-4 w-4 transition-transform " +
          (active && !pinned ? "scale-110" : "")
        }
        aria-hidden
      />
    </button>
  );
}
