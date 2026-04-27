import { CalendarCheck2, AlertTriangle } from "lucide-react";
import type { NextSessionResult } from "@/lib/schedule/next-session";

export function NextSessionCard({
  result,
  recruitmentTopButton = null,
}: {
  result: NextSessionResult;
  /**
   * Optional inline button(s) rendered between the date/time text and
   * the right-aligned 確定 badge. The schedule page passes a
   * top-template recruitment-copy button here so the action is one
   * click away from the most-relevant card.
   */
  recruitmentTopButton?: React.ReactNode;
}) {
  if (!result.ok) {
    return (
      <Frame tone="warn" icon={<AlertTriangle className="h-4 w-4" aria-hidden />}>
        <Label>次回開催日</Label>
        <Value>取得失敗</Value>
        <Sub>
          {result.reason === "no-url"
            ? "NEXT_PUBLIC_SCHEDULE_URL が未設定です"
            : result.reason === "fetch-failed"
              ? "スケジュールサイトに接続できませんでした"
              : "ページ構造の解析に失敗しました"}
        </Sub>
      </Frame>
    );
  }

  if (!result.session) {
    return (
      <Frame icon={<CalendarCheck2 className="h-4 w-4" aria-hidden />}>
        <Label>次回開催日</Label>
        <Value>未確定</Value>
        <Sub>「日程確定」マークが付いた予定が見つかりませんでした</Sub>
      </Frame>
    );
  }

  const { rawDate, startTime, endTime, date } = result.session;
  // Compare day numbers in JST (UTC+9) so the "today / 明日 / あと N 日" label
  // is correct regardless of where the server runs (Vercel = UTC).
  const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
  const jstDayNumber = (utcMs: number) =>
    Math.floor((utcMs + JST_OFFSET_MS) / 86400000);
  const dayDiff = jstDayNumber(date.getTime()) - jstDayNumber(Date.now());
  const isToday = dayDiff === 0;
  const relative = isToday
    ? "本日"
    : dayDiff === 1
      ? "明日"
      : dayDiff > 0
        ? `あと ${dayDiff} 日`
        : null;

  return (
    <Frame
      tone={isToday ? "today" : "active"}
      icon={<CalendarCheck2 className="h-4 w-4" aria-hidden />}
    >
      {/* Header line: label + 確定 badge inline. The badge previously
          floated to the far right where the eye easily missed it;
          sitting next to the label makes "this date is locked-in"
          immediately obvious. */}
      <div className="flex flex-wrap items-center gap-2">
        <Label>次回開催日</Label>
        <span className="rounded-sm border border-[var(--neon-cyan)]/40 bg-[var(--neon-cyan)]/8 px-1.5 py-px font-mono text-[10px] tracking-[0.18em] text-[var(--neon-cyan)] uppercase">
          確定
        </span>
      </div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Value highlight={isToday}>{rawDate}</Value>
        <span className="font-mono text-sm text-foreground/80">
          {startTime} ~ {endTime}
        </span>
        {relative && (
          <span
            className={
              "font-mono text-[11px] tracking-widest uppercase " +
              (isToday
                ? "rounded-sm border border-[var(--neon-cyan)]/60 bg-[var(--neon-cyan)]/15 px-1.5 py-px font-bold text-[var(--neon-cyan)] shadow-[0_0_12px_-2px_var(--neon-cyan)] animate-pulse"
                : "text-[var(--neon-cyan)]")
            }
          >
            {relative}
          </span>
        )}
        {recruitmentTopButton && (
          <span className="ml-auto inline-flex items-center self-center">
            {recruitmentTopButton}
          </span>
        )}
      </div>
    </Frame>
  );
}

function Frame({
  children,
  icon,
  tone = "default",
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
  tone?: "default" | "active" | "today" | "warn";
}) {
  // "today" = active session today: stronger border + glow than the
  // generic "active" upcoming highlight, so when you open the page
  // your eye lands on it immediately. "active" itself is also
  // emphasized — the card is the most-actioned thing on the page.
  const toneClass =
    tone === "today"
      ? "border-[var(--neon-cyan)]/80 bg-[var(--neon-cyan)]/[0.05] shadow-[0_0_42px_-6px_var(--neon-cyan),inset_0_0_24px_-10px_var(--neon-cyan)]"
      : tone === "active"
        ? "border-[var(--neon-cyan)]/55 shadow-[0_0_32px_-8px_var(--neon-cyan)]"
        : tone === "warn"
          ? "border-destructive/40"
          : "border-border/50";

  return (
    <div
      className={`glass relative flex items-start gap-3 rounded-lg border p-3 sm:p-4 ${toneClass}`}
    >
      <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md border border-[var(--neon-cyan)]/40 bg-background/40 text-[var(--neon-cyan)]">
        {icon}
      </span>
      <div className="flex flex-1 flex-col gap-0.5">{children}</div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-[10px] tracking-[0.22em] text-muted-foreground uppercase">
      {children}
    </span>
  );
}

function Value({
  children,
  highlight = false,
}: {
  children: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <span
      className={
        "font-display leading-tight " +
        (highlight
          ? "text-xl font-bold text-[var(--neon-cyan)] drop-shadow-[0_0_8px_color-mix(in_oklch,var(--neon-cyan)_50%,transparent)]"
          : "text-lg text-foreground")
      }
    >
      {children}
    </span>
  );
}

function Sub({ children }: { children: React.ReactNode }) {
  return <span className="text-xs text-muted-foreground">{children}</span>;
}
