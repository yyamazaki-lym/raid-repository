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
import type { ScheduleSessionMemo } from "@/lib/schedule-memos-client";
import type { NextSessionResult, ScheduleFetchResult } from "@/lib/schedule/next-session";
import type { SessionLogEntry } from "@/lib/schedule/session-logs";
import type { ScheduleSourceMode } from "@/lib/schedule/source-mode";
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
  /**
   * sync モードでは character-sheets URL、native モードでは `null`。
   * 「元サイトを開く」リンクの表示有無に使う。
   */
  scheduleUrl: string | null;
  /**
   * TODO #2 phase 1 (2026-05-07): スケジュールソースモード。
   * `disabled` のときはこのコンポーネントは render されない (page で
   * 別 notice 表示)。`native` は phase 1 では skeleton (空 sessions)。
   */
  mode: ScheduleSourceMode;
  /** Pre-fetched Japanese holidays map (date → holiday name). */
  holidays?: JapaneseHolidaysMap;
  /** Pre-fetched PT-募集 templates (server-rendered initial state). */
  recruitmentTemplates?: RecruitmentTemplate[];
  /**
   * Categories for the recruitment-templates popover. `slug` is used
   * by the per-category macro-page link icon shown next to each
   * category header inside the popover.
   */
  recruitmentCategories?: { id: string; name: string; slug: string }[];
  /**
   * Pre-built map of `session.rawDate` → matching video page link.
   * Used by the schedule date cells to deep-link into the video.
   */
  sessionVideoLinks?: Record<string, SessionVideoLink[]>;
  /**
   * Pre-built map of `session.rawDate` → FFLogs URL entries stored in
   * the `schedule_past_session_logs` child table. Surfaced as a Logs
   * icon in the date cell even when no matching video exists. TODO #64
   * (2.1, 2026-05-02 part5): array form replaces the legacy single
   * `string` to allow multiple URLs per date.
   */
  sessionLogsByDate?: Record<string, SessionLogEntry[]>;
  /**
   * True if the group has at least one cleared Ultimate (`絶...` +
   * status = `クリア済`). Drives the schedule-legend label MEMBERS
   * → LEGENDS swap (1.9.16).
   */
  hasUltimateClear?: boolean;
  /**
   * 運用ルール / 注意事項のローカル override (`schedule_top_text_override`)。
   * 設定済みなら scraped 値 (`result.data.topText`) より優先表示。
   */
  topTextOverride?: string | null;
  /**
   * TODO #11: server で一括 prefetch した memos (rawDate → memos[])。
   * 各 chip / row が個別 SELECT をかけずにここから初期表示できるので
   * メモバッジが即時に表示される。realtime subscription は live 更新
   * 用にそのまま維持。
   */
  initialMemosByDate?: Record<string, ScheduleSessionMemo[]>;
};

export function SchedulePageBody({
  result,
  nextResult,
  scheduleUrl,
  mode,
  holidays,
  recruitmentTemplates = [],
  recruitmentCategories = [],
  sessionVideoLinks,
  sessionLogsByDate,
  hasUltimateClear = false,
  topTextOverride = null,
  initialMemosByDate = {},
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
          {/* Simple toggle: click-only. Tooltip phrasing chosen to be
              short and unambiguous about "this shows past sessions". */}
          <ToggleButton
            pinned={pinnedSimple}
            hovered={false}
            onPin={() => setPinnedSimple((v) => !v)}
            onHover={() => {}}
            ariaLabel={
              pinnedSimple ? "過去の活動 (簡易) を隠す" : "過去の活動 (簡易)"
            }
            title={
              pinnedSimple
                ? "過去の活動 (簡易) — 表示中"
                : "過去の活動 (簡易) — 直近の日付チップ"
            }
            Icon={History}
          />
          <ToggleButton
            pinned={pinnedDetail}
            hovered={hoveredDetail}
            onPin={() => setPinnedDetail((v) => !v)}
            onHover={setHoveredDetail}
            ariaLabel={
              pinnedDetail
                ? "過去の活動 (詳細) を隠す"
                : "過去の活動 (詳細)"
            }
            title={
              pinnedDetail
                ? "過去の活動 (詳細) — 表示中"
                : "過去の活動 (詳細) — 出席者付きの全件表"
            }
            Icon={Table}
          />
          <RecruitmentTemplatesButton
            initial={recruitmentTemplates}
            categories={recruitmentCategories}
          />
          {scheduleUrl && (
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
          )}
        </div>
      </div>

      {mode === "native" && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-200">
          自前スケジュール (準備中) — 候補日追加 / 出欠入力 UI は phase 2
          で実装予定です。現在は空状態の表示のみ動作確認できます。
        </div>
      )}

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
          initialMemosByDate={initialMemosByDate}
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
        topTextOverride={topTextOverride}
        initialMemosByDate={initialMemosByDate}
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
