"use client";

import { useRef } from "react";
import { Card } from "@/components/ui/card";
import {
  getJapaneseHolidayName,
  isJapaneseHoliday,
} from "@/lib/japanese-holidays";
import type { JapaneseHolidaysMap } from "@/lib/japanese-holidays";
import {
  useRealtimeAllScheduleMemos,
  type ScheduleSessionMemo,
} from "@/lib/schedule-memos-client";
import { jstTodayStartMs } from "@/lib/schedule/jst-cutoff";
import type { ScheduleSession } from "@/lib/schedule/next-session";
import type { SessionLogEntry } from "@/lib/schedule/session-logs";
import type { SessionVideoLink } from "@/lib/server/session-video-link";
import { SessionActionIcons } from "./schedule/session-action-icons";
import { SessionMemoDot } from "./schedule/session-memo-dot";
import {
  SessionMemoPopover,
  type SessionMemoPopoverHandle,
} from "./session-memo-popover-lazy";

// Stable reference for the realtime hook's initial param. Passing `[]`
// inline creates a fresh array on every render, which trips the hook's
// "initial reference changed → reset state" guard and clobbers the
// fetched memos. Module-level constant keeps the reference identity.
const EMPTY_MEMOS: ScheduleSessionMemo[] = [];
const EMPTY_SESSION_LOGS: SessionLogEntry[] = [];
const EMPTY_VIDEO_LINKS: SessionVideoLink[] = [];

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

// Reduced from 10 → 7: adding the video Link icon + Logs icon made
// each chip ~30% wider, so 10 was wrapping to a second line on most
// viewports. Seven fits comfortably on a single line at common widths.
const SIMPLE_LIMIT = 7;

export function SchedulePastSimple({
  sessions,
  holidays,
  sessionVideoLinks,
  sessionLogsByDate,
  initialMemosByDate = {},
}: {
  sessions: ScheduleSession[];
  holidays?: JapaneseHolidaysMap;
  sessionVideoLinks?: Record<string, SessionVideoLink[]>;
  /**
   * FFLogs URL entries keyed by `rawDate` — used as a fallback Logs
   * source when no matching video exists. TODO #64 (2.1, 2026-05-02
   * part5): array form replaces the legacy single string.
   */
  sessionLogsByDate?: Record<string, SessionLogEntry[]>;
  /** TODO #11: server prefetched memos (rawDate → memos[]) */
  initialMemosByDate?: Record<string, ScheduleSessionMemo[]>;
}) {
  // TODO #11 phase 7: 親で 1 channel だけ subscribe (旧: 各 DateChip が個別)。
  const { memosByDate, refetchAll: refetchMemos } =
    useRealtimeAllScheduleMemos(initialMemosByDate);

  // 過去判定の cutoff は詳細テーブル (schedule-list.tsx の splitSessions)
  // と同じ「JST 今日 0:00」に統一 (2.7, 2026-06-11)。旧実装は
  // `Date.now() - 6h` (NextSessionCard の STILL_RELEVANT_MS と同じ
  // グレース) で、開催翌日の 0:00〜開始+6h の間「詳細には出るが簡易
  // には出ない」不一致が起きていた。統一の代償として、その時間帯は
  // NextSessionCard (6h グレースで前日分を「次回」に残す) とこのチップ
  // の両方に同じ日程が出るが、詳細テーブルが元々持っていた重複と同じ
  // 挙動であり許容する。
  const cutoff = jstTodayStartMs();
  // 過去側は「開催確定 (DECISION)」のみ表示。◯ は『参加可投票』であって
  // 実際に開催された記録ではないので fallback シグナルに使えない (流れ
  // た候補日でも投票だけ残るため、◯ 1 名以上を許可するとノイズが増える)。
  // 古い character-sheets 行は aged out で DECISION が落ちるため見えな
  // くなるが、その分は `mergeStoredPastSessions` 経由で Discord 取り込
  // み / snapshot 由来行が DECISION 扱いで補完する設計 (TODO #24)。
  const recent = [...sessions]
    .filter((s) => s.date.getTime() < cutoff && s.status === "DECISION")
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
            · 簡易ログ (日付チップ)
          </span>
        </div>
        <span className="text-[10px] tabular-nums text-muted-foreground/80">
          直近 {recent.length} 件
        </span>
      </header>
      <ul className="flex flex-wrap gap-1.5 px-3 py-2.5">
        {recent.map((s) => (
          <DateChip
            key={s.rawDate}
            session={s}
            holidays={holidays}
            videoLinks={sessionVideoLinks?.[s.rawDate] ?? EMPTY_VIDEO_LINKS}
            sessionLogs={sessionLogsByDate?.[s.rawDate] ?? EMPTY_SESSION_LOGS}
            memos={memosByDate[s.rawDate] ?? EMPTY_MEMOS}
            onRefreshMemos={refetchMemos}
          />
        ))}
      </ul>
    </Card>
  );
}

function DateChip({
  session,
  holidays,
  videoLinks,
  sessionLogs,
  memos,
  onRefreshMemos,
}: {
  session: ScheduleSession;
  holidays?: JapaneseHolidaysMap;
  /**
   * TODO #65 (2.1, 2026-05-02 part6): array form so chips can use the
   * shared `SessionActionIcons` 0/1/2+ branching (DropdownMenu when
   * multiple) — same UX as the detail past table.
   */
  videoLinks: SessionVideoLink[];
  /**
   * `schedule_past_session_logs` entries for this date. TODO #65: now
   * passed through whole — `SessionActionIcons` handles single vs
   * multi-URL display itself.
   */
  sessionLogs: SessionLogEntry[];
  /** 親 `useRealtimeAllScheduleMemos` で集約した live slice (TODO #11 phase 7)。 */
  memos: ScheduleSessionMemo[];
  /** Server-action 後の保険 refetch (旧 useRealtimeScheduleMemos の refetch 互換)。 */
  onRefreshMemos: () => Promise<void>;
}) {
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

  // 祝日は文字色のみ rose にし、border / bg は他の日付チップと揃える
  // (祝日かどうかの違いを枠まで主張すると、確定済 (cyan) との視覚的
  // 区別が混線するため)。過去簡易ログは DECISION のみ描画する仕様な
  // ので実質 decided 分岐固定だが、コードの一貫性のため両方サポート。
  const chipColor = decided
    ? `border-[var(--neon-cyan)]/40 bg-[var(--neon-cyan)]/8 ${holiday ? "text-rose-300" : "text-[var(--neon-cyan)]"}`
    : `border-border/50 bg-background/30 ${holiday ? "text-rose-300" : "text-foreground/85"}`;

  // TODO #65: tooltip simplified — chip-level tooltip just states what
  // the date is. Per-icon hover labels live on each link / dropdown
  // item via `SessionActionIcons` (which renders 0/1/2+ branches).
  const hasVideos = videoLinks.length > 0;
  const hasFallbackLogs = sessionLogs.length > 0;
  const hasVideoLogs = videoLinks.some((v) => Boolean(v.logsUrl));
  const tooltip = `${session.rawDate}${decided ? " · 確定" : ""}${
    holidayName ? " · " + holidayName : holiday ? " · 祝日" : ""
  }${hasVideos ? ` · 動画 ${videoLinks.length} 件` : ""}${
    !hasVideoLogs && hasFallbackLogs ? " · FFLogs" : ""
  }`;

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
        // 1.9.38: ABANDONED vertical-center pursuit. Versions
        // 1.9.28-1.9.37 attempted h-6 + leading-6, leading-none,
        // asymmetric padding, transform: translateY, inline-grid +
        // place-items-center — all left some users seeing top-heavy
        // glyphs due to system Japanese font (Yu Gothic UI) metric
        // asymmetry. Reverted to simple symmetric `py-1` + leading-
        // tight inline-flex layout. The slight font-metric drift on
        // Windows is accepted — pursuing it further was hurting
        // icon alignment.
        "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] tabular-nums leading-tight transition-colors " +
        chipColor
      }
      title={tooltip}
    >
      <SessionMemoPopover
        ref={popoverRef}
        rawDate={session.rawDate}
        displayDate={`${monthDay}（${session.dayOfWeek}）`}
        memos={memos}
        onRefresh={onRefreshMemos}
        sessionLogs={sessionLogs}
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
      {/* TODO #65: chip と詳細テーブルで同じ 0/1/2+ 分岐を共有。
          chip 用に `size="compact"` (h-4/h-2.5) + `placeholder={false}`
          (空 slot は描画せずに chip 幅を可変) で呼び出す。 */}
      <SessionActionIcons
        videoLinks={videoLinks}
        sessionLogs={sessionLogs}
        isPast
        displayDate={`${monthDay}（${session.dayOfWeek}）`}
        size="compact"
        placeholder={false}
      />
      <SessionMemoDot
        count={memos.length}
        className="ml-0.5"
        onClick={() => popoverRef.current?.toggle()}
      />
    </li>
  );
}
