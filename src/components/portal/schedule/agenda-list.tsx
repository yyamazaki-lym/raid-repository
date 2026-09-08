"use client";

import { CalendarClock } from "lucide-react";
import type {
  ScheduleAttendanceOptions,
  ScheduleSession,
  ScheduleUser,
} from "@/lib/schedule/parse";
import type { ScheduleSourceMode } from "@/lib/schedule/source-mode";
import type { AttendanceTimes } from "@/lib/schedule/attendance-times";
import {
  describeAttendanceTimes,
  formatAttendanceTimesHint,
} from "@/lib/schedule/attendance-times";
import { ATT_TONE, ATT_TONE_FALLBACK } from "@/lib/schedule/attendance-ui";
import { NativeAttendancePopover } from "@/components/portal/native-schedule/lazy";
import { AttendanceSummaryChip } from "./attendance-summary-chip";
import { OptionalSessionBadge } from "@/components/portal/native-schedule/optional-session-badge";
import { useLocale, useMessages } from "@/lib/i18n/client";

/**
 * スマホ向けのアジェンダ表示 (UI-10、2026-09-08)。
 *
 * ## なぜ表をやめるのか
 *
 * 予定表は「1 列 = 1 人」の表で、8 人だと **375px 幅では横スクロールが
 * 必須**になる (実測: 内容幅 778px / 表示幅 341px)。開催直前にスマホで
 * したいことは「次はいつか」「自分の回答を入れる」の 2 つで、そのために
 * 横スクロールを 2 往復させるのは筋が悪い。
 *
 * ⚠ **表を消すのではなく、md 未満だけ差し替える。** 8 人の記号を一望
 * できるのは表の強みで、PC ではそのままが最善 (ノートの UI-10 も
 * 「デスクトップは現状維持で二系統になる」を前提にしている)。
 *
 * ## 1 枚に載せるもの
 *
 * 日付 + 時刻 / 確定 / 有志 (W-18) / 出欠の内訳チップ (UI-9) /
 * **自分の回答** (native は popover でその場で変更、sync は記号のみ)。
 * ⚠ 8 人ぶんの記号は載せない — 内訳チップが「何人 OK / 未回答何人」を
 * 既に答えていて、個々の記号まで縦に積むと 1 枚が長くなり「次はいつか」が
 * 読めなくなる (詳しくは表を横に見る)。
 */
export function ScheduleAgendaList({
  sessions,
  users,
  mode,
  currentDiscordId,
  attendanceOptions,
  sessionIdByRawDate,
  optionalByRawDate,
}: {
  /** 表示する予定 (upcoming のみ)。 */
  sessions: ScheduleSession[];
  users: ScheduleUser[];
  mode: ScheduleSourceMode;
  currentDiscordId: string | null;
  /** native の出欠選択肢 (無ければ popover を出さない)。 */
  attendanceOptions: ScheduleAttendanceOptions | null;
  sessionIdByRawDate: Record<string, string> | undefined;
  optionalByRawDate: Record<string, boolean> | undefined;
}) {
  const m = useMessages();
  const locale = useLocale();

  if (sessions.length === 0) {
    return (
      <p className="px-3 py-6 text-center text-[12px] text-muted-foreground">
        {m.schedule.noUpcoming}
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-1.5 px-3 py-3">
      {sessions.map((s) => {
        const dateLabel = s.rawDate.split(" ")[0] ?? s.rawDate;
        const decided = s.status === "DECISION";
        const sessionId = sessionIdByRawDate?.[s.rawDate];
        const me = currentDiscordId
          ? users.find((u) => u.userId === currentDiscordId)
          : undefined;
        const myAtt = me ? (s.attendances[me.userId] ?? "－") : null;
        const myTimes: AttendanceTimes | null = me
          ? (s.attendanceTimes?.[me.userId] ?? null)
          : null;
        const canAnswer =
          mode === "native" &&
          !!me &&
          !!sessionId &&
          !!attendanceOptions &&
          attendanceOptions.choices.length > 0;
        return (
          <li
            key={s.rawDate}
            className={
              "flex flex-col gap-1 rounded-md border px-2.5 py-2 " +
              (decided
                ? "border-[var(--neon-cyan)]/45 bg-[var(--neon-cyan)]/8"
                : "border-border/40 bg-secondary/15")
            }
          >
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span
                className={
                  "font-mono text-[13px] tabular-nums " +
                  (decided ? "font-medium text-[var(--neon-cyan)]" : "text-foreground")
                }
              >
                {dateLabel}
              </span>
              {(s.startTime || s.endTime) && (
                <span className="font-mono text-[12px] tabular-nums text-muted-foreground">
                  {s.startTime}
                  <span className="mx-0.5 opacity-60">~</span>
                  {s.endTime}
                </span>
              )}
              {decided && (
                <span className="rounded-sm bg-[var(--neon-cyan)]/15 px-1 py-[0.5px] text-[11px] text-[var(--neon-cyan)]">
                  {m.schedule.decided}
                </span>
              )}
              <OptionalSessionBadge
                optional={optionalByRawDate?.[s.rawDate] ?? false}
              />
              <span className="ml-auto">
                <AttendanceSummaryChip
                  users={users}
                  attendances={s.attendances}
                />
              </span>
            </div>

            {/* 自分の回答。native は押すとその場で変えられる。 */}
            {me && (
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-muted-foreground">
                  {m.schedule.agendaMine}
                </span>
                {canAnswer && sessionId && attendanceOptions ? (
                  <NativeAttendancePopover
                    sessionId={sessionId}
                    currentSymbol={myAtt ?? "－"}
                    attendanceOptions={attendanceOptions}
                    triggerClass={ATT_TONE[myAtt ?? "－"] ?? ATT_TONE_FALLBACK}
                    userName={me.name}
                    displayDate={dateLabel}
                    currentTimes={myTimes}
                  />
                ) : (
                  <span
                    className={
                      "inline-flex h-5 min-w-[1.75rem] items-center justify-center rounded-sm border px-1 text-[12px] leading-none " +
                      (ATT_TONE[myAtt ?? "－"] ?? ATT_TONE_FALLBACK)
                    }
                    title={describeAttendanceTimes(myTimes, locale) ?? undefined}
                  >
                    {myAtt}
                    {formatAttendanceTimesHint(myTimes) && (
                      <span className="ml-1 font-mono text-[11px] leading-none opacity-80 tabular-nums">
                        {formatAttendanceTimesHint(myTimes)}
                      </span>
                    )}
                  </span>
                )}
                <CalendarClock
                  className="ml-auto h-3 w-3 shrink-0 text-muted-foreground/50"
                  aria-hidden
                />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
