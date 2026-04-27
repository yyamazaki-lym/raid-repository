import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { CalendarX2, AlertTriangle, BarChart3, Film } from "lucide-react";
import { Card } from "@/components/ui/card";
import { CommentPopover } from "./comment-popover";
import { ScheduleEditFrameDialog } from "./schedule-edit-frame-dialog";
import {
  SessionMemoDot,
  SessionMemoPopover,
  type SessionMemoPopoverHandle,
} from "./session-memo-popover";
import {
  useRealtimeScheduleMemos,
  type ScheduleSessionMemo,
} from "@/lib/schedule-memos-client";
import {
  getJapaneseHolidayName,
  isJapaneseHoliday,
} from "@/lib/japanese-holidays";
import { safeHref } from "@/lib/url-safe";
import type { JapaneseHolidaysMap } from "@/lib/japanese-holidays";
import type {
  Attendance,
  ScheduleComment,
  ScheduleFetchResult,
  ScheduleSession,
  ScheduleUser,
} from "@/lib/schedule/next-session";
import type { SessionVideoLink } from "@/lib/server/session-video-link";

// Stable reference for the realtime hook's initial param — `[]` inline
// would be a fresh array on every render and trip the hook's
// "initial-changed" guard, clobbering fetched memos with empty.
const EMPTY_MEMOS: ScheduleSessionMemo[] = [];

const ATT_TONE: Record<Attendance, string> = {
  "◯": "text-[var(--neon-cyan)] bg-[var(--neon-cyan)]/10 border-[var(--neon-cyan)]/30",
  "⏰": "text-amber-300 bg-amber-300/10 border-amber-300/30",
  "△": "text-[var(--neon-violet)] bg-[var(--neon-violet)]/10 border-[var(--neon-violet)]/30",
  "×": "text-rose-400 bg-rose-400/10 border-rose-400/30",
  "－": "text-muted-foreground bg-secondary/30 border-border/50",
};

const ATT_LEGEND: { symbol: Attendance; label: string }[] = [
  { symbol: "◯", label: "参加可" },
  { symbol: "⏰", label: "遅刻" },
  { symbol: "△", label: "未定" },
  { symbol: "×", label: "不可" },
  { symbol: "－", label: "未回答" },
];

type Props = {
  result: ScheduleFetchResult;
  /** Maximum sessions to render. Defaults to all upcoming + a small past buffer. */
  limit?: number;
  /**
   * When true, render the FULL detailed past-sessions table at the
   * bottom (with participant columns + time-of-day). The simple
   * date-only strip lives in a separate component (SchedulePastSimple)
   * inserted between the next-session card and the upcoming table.
   */
  showDetailedPast?: boolean;
  /** Source schedule URL — used to derive the per-user edit URL on hover/click. */
  scheduleUrl?: string | null;
  /**
   * Pre-fetched Japanese-holiday map (date → holiday name) passed down
   * from the server page. Used to color holiday rows red and surface
   * the holiday name in the date-cell tooltip. When undefined, the
   * synchronous hardcoded fallback is used.
   */
  holidays?: JapaneseHolidaysMap;
  /**
   * Pre-built `YYYY-MM-DD` → matching-video-link map. When a past
   * session has an entry, its date cell becomes a Link to that
   * video; otherwise the cell renders as plain text.
   */
  sessionVideoLinks?: Record<string, SessionVideoLink>;
  /**
   * Pre-built `rawDate` → FFLogs URL map for past sessions. Lets the
   * UI show a Logs icon next to a date even when there's no matching
   * video for that session.
   */
  sessionLogsByDate?: Record<string, string>;
  /**
   * True if the group has at least one Ultimate cleared. Drives the
   * legend label MEMBERS → LEGENDS swap (1.9.16). Default false.
   */
  hasUltimateClear?: boolean;
};

export function ScheduleList({
  result,
  limit,
  showDetailedPast = false,
  scheduleUrl,
  holidays,
  sessionVideoLinks,
  sessionLogsByDate,
  hasUltimateClear = false,
}: Props) {
  // 1.9.13: replace `target="_blank"` external nav with an in-portal
  // iframe overlay. Tapping a username header or per-session attendance
  // cell now sets `editTarget`, which mounts the dialog. State lives at
  // the top level so a single dialog instance is reused across rows.
  const [editTarget, setEditTarget] = useState<{
    url: string;
    title: string;
  } | null>(null);
  const openEditFrame = useCallback((url: string, title: string) => {
    setEditTarget({ url, title });
  }, []);

  if (!result.ok) {
    return (
      <Card className="glass flex flex-col items-center gap-3 border-destructive/40 p-8 text-center">
        <span className="grid h-10 w-10 place-items-center rounded-md border border-destructive/40 bg-background/40 text-destructive">
          <AlertTriangle className="h-4 w-4" aria-hidden />
        </span>
        <p className="font-display text-foreground text-sm">スケジュール取得失敗</p>
        <p className="text-xs text-muted-foreground">
          {result.reason === "no-url"
            ? "NEXT_PUBLIC_SCHEDULE_URL が設定されていません。"
            : result.reason === "fetch-failed"
              ? "スケジュールサイトに接続できませんでした。"
              : "ページ構造の解析に失敗しました。"}
        </p>
      </Card>
    );
  }

  const { users, sessions, comments } = result.data;
  const commentsByAuthor = groupCommentsByAuthor(comments);

  const { upcoming, past } = splitSessions(sessions, limit);
  // Past sessions newest-first (already sorted by splitSessions). The
  // most-recent past sits at the top of the detail table — reads as
  // "what happened most recently" first.
  const renderedPast = showDetailedPast ? past : [];

  if (upcoming.length === 0 && renderedPast.length === 0) {
    return (
      <Card className="glass flex flex-col items-center gap-3 p-8 text-center">
        <span className="grid h-10 w-10 place-items-center rounded-md border border-border/60 bg-background/40 text-muted-foreground">
          <CalendarX2 className="h-4 w-4" aria-hidden />
        </span>
        <p className="font-display text-foreground text-sm">予定なし</p>
        <p className="text-xs text-muted-foreground">
          表示できる予定が見つかりませんでした。
        </p>
      </Card>
    );
  }

  // Header row factory. The past table omits the "確定" column since
  // every past session was de facto held — the column only carries
  // signal for upcoming dates that may still slip. 確定 column has
  // 0 horizontal padding so the 16px badge sits flush against the
  // adjacent columns. Users get a min-width so name length doesn't
  // shift the table layout between rows / between the upcoming and
  // past tables.
  const tableHead = (showDecided: boolean) => (
    <thead>
      <tr className="border-b border-border/60 font-mono text-[10px] tracking-[0.22em] text-muted-foreground uppercase">
        <th scope="col" className="pl-3 pr-1 py-2.5">
          日程
        </th>
        {showDecided && (
          <th scope="col" className="px-1 py-2.5 text-center">
            確定
          </th>
        )}
        {users.map((u) => (
          <UserHeaderCell
            key={u.userId}
            user={u}
            comments={commentsByAuthor.get(u.name) ?? []}
            editUrl={buildEditUrl(scheduleUrl, u.userId)}
            onOpenEditFrame={openEditFrame}
          />
        ))}
      </tr>
    </thead>
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Upcoming sessions — primary card. Layout untouched. */}
      <Card className="glass overflow-hidden p-0">
        <Legend hasUltimateClear={hasUltimateClear} />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-left text-sm">
            {tableHead(true)}
            <tbody>
              {upcoming.map((s) => (
                <SessionRow
                  key={s.rawDate}
                  session={s}
                  users={users}
                  holidays={holidays}
                  videoLink={lookupVideoLink(s, sessionVideoLinks)}
                  sessionLogsUrl={sessionLogsByDate?.[s.rawDate] ?? null}
                  scheduleUrl={scheduleUrl}
                  onOpenEditFrame={openEditFrame}
                />
              ))}
              {upcoming.length === 0 && (
                <tr>
                  <td
                    colSpan={2 + users.length}
                    className="px-3 py-6 text-center text-xs text-muted-foreground"
                  >
                    今後の予定はありません
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* インライン編集ダイアログ — ユーザー名 / 出欠セルをタップすると
          ここがマウントされ、character-sheets の編集 URL を iframe で
          表示します。閉じるとスクロール位置などポータル側の状態は維持。 */}
      <ScheduleEditFrameDialog
        url={editTarget?.url ?? null}
        title={editTarget?.title ?? ""}
        onClose={() => setEditTarget(null)}
      />

      {/* Past sessions — separate card so the visual break is unmistakable.
          Hidden until the user enables the detail toggle. The "確定"
          column is dropped here since past sessions were all held.
          Manual snapshot trigger lives in the settings dialog now. */}
      {showDetailedPast && renderedPast.length > 0 && (
        <Card className="glass overflow-hidden p-0">
          <header className="flex items-center justify-between gap-2 border-b border-border/40 bg-secondary/20 px-3 py-2">
            <div className="flex items-center gap-2 font-mono text-[10px] tracking-[0.22em] text-muted-foreground uppercase">
              <span className="inline-flex h-1.5 w-1.5 rounded-full bg-muted-foreground/60" />
              Past
              <span className="font-sans text-[11px] tracking-normal normal-case text-muted-foreground/85">
                · 過去の予定
              </span>
            </div>
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
              {renderedPast.length} 件
            </span>
          </header>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-left text-sm">
              {tableHead(false)}
              <tbody>
                {renderedPast.map((s) => (
                  <SessionRow
                    key={s.rawDate}
                    session={s}
                    users={users}
                    isPast
                    holidays={holidays}
                    showDecided={false}
                    videoLink={lookupVideoLink(s, sessionVideoLinks)}
                    sessionLogsUrl={sessionLogsByDate?.[s.rawDate] ?? null}
                    scheduleUrl={scheduleUrl}
                    onOpenEditFrame={openEditFrame}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function UserHeaderCell({
  user,
  comments,
  editUrl,
  onOpenEditFrame,
}: {
  user: ScheduleUser;
  comments: ScheduleComment[];
  editUrl: string | null;
  /** Open the in-portal iframe dialog for the given URL. */
  onOpenEditFrame: (url: string, title: string) => void;
}) {
  const hasComments = comments.length > 0;

  // Username is a clickable button that opens the in-portal iframe
  // dialog (1.9.13). Comments live in a separate small button →
  // Popover. This works on both touch (tap) and mouse (click).
  //
  // Cap the inline width at 7rem and let CSS truncate with ellipsis when a
  // name is unusually long — prevents one outlier name from blowing out
  // the whole table's layout. The full name is still in the title
  // attribute (tooltip).
  const nameClass =
    "inline-block max-w-[7rem] truncate align-bottom underline decoration-dotted decoration-[var(--neon-cyan)]/60 underline-offset-4 transition-colors hover:decoration-[var(--neon-cyan)] hover:text-[var(--neon-cyan)]";

  const nameNode = editUrl ? (
    <button
      type="button"
      onClick={() => onOpenEditFrame(editUrl, `${user.name} の出欠を編集`)}
      className={nameClass}
      title={`${user.name} の出欠をその場で編集`}
    >
      {user.name}
    </button>
  ) : (
    <span className={nameClass} title={user.name}>
      {user.name}
    </span>
  );

  return (
    <th
      scope="col"
      // min-w stabilizes the layout; max-w on the name (above) caps long
      // names so they ellipsize instead of pushing other columns offscreen.
      className="min-w-[5rem] px-2 py-2 text-center font-mono whitespace-nowrap"
    >
      <span className="inline-flex items-center gap-1">
        {nameNode}
        {hasComments && <CommentPopover user={user} comments={comments} />}
      </span>
    </th>
  );
}

/**
 * Derive the per-user edit URL from the schedule list URL.
 *   /schedule/list?key=KEY  →  /schedule/input?key=KEY&userId=USERID
 *
 * Returns null if the source URL is missing or malformed.
 *
 * History: 1.9.14 attached `?date=` query + `#date-` hash hints in an
 * attempt to auto-scroll the iframe to the target date, but
 * character-sheets doesn't honor either, so the hints were noise.
 * 1.9.15 removed them; the dialog gained a CSS-based initial scroll
 * offset (translateY) instead.
 */
function buildEditUrl(
  sourceUrl: string | null | undefined,
  userId: string,
): string | null {
  if (!sourceUrl) return null;
  try {
    const u = new URL(sourceUrl);
    u.pathname = u.pathname.replace(/\/list(\b|$)/, "/input");
    u.searchParams.set("userId", userId);
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * Date cell label — plain colored span, no link. Video / Logs links
 * are rendered separately AFTER the time inside the row so both
 * icons sit at the end of the cell where the eye expects "actions".
 */
function DateLabel({
  text,
  holiday,
  decided,
  holidayName,
}: {
  text: string;
  holiday: boolean;
  decided: boolean;
  holidayName: string | null;
}) {
  const colorClass = holiday
    ? "font-bold text-rose-400 drop-shadow-[0_0_4px_color-mix(in_oklch,oklch(0.65_0.22_25)_40%,transparent)]"
    : decided
      ? "font-bold text-[var(--neon-cyan)] drop-shadow-[0_0_4px_color-mix(in_oklch,var(--neon-cyan)_40%,transparent)]"
      : "";
  return (
    <span className={colorClass} title={holidayName ?? undefined}>
      {text}
    </span>
  );
}

/**
 * Look up a session's matching video. Map is rawDate-keyed (built
 * server-side using the 36h window heuristic) so the lookup is just
 * a key access here — no timezone math needed.
 */
function lookupVideoLink(
  session: ScheduleSession,
  links: Record<string, SessionVideoLink> | undefined,
): SessionVideoLink | null {
  if (!links) return null;
  return links[session.rawDate] ?? null;
}

function SessionRow({
  session,
  users,
  isPast = false,
  holidays,
  showDecided = true,
  videoLink = null,
  sessionLogsUrl = null,
  scheduleUrl,
  onOpenEditFrame,
}: {
  session: ScheduleSession;
  users: ScheduleUser[];
  isPast?: boolean;
  holidays?: JapaneseHolidaysMap;
  /** When false, drop the 確定 column entirely (past table). */
  showDecided?: boolean;
  /** When non-null, the date label becomes a Link to that video. */
  videoLink?: SessionVideoLink | null;
  /**
   * FFLogs URL stored on the past-session row. Used as the Logs icon
   * source when no matching video exists for this date (a session
   * happened, was logged on FFLogs, but nobody uploaded a video).
   */
  sessionLogsUrl?: string | null;
  /**
   * Source schedule URL — used to derive each user's character-sheets
   * input page so attendance cells can become "click here to edit"
   * targets.
   */
  scheduleUrl?: string | null;
  /** Open the in-portal iframe dialog for the given URL. */
  onOpenEditFrame: (url: string, title: string) => void;
}) {
  const decided = session.status === "DECISION";
  const { memos, refetch: refetchMemos } = useRealtimeScheduleMemos(
    session.rawDate,
    EMPTY_MEMOS,
  );
  // Ref so the (separately-rendered) memo dot can open the popover.
  const popoverRef = useRef<SessionMemoPopoverHandle>(null);
  // Japanese national holidays get a red date label — overrides the
  // default and DECISION-cyan styling. Doesn't change the row background
  // so the past/decided treatment still composes underneath.
  const holiday = isJapaneseHoliday(session.date, holidays);
  const holidayName = holiday
    ? getJapaneseHolidayName(session.date, holidays)
    : null;
  return (
    <tr
      className={
        "border-b border-border/30 transition-colors last:border-b-0 " +
        (isPast
          ? "" // past rows render at full opacity with no hover effect — once the past view is open, dimming-then-revealing on hover is just visual noise
          : decided
            ? "bg-[var(--neon-cyan)]/4 hover:bg-[var(--neon-cyan)]/8"
            : "hover:bg-secondary/40")
      }
    >
      <th
        scope="row"
        className="pl-3 pr-1 py-2 align-middle font-mono text-[12px] tabular-nums whitespace-nowrap text-foreground"
      >
        <div className="flex items-center gap-2">
          {/* Date label color priority:
                1. Holiday → red glow
                2. DECISION → cyan glow + bold
                3. default → foreground
              Wrapped in a memo popover so any user can leave shared
              notes for this session by clicking the date. */}
          <SessionMemoPopover
            ref={popoverRef}
            rawDate={session.rawDate}
            displayDate={session.rawDate.split(" ")[0] ?? session.rawDate}
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
            <DateLabel
              text={session.rawDate.split(" ")[0]!}
              holiday={holiday}
              decided={decided}
              holidayName={holidayName}
            />
          </SessionMemoPopover>
          <span className="font-mono text-[11px] tabular-nums text-muted-foreground/85">
            {session.startTime}
            <span className="mx-0.5 opacity-60">~</span>
            {session.endTime}
          </span>
          {/* Memo indicator placed right after the time per user
              request — visible whether or not video/Logs links are
              also rendered for this row. */}
          <SessionMemoDot
            count={memos.length}
            onClick={() => popoverRef.current?.open()}
          />
          {/* Action icons — placed after the time so the cell reads
              "what is this date" → "actions for this date" left-to-right.
              Film: deep-link into the matched video card.
              BarChart3: FFLogs URL associated with that video. */}
          {videoLink && (
            <Link
              href={videoLink.href}
              prefetch={false}
              aria-label={`${videoLink.categoryName}/動画「${videoLink.videoTitle}」を開く`}
              title={`${videoLink.categoryName}/動画 → 「${videoLink.videoTitle}」`}
              className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--neon-cyan)]/85 transition-all hover:bg-[var(--neon-cyan)]/15 hover:text-[var(--neon-cyan)] hover:shadow-[0_0_10px_-2px_var(--neon-cyan)]"
            >
              <Film className="h-3 w-3" aria-hidden />
            </Link>
          )}
          {(() => {
            // Logs URL priority: video's logs_url first (richer
            // context — it ties to the recorded run), then the
            // session's own logs_url (covers sessions without video).
            // Wrap in safeHref so a malformed/dangerous-scheme URL
            // can't reach the DOM (defense in depth alongside the
            // form/server validators).
            const logsUrl = safeHref(videoLink?.logsUrl ?? sessionLogsUrl);
            if (!logsUrl) return null;
            return (
              <a
                href={logsUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`${session.rawDate.split(" ")[0]} の FFLogs を開く`}
                title="FFLogs"
                className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-amber-300/85 transition-all hover:bg-amber-400/15 hover:text-amber-200 hover:shadow-[0_0_10px_-2px_rgba(251,191,36,0.6)]"
              >
                <BarChart3 className="h-3 w-3" aria-hidden />
              </a>
            );
          })()}
        </div>
      </th>
      {showDecided && (
        <td className="px-1 py-2 text-center align-middle">
          {decided ? (
            // 確定 = 日程が確定した = 一目で識別できる emerald バッジ。
            // ヘッダーの「確定」テキストと文字位置を揃えるため、
            // チェックマーク等のアイコンは付けず「確定」テキストだけを
            // 中央配置する。色 + 枠 + glow で十分視覚化できる。
            <span
              aria-label="日程確定"
              title="日程確定"
              className="inline-flex h-6 items-center justify-center rounded-md border border-emerald-400/60 bg-emerald-400/15 px-2 font-mono text-[10px] font-bold tracking-[0.16em] text-emerald-300 uppercase shadow-[0_0_12px_-3px_rgb(52_211_153)]"
            >
              確定
            </span>
          ) : (
            <span
              aria-hidden
              title="未確定"
              className="inline-flex h-6 items-center justify-center text-muted-foreground/40"
            >
              ·
            </span>
          )}
        </td>
      )}
      {users.map((u) => {
        const att = session.attendances[u.userId] ?? "－";
        const editUrl = buildEditUrl(scheduleUrl, u.userId);
        const dateLabel = session.rawDate.split(" ")[0] ?? session.rawDate;
        const symbol = (
          <span
            // Drop `font-mono` for the symbols — ◯ ⏰ △ × － are CJK
            // full-width / emoji glyphs that fall back to system fonts
            // when JetBrains Mono lacks them. The fallback's vertical
            // metrics differ slightly per glyph (especially ⏰ which
            // sits taller in the line-box), causing perceived
            // misalignment. Using the default sans + `leading-none`
            // forces every cell to render the glyph at the same
            // baseline within a fixed h-5 box.
            className={
              "inline-flex h-5 min-w-[1.75rem] items-center justify-center rounded-sm border px-1 text-[12px] leading-none transition-transform " +
              ATT_TONE[att]
            }
            aria-label={`${u.name}: ${att}`}
          >
            {att}
          </span>
        );
        return (
          <td key={u.userId} className="px-2 py-2 align-middle text-center">
            {editUrl ? (
              // ボタン化 (1.9.13): その場でインライン iframe ダイアログを
              // 開いて出欠を編集。タブ移動なしで戻れる。hover の scale +
              // focus ring で「タップ可能」のフィードバックを残す。
              <button
                type="button"
                onClick={() =>
                  onOpenEditFrame(
                    editUrl,
                    `${u.name} の出欠を編集 (${dateLabel} を含む)`,
                  )
                }
                title={`${u.name} の出欠をその場で編集 (${dateLabel} を含む全日程)`}
                className="group/cell inline-flex rounded-sm transition-transform hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--neon-cyan)]/60"
              >
                {symbol}
              </button>
            ) : (
              symbol
            )}
          </td>
        );
      })}
    </tr>
  );
}

function Legend({ hasUltimateClear = false }: { hasUltimateClear?: boolean }) {
  // 1.9.16: ラベル "MEMBERS" デフォルト、絶クリア達成済みの固定なら
  // "LEGENDS" 表記に昇格 (称号として)。
  const label = hasUltimateClear ? "Legends" : "Members";
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border/40 bg-secondary/15 px-3 py-2 text-[11px]">
      <span
        className={
          "font-mono text-[10px] tracking-[0.22em] uppercase " +
          (hasUltimateClear
            ? "text-amber-300"
            : "text-muted-foreground")
        }
        title={
          hasUltimateClear
            ? "絶コンテンツをクリアした「Legends」称号で表示中"
            : "通常のメンバー表示 (絶クリアでLegends称号に切替)"
        }
      >
        {label}
      </span>
      {ATT_LEGEND.map((l) => (
        <span key={l.symbol} className="inline-flex items-center gap-1.5">
          <span
            className={
              "inline-flex h-4 w-5 items-center justify-center rounded-sm border text-[11px] leading-none " +
              ATT_TONE[l.symbol]
            }
          >
            {l.symbol}
          </span>
          <span className="text-[11px] text-muted-foreground">{l.label}</span>
        </span>
      ))}
    </div>
  );
}

function groupCommentsByAuthor(
  comments: ScheduleComment[],
): Map<string, ScheduleComment[]> {
  const out = new Map<string, ScheduleComment[]>();
  for (const c of comments) {
    const key = c.author.trim();
    if (!key) continue;
    const list = out.get(key);
    if (list) list.push(c);
    else out.set(key, [c]);
  }
  return out;
}

/**
 * Split sessions into upcoming (future + ≤6h-past) and past (everything older),
 * each pre-sorted. Limit is applied to upcoming only — past list is always
 * sorted newest-first so the most relevant past dates appear right after the
 * "Past" divider.
 */
function splitSessions(
  sessions: ScheduleSession[],
  limit?: number,
): { upcoming: ScheduleSession[]; past: ScheduleSession[] } {
  const cutoff = Date.now() - 6 * 60 * 60 * 1000;
  const upcoming: ScheduleSession[] = [];
  const past: ScheduleSession[] = [];
  for (const s of sessions) {
    if (s.date.getTime() >= cutoff) upcoming.push(s);
    else past.push(s);
  }
  upcoming.sort((a, b) => a.date.getTime() - b.date.getTime());
  past.sort((a, b) => b.date.getTime() - a.date.getTime());
  return {
    upcoming: typeof limit === "number" ? upcoming.slice(0, limit) : upcoming,
    past,
  };
}
