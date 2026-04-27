import { CalendarX2, AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { CommentPopover } from "./comment-popover";
import {
  getJapaneseHolidayName,
  isJapaneseHoliday,
} from "@/lib/japanese-holidays";
import type { JapaneseHolidaysMap } from "@/lib/japanese-holidays";
import type {
  Attendance,
  ScheduleComment,
  ScheduleFetchResult,
  ScheduleSession,
  ScheduleUser,
} from "@/lib/schedule/next-session";

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
};

export function ScheduleList({
  result,
  limit,
  showDetailedPast = false,
  scheduleUrl,
  holidays,
}: Props) {
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
  // signal for upcoming dates that may still slip.
  const tableHead = (showDecided: boolean) => (
    <thead>
      <tr className="border-b border-border/60 text-[10px] tracking-[0.18em] text-muted-foreground uppercase">
        <th scope="col" className="px-3 py-2 font-mono">
          日程
        </th>
        {showDecided && (
          <th scope="col" className="px-2 py-2 font-mono">
            確定
          </th>
        )}
        {users.map((u) => (
          <UserHeaderCell
            key={u.userId}
            user={u}
            comments={commentsByAuthor.get(u.name) ?? []}
            editUrl={buildEditUrl(scheduleUrl, u.userId)}
          />
        ))}
      </tr>
    </thead>
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Upcoming sessions — primary card. Layout untouched. */}
      <Card className="glass overflow-hidden p-0">
        <Legend />
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

      {/* Past sessions — separate card so the visual break is unmistakable.
          Hidden until the user enables the detail toggle. The "確定"
          column is dropped here since past sessions were all held. */}
      {showDetailedPast && renderedPast.length > 0 && (
        <Card className="glass overflow-hidden p-0">
          <header className="flex items-center justify-between gap-2 border-b border-border/40 bg-secondary/20 px-3 py-2">
            <div className="flex items-center gap-2 font-mono text-[10px] tracking-[0.22em] text-muted-foreground uppercase">
              <span className="inline-flex h-1.5 w-1.5 rounded-full bg-muted-foreground/60" />
              Past · 過去の予定
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
}: {
  user: ScheduleUser;
  comments: ScheduleComment[];
  editUrl: string | null;
}) {
  const hasComments = comments.length > 0;

  // Username is always a clickable link to the per-user edit URL (or a plain
  // span if no edit URL is available). Comments live in a separate small
  // button → Popover. This works on both touch (tap) and mouse (click), and
  // keeps the link semantics clean.
  const nameClass =
    "inline-block underline decoration-dotted decoration-[var(--neon-cyan)]/60 underline-offset-4 transition-colors hover:decoration-[var(--neon-cyan)] hover:text-[var(--neon-cyan)]";

  const nameNode = editUrl ? (
    <a
      href={editUrl}
      target="_blank"
      rel="noopener noreferrer"
      className={nameClass}
      title={`${user.name} の出欠を編集`}
    >
      {user.name}
    </a>
  ) : (
    <span className={nameClass}>{user.name}</span>
  );

  return (
    <th scope="col" className="px-2 py-2 text-center font-mono whitespace-nowrap">
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
 * Returns null if the source URL is missing or malformed.
 */
function buildEditUrl(sourceUrl: string | null | undefined, userId: string): string | null {
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

function SessionRow({
  session,
  users,
  isPast = false,
  holidays,
  showDecided = true,
}: {
  session: ScheduleSession;
  users: ScheduleUser[];
  isPast?: boolean;
  holidays?: JapaneseHolidaysMap;
  /** When false, drop the 確定 column entirely (past table). */
  showDecided?: boolean;
}) {
  const decided = session.status === "DECISION";
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
          ? "opacity-60 hover:opacity-100 hover:bg-secondary/40 "
          : decided
            ? "bg-[var(--neon-cyan)]/4 hover:bg-[var(--neon-cyan)]/8"
            : "hover:bg-secondary/40")
      }
    >
      <th
        scope="row"
        className="px-3 py-2 align-middle font-mono text-[12px] whitespace-nowrap text-foreground"
      >
        <div className="flex items-baseline gap-2">
          {/* Date label color priority:
                1. Holiday → red glow
                2. DECISION → cyan glow + bold
                3. default → foreground */}
          <span
            className={
              holiday
                ? "font-bold text-rose-400 drop-shadow-[0_0_4px_color-mix(in_oklch,oklch(0.65_0.22_25)_40%,transparent)]"
                : decided
                  ? "font-bold text-[var(--neon-cyan)] drop-shadow-[0_0_4px_color-mix(in_oklch,var(--neon-cyan)_40%,transparent)]"
                  : ""
            }
            // Tooltip shows the holiday name on hover (PC). Mobile
            // browsers mostly ignore `title`, which matches the user's
            // "PC only" preference for this hint.
            title={holidayName ?? undefined}
          >
            {session.rawDate.split(" ")[0]}
          </span>
          <span className="text-muted-foreground text-[11px]">
            {session.startTime} ~ {session.endTime}
          </span>
        </div>
      </th>
      {showDecided && (
        <td className="px-2 py-2 text-center align-middle">
          {decided ? (
            <span
              aria-label="日程確定"
              className="inline-flex h-5 min-w-[1.75rem] items-center justify-center rounded-sm border border-[var(--neon-cyan)]/40 bg-[var(--neon-cyan)]/12 px-1.5 font-mono text-[10px] tracking-widest text-[var(--neon-cyan)] uppercase shadow-[0_0_10px_-4px_var(--neon-cyan)]"
            >
              ✓
            </span>
          ) : (
            <span aria-hidden className="text-muted-foreground/60 font-mono text-xs">
              ·
            </span>
          )}
        </td>
      )}
      {users.map((u) => {
        const att = session.attendances[u.userId] ?? "－";
        return (
          <td key={u.userId} className="px-2 py-2 align-middle text-center">
            <span
              className={
                "inline-flex h-5 min-w-[1.75rem] items-center justify-center rounded-sm border px-1 font-mono text-[12px] " +
                ATT_TONE[att]
              }
              aria-label={`${u.name}: ${att}`}
            >
              {att}
            </span>
          </td>
        );
      })}
    </tr>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-3 py-2 text-[11px]">
      <span className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase">
        Legend
      </span>
      {ATT_LEGEND.map((l) => (
        <span key={l.symbol} className="inline-flex items-center gap-1">
          <span
            className={
              "inline-flex h-4 w-5 items-center justify-center rounded-sm border font-mono text-[11px] " +
              ATT_TONE[l.symbol]
            }
          >
            {l.symbol}
          </span>
          <span className="text-muted-foreground">{l.label}</span>
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
