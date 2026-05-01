"use client";

import { useRef } from "react";
import { BarChart3, Film } from "lucide-react";
import { Card } from "@/components/ui/card";
import {
  getJapaneseHolidayName,
  isJapaneseHoliday,
} from "@/lib/japanese-holidays";
import Link from "next/link";
import { safeHref } from "@/lib/url-safe";
import type { JapaneseHolidaysMap } from "@/lib/japanese-holidays";
import {
  useRealtimeAllScheduleMemos,
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
  initialMemosByDate = {},
}: {
  sessions: ScheduleSession[];
  holidays?: JapaneseHolidaysMap;
  sessionVideoLinks?: Record<string, SessionVideoLink>;
  /** FFLogs URLs keyed by `rawDate` — fallback when no video. */
  sessionLogsByDate?: Record<string, string>;
  /** TODO #11: server prefetched memos (rawDate → memos[]) */
  initialMemosByDate?: Record<string, ScheduleSessionMemo[]>;
}) {
  // TODO #11 phase 7: 親で 1 channel だけ subscribe (旧: 各 DateChip が個別)。
  const { memosByDate, refetchAll: refetchMemos } =
    useRealtimeAllScheduleMemos(initialMemosByDate);

  const cutoff = Date.now() - STILL_RELEVANT_MS;
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
  videoLink,
  sessionLogsUrl,
  memos,
  onRefreshMemos,
}: {
  session: ScheduleSession;
  holidays?: JapaneseHolidaysMap;
  videoLink: SessionVideoLink | null;
  /** Fallback FFLogs URL for sessions without a matching video. */
  sessionLogsUrl: string | null;
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
      {videoLink && (() => {
        // 簡易ログのチップは「過去日程」のみを描画 (recent fileter で
        // 確定済み)。詳細テーブルと同じく、Film アイコンクリックは
        // ポータル内動画ページではなく直接外部 URL を新規タブで開く
        // (Logs アイコンと同じ挙動)。`safeHref` を通すことで http(s)
        // 以外の URL が混入しても DOM に到達しない。`url` が無い古い
        // データに備えて従来 `href` への Link を fallback として残す。
        const externalUrl = safeHref(videoLink.url);
        if (externalUrl) {
          return (
            <a
              href={externalUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${videoLink.categoryName}/動画「${videoLink.videoTitle}」を新規タブで開く`}
              title={`${videoLink.categoryName}/動画 → 「${videoLink.videoTitle}」 (外部リンク)`}
              className="inline-flex h-4 w-4 items-center justify-center rounded text-current/75 transition-all hover:bg-current/15 hover:text-current"
            >
              <Film className="h-2.5 w-2.5" aria-hidden />
            </a>
          );
        }
        // 2.1 (2026-05-01) TODO #54 part2-d: schedule-list と同様 viewport
        // 自動 prefetch を抑制。過去カードも N 個並ぶリスト系。chunk hash
        // mismatch の silent fail は ChunkErrorHandler が catch して reload
        // するので保険済。
        return (
          <Link
            href={videoLink.href}
            prefetch={false}
            aria-label={`${videoLink.categoryName}/動画「${videoLink.videoTitle}」を開く`}
            title={`${videoLink.categoryName}/動画 → 「${videoLink.videoTitle}」`}
            className="inline-flex h-4 w-4 items-center justify-center rounded text-current/75 transition-all hover:bg-current/15 hover:text-current"
          >
            <Film className="h-2.5 w-2.5" aria-hidden />
          </Link>
        );
      })()}
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
