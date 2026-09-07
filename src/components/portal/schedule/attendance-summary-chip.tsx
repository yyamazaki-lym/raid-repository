/**
 * 行ごとの出欠サマリーチップ (UI-9、2026-09-07)。
 *
 * 予定表は「1 列 = 1 人」なので行を見れば 8 人分の記号は並ぶが、
 * 「何人 OK で誰が未回答か」は 8 列を目で追う必要があった
 * (調査ノート第 4 回 8-3 UI-9)。行のアイコン列に内訳を 1 つ添える。
 *
 * ## 出す情報を絞る
 *
 * チップに出すのは **参加見込みの人数 / 対象人数** と **未回答の数**だけ。
 * 5 種類の記号を全部並べると行が横に伸びて、表そのものより読みにくく
 * なる。内訳と未回答者の名前は `title` (hover) に入れる — 誰が未回答かは
 * 催促するときにだけ必要な情報で、常時見せると監視感が出る
 * (W-27 の既読管理で「誰が未読かは管理者のみ」にしたのと同じ考え)。
 *
 * 色は 3 段階 (`attendanceStage`):
 *   full = 成立 / waiting = 未回答が残っている / short = 人数不足
 * 未回答が残っている間は「足りない」を赤で出さない (まだ埋まる余地がある)。
 */
"use client";

import { useLocale, useMessages } from "@/lib/i18n/client";
import { getAttendanceLabel } from "@/lib/schedule/attendance-ui";
import {
  attendanceStage,
  availableCount,
  summarizeAttendance,
} from "@/lib/schedule/attendance-summary";

/**
 * 揃える人数。8 人レイド固定なので 8。ロスターが 9 人以上 (補欠込み) の
 * ときに「9 人揃わないと成立しない」と出さないよう上限として使う。
 */
const RAID_PARTY_SIZE = 8;

export function AttendanceSummaryChip({
  users,
  attendances,
  reserveSpace = false,
}: {
  users: ReadonlyArray<{ userId: string; name: string }>;
  attendances: Readonly<Record<string, string>>;
  /** 値が無い行でも幅だけ残して縦揃えを保つ (他のアイコン列と同じ方針)。 */
  reserveSpace?: boolean;
}) {
  const m = useMessages();
  const locale = useLocale();
  const summary = summarizeAttendance(users, attendances);
  if (summary.total === 0) {
    return reserveSpace ? (
      <span aria-hidden className="inline-block w-[4.25rem] shrink-0" />
    ) : null;
  }

  const required = Math.min(RAID_PARTY_SIZE, summary.total);
  const stage = attendanceStage(summary, required);
  const tone =
    stage === "full"
      ? "border-emerald-400/45 bg-emerald-400/10 text-emerald-200"
      : stage === "waiting"
        ? "border-amber-400/40 bg-amber-400/10 text-amber-200"
        : "border-border/50 text-muted-foreground";

  // hover に内訳と未回答者。記号のラベルは表示言語つきで引く。
  const parts = [
    summary.ok > 0 ? `${getAttendanceLabel("◯", locale) ?? "◯"} ${summary.ok}` : null,
    summary.late > 0 ? `${getAttendanceLabel("⏰", locale) ?? "⏰"} ${summary.late}` : null,
    summary.undecided > 0
      ? `${getAttendanceLabel("△", locale) ?? "△"} ${summary.undecided}`
      : null,
    summary.no > 0 ? `${getAttendanceLabel("×", locale) ?? "×"} ${summary.no}` : null,
    summary.other > 0 ? m.attendanceSummary.other(summary.other) : null,
    summary.unanswered > 0 ? m.attendanceSummary.unanswered(summary.unanswered) : null,
  ].filter(Boolean);
  const title =
    parts.join(" / ") +
    (summary.unansweredNames.length > 0
      ? `\n${m.attendanceSummary.unansweredNames(summary.unansweredNames.join("、"))}`
      : "");

  return (
    <span
      title={title}
      aria-label={title.replace(/\n/g, " ")}
      className={
        "inline-flex w-[4.25rem] shrink-0 items-center justify-center gap-1 rounded-sm border px-1 py-0.5 font-mono text-[11px] tabular-nums " +
        tone
      }
    >
      {m.attendanceSummary.chip(availableCount(summary), required)}
      {summary.unanswered > 0 && (
        <span className="opacity-70">{`+${summary.unanswered}?`}</span>
      )}
    </span>
  );
}
