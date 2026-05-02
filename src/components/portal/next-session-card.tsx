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

  // TODO #39 (2.1, 2026-04-29): 開催時間中は「挑戦中」表記 + 色を amber に
  // 切替えて進行中であることを視覚化する。`date` が start 時刻なので、
  // endTime ("HH:MM" or "0:00" 等の翌日跨ぎ) を加味して end の絶対時刻を
  // 計算し、現在時刻が [start, end) に入っていれば inSession=true。
  // 注: server-render なので 1 ページロード分のスナップショット。session 中
  // にロード済みのページは label が更新されないが、refresh / リアルタイム
  // 更新ボタンで再取得できるので許容。
  const inSession = (() => {
    if (!isToday) return false;
    const [endH, endM] = endTime.split(":").map((s) => parseInt(s, 10));
    if (!Number.isFinite(endH) || !Number.isFinite(endM)) return false;
    const startMs = date.getTime();
    // start の HH:MM (= startTime) と end の HH:MM を比較し、end のほうが
    // 小さい / 等しい (= 翌日跨ぎ、例: 22:00~0:00) なら end は +24h、
    // それ以外なら同日 end。startTime をパースして比較。
    const [startH, startM] = startTime.split(":").map((s) => parseInt(s, 10));
    if (!Number.isFinite(startH) || !Number.isFinite(startM)) return false;
    const endIsNextDay =
      endH! < startH! || (endH! === startH! && endM! <= startM!);
    const endMs =
      startMs +
      ((endH! - startH!) * 60 + (endM! - startM!)) * 60 * 1000 +
      (endIsNextDay ? 24 * 60 * 60 * 1000 : 0);
    const now = Date.now();
    return now >= startMs && now < endMs;
  })();

  const relative = inSession
    ? "挑戦中"
    : isToday
      ? "本日"
      : dayDiff === 1
        ? "明日"
        : dayDiff > 0
          ? `あと ${dayDiff} 日`
          : null;

  return (
    <Frame
      tone={inSession ? "inSession" : isToday ? "today" : "active"}
      icon={<CalendarCheck2 className="h-4 w-4" aria-hidden />}
      rightSlot={recruitmentTopButton}
    >
      {/* Header line: label + 確定 badge inline. */}
      <div className="flex flex-wrap items-center gap-2">
        <Label>次回開催日</Label>
        <span className="rounded-sm border border-[var(--neon-cyan)]/40 bg-[var(--neon-cyan)]/8 px-1.5 py-px font-mono text-[10px] tracking-[0.22em] text-[var(--neon-cyan)] uppercase">
          確定
        </span>
      </div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Value highlight={isToday} inSession={inSession}>
          {rawDate}
        </Value>
        {(startTime || endTime) && (
          <span className="font-mono text-sm tabular-nums text-foreground/80">
            {startTime}
            <span className="mx-1 opacity-60">~</span>
            {endTime}
          </span>
        )}
        {relative && (
          <span
            className={
              "font-mono text-[11px] tracking-[0.22em] uppercase " +
              (inSession
                ? // 開催時間中: amber で発光 + animate-pulse、本日とは違う緊張感のある色味で「今、戦闘中」を強調。
                  "rounded-sm border border-amber-400/70 bg-amber-400/15 px-1.5 py-px font-bold text-amber-300 shadow-[0_0_14px_-2px_rgba(251,191,36,0.65)] animate-pulse"
                : isToday
                  ? "rounded-sm border border-[var(--neon-cyan)]/60 bg-[var(--neon-cyan)]/15 px-1.5 py-px font-bold text-[var(--neon-cyan)] shadow-[0_0_12px_-2px_var(--neon-cyan)] animate-pulse"
                  : "text-[var(--neon-cyan)]")
            }
          >
            {relative}
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
  rightSlot = null,
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
  tone?: "default" | "active" | "today" | "warn" | "inSession";
  /**
   * 1.9.27: optional right-edge content (e.g. recruitment button).
   * Hoisted out of the content block so it sits at the same flex level
   * as the icon — both `items-center` so they share the same vertical
   * alignment with equal top / bottom whitespace.
   */
  rightSlot?: React.ReactNode;
}) {
  const toneClass =
    tone === "inSession"
      ? // 開催時間中: amber 寄りで「進行中」感を出す。tone === "today" の cyan
        // との差別化を強調するため inset shadow も amber 系に。
        "border-amber-400/80 bg-amber-400/[0.06] shadow-[0_0_46px_-6px_rgba(251,191,36,0.7),inset_0_0_24px_-10px_rgba(251,191,36,0.7)]"
      : tone === "today"
        ? "border-[var(--neon-cyan)]/80 bg-[var(--neon-cyan)]/[0.05] shadow-[0_0_42px_-6px_var(--neon-cyan),inset_0_0_24px_-10px_var(--neon-cyan)]"
        : tone === "active"
          ? "border-[var(--neon-cyan)]/55 shadow-[0_0_32px_-8px_var(--neon-cyan)]"
          : tone === "warn"
            ? "border-destructive/40"
            : "border-border/50";

  return (
    <div
      className={`glass relative flex items-center gap-3 rounded-lg border p-3 sm:p-4 ${toneClass}`}
    >
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-[var(--neon-cyan)]/40 bg-background/40 text-[var(--neon-cyan)] shadow-[inset_0_0_12px_-4px_var(--neon-cyan)]">
        {icon}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">{children}</div>
      {rightSlot && (
        <div className="ml-auto flex shrink-0 items-center">{rightSlot}</div>
      )}
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
  inSession = false,
}: {
  children: React.ReactNode;
  highlight?: boolean;
  /** 開催時間中なら amber で表示 (TODO #39)。 */
  inSession?: boolean;
}) {
  return (
    <span
      className={
        "font-display tabular-nums leading-tight " +
        (inSession
          ? "text-xl font-bold text-amber-300 drop-shadow-[0_0_10px_rgba(251,191,36,0.55)]"
          : highlight
            ? "text-xl font-bold text-[var(--neon-cyan)] drop-shadow-[0_0_8px_color-mix(in_oklch,var(--neon-cyan)_50%,transparent)]"
            : "text-lg text-foreground")
      }
    >
      {children}
    </span>
  );
}

function Sub({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-xs leading-relaxed text-muted-foreground">
      {children}
    </span>
  );
}
