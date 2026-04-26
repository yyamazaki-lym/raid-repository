import { CalendarX2, AlertTriangle, MessageSquareText } from "lucide-react";
import { Card } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
  /** When true, render past sessions (in muted style) below the upcoming ones. */
  showPast?: boolean;
};

export function ScheduleList({ result, limit, showPast = false }: Props) {
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
  const renderedPast = showPast ? past : [];

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

  return (
    <Card className="glass overflow-hidden p-0">
      <Legend />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-border/60 text-[10px] tracking-[0.18em] text-muted-foreground uppercase">
              <th scope="col" className="px-3 py-2 font-mono">
                日程
              </th>
              <th scope="col" className="px-2 py-2 font-mono">
                確定
              </th>
              {users.map((u) => (
                <UserHeaderCell
                  key={u.userId}
                  user={u}
                  comments={commentsByAuthor.get(u.name) ?? []}
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {upcoming.map((s) => (
              <SessionRow key={s.rawDate} session={s} users={users} />
            ))}
            {showPast && renderedPast.length > 0 && (
              <>
                <tr>
                  <td
                    colSpan={2 + users.length}
                    className="border-t border-border/40 bg-secondary/20 px-3 py-1.5 font-mono text-[10px] tracking-[0.22em] text-muted-foreground uppercase"
                  >
                    Past — 過去の予定 ({renderedPast.length}件)
                  </td>
                </tr>
                {renderedPast.map((s) => (
                  <SessionRow
                    key={s.rawDate}
                    session={s}
                    users={users}
                    isPast
                  />
                ))}
              </>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function UserHeaderCell({
  user,
  comments,
}: {
  user: ScheduleUser;
  comments: ScheduleComment[];
}) {
  const hasComments = comments.length > 0;

  if (!hasComments) {
    return (
      <th
        scope="col"
        className="px-2 py-2 text-center font-mono whitespace-nowrap"
      >
        {user.name}
      </th>
    );
  }

  return (
    <th scope="col" className="px-2 py-2 text-center font-mono whitespace-nowrap">
      <Tooltip>
        <TooltipTrigger
          // Render as a span so it sits naturally in a <th>; default <button>
          // adds focus styling we don't want here. The dotted underline + tiny
          // bullet hint to the user that a tooltip is available.
          render={
            <span className="group inline-flex cursor-help items-center gap-1 underline decoration-dotted decoration-[var(--neon-cyan)]/60 underline-offset-4 transition-colors hover:decoration-[var(--neon-cyan)]" />
          }
        >
          <span>{user.name}</span>
          <MessageSquareText
            className="h-2.5 w-2.5 text-[var(--neon-cyan)] opacity-70 transition-opacity group-hover:opacity-100"
            aria-hidden
          />
        </TooltipTrigger>
        <TooltipContent
          side="bottom"
          className="max-w-[20rem] bg-popover text-popover-foreground p-0 shadow-xl ring-1 ring-[var(--neon-cyan)]/30"
        >
          <CommentList user={user} comments={comments} />
        </TooltipContent>
      </Tooltip>
    </th>
  );
}

function CommentList({
  user,
  comments,
}: {
  user: ScheduleUser;
  comments: ScheduleComment[];
}) {
  return (
    <div className="flex w-72 max-w-[80vw] flex-col gap-1 p-3 text-left">
      <div className="flex items-center gap-1.5 border-b border-border/50 pb-1.5">
        <MessageSquareText
          className="h-3 w-3 text-[var(--neon-cyan)]"
          aria-hidden
        />
        <span className="font-mono text-[9px] tracking-[0.2em] text-muted-foreground uppercase">
          {user.name} の一言
        </span>
      </div>
      <ul className="flex flex-col gap-1.5 pt-1">
        {comments.map((c, idx) => (
          <li key={idx} className="flex flex-col gap-0.5">
            <p className="text-[11px] leading-relaxed text-foreground/95 whitespace-pre-wrap break-words">
              {c.body || "—"}
            </p>
            {c.timestamp && (
              <span className="font-mono text-[9px] text-muted-foreground">
                {c.timestamp}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SessionRow({
  session,
  users,
  isPast = false,
}: {
  session: ScheduleSession;
  users: ScheduleUser[];
  isPast?: boolean;
}) {
  const decided = session.status === "DECISION";
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
          {/* DECISION rows get a bold + accent date so the confirmed schedule
              jumps out at a glance. The time stays unchanged. */}
          <span
            className={
              decided
                ? "font-bold text-[var(--neon-cyan)] drop-shadow-[0_0_4px_color-mix(in_oklch,var(--neon-cyan)_40%,transparent)]"
                : ""
            }
          >
            {session.rawDate.split(" ")[0]}
          </span>
          <span className="text-muted-foreground text-[11px]">
            {session.startTime} ~ {session.endTime}
          </span>
        </div>
      </th>
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
