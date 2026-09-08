"use client";

import { useState, useTransition } from "react";
import { ClipboardCheck, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { fetchAttendanceSummaryAction } from "@/lib/server/attendance-summary-actions";
import type { AttendanceHistory } from "@/lib/schedule/attendance-history";
import type { AttendanceMismatch } from "@/lib/schedule/attendance-actuals";
import { useMessages } from "@/lib/i18n/client";

/**
 * 出席サマリー (W-19、2026-09-08)。
 *
 * FFLogs のログに映っていた人 (W-6 で保存) と ○×△ の回答を突き合わせた
 * 結果を出す。**公開ランキングと連続記録は出さない** (調査ノート 6-2 —
 * 8 人の固定で出席率を並べると個人攻撃になりやすく、streak は休めない
 * 空気を作る)。
 *
 * 可視範囲は server 側で決まる (`fetchAttendanceSummaryAction`):
 *   - 幹部 (admin): 全員の集計とズレ一覧
 *   - 本人 (非 admin): 自分の行と自分に関するズレだけ
 * client には見せてよい分しか届かないので、ここでの分岐は文言だけ。
 *
 * データは **dialog を開いたときに取る**。閲覧頻度が低い割に
 * (service role の) 集計クエリが 5 本走るので、ページ表示のたびに
 * 引くのは無駄が大きい。
 */
export function AttendanceSummaryDialog() {
  const m = useMessages();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [data, setData] = useState<{
    selfOnly: boolean;
    windowDays: number;
    history: AttendanceHistory;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) return;
    setError(null);
    start(async () => {
      const r = await fetchAttendanceSummaryAction();
      if (!r.ok) {
        setError(r.reason);
        setData(null);
        return;
      }
      setData({
        selfOnly: r.selfOnly,
        windowDays: r.windowDays,
        history: r.history,
      });
    });
  };

  const h = data?.history;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border/60 text-muted-foreground transition-colors hover:border-[var(--neon-cyan)]/60 hover:text-foreground"
        aria-label={m.attendanceHistory.trigger}
        title={m.attendanceHistory.trigger}
      >
        <ClipboardCheck className="h-4 w-4" aria-hidden />
      </DialogTrigger>

      <DialogContent className="glass top-[8svh] max-h-[80svh] max-w-[calc(100%-1.5rem)] translate-y-0 gap-0 overflow-y-auto p-0 sm:top-20 sm:max-w-2xl">
        <DialogHeader className="flex-row items-start gap-3 border-b border-border/40 p-5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-[var(--neon-cyan)]/40 bg-background/40 text-[var(--neon-cyan)] shadow-[0_0_18px_-6px_var(--neon-cyan)]">
            <ClipboardCheck className="h-4 w-4" aria-hidden />
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <DialogTitle className="font-display text-base tracking-[0.16em] uppercase">
              {m.attendanceHistory.title}
            </DialogTitle>
            <DialogDescription className="text-xs">
              {h
                ? m.attendanceHistory.description(
                    data!.windowDays,
                    h.sessions,
                    h.noLog + h.unmatched,
                  )
                : m.attendanceHistory.descriptionLoading}
            </DialogDescription>
          </div>
        </DialogHeader>

        <div className="flex flex-col gap-4 p-5">
          {pending && !h ? (
            <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              {m.common.loading}
            </div>
          ) : error ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[12px] text-destructive-foreground/90">
              {error}
            </div>
          ) : !h ? null : h.sessions === 0 ? (
            <div className="rounded-md border border-border/40 bg-secondary/10 px-3 py-2 text-[12px] text-muted-foreground">
              {/* ⚠ 「pull はあるのに参加者が 1 人も紐づいていない」は
                  「全員休んだ」ではなく **突合が効いていない** サイン。
                  ログが無いだけの場合と文言を分ける (直し方が違う)。 */}
              {h.unmatched > 0
                ? m.attendanceHistory.emptyUnmatched(h.unmatched)
                : m.attendanceHistory.emptyNoLog}
            </div>
          ) : h.rows.length === 0 ? (
            <div className="rounded-md border border-border/40 bg-secondary/10 px-3 py-2 text-[12px] text-muted-foreground">
              {m.attendanceHistory.emptyNoMember}
            </div>
          ) : (
            <>
              {data!.selfOnly && (
                <p className="text-[11px] leading-snug text-muted-foreground/85">
                  {m.attendanceHistory.selfOnlyNote}
                </p>
              )}
              {/* 表は狭い端末で横スクロール (本文は 12px を維持する)。
                  ⚠ min-w は 20rem。24rem にしていたら 375px 幅で「ズレ」列が
                  画面外に出て、横スクロールしないと肝心の数字が読めなかった
                  (mobile 実測)。名前は truncate して数字 3 列を優先する。 */}
              <div className="overflow-x-auto">
                <table className="w-full min-w-[20rem] border-collapse text-[12px]">
                  <thead>
                    <tr className="border-b border-border/40 text-left text-[11px] tracking-normal text-muted-foreground">
                      <th className="py-1.5 pr-2 font-normal">
                        {m.attendanceHistory.colMember}
                      </th>
                      <th className="py-1.5 pr-2 text-right font-normal">
                        {m.attendanceHistory.colSaidYes}
                      </th>
                      <th className="py-1.5 pr-2 text-right font-normal">
                        {m.attendanceHistory.colAttended}
                      </th>
                      <th className="py-1.5 text-right font-normal">
                        {m.attendanceHistory.colMismatch}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {h.rows.map((row) => (
                      <tr
                        key={row.discordUserId}
                        className="border-b border-border/20 last:border-b-0"
                      >
                        <td className="max-w-[9rem] truncate py-1.5 pr-2 text-foreground">
                          {row.displayName}
                        </td>
                        <td className="py-1.5 pr-2 text-right font-mono tabular-nums text-muted-foreground">
                          {row.saidYes}/{row.sessions}
                        </td>
                        <td className="py-1.5 pr-2 text-right font-mono tabular-nums text-foreground">
                          {row.attended}/{row.sessions}
                        </td>
                        <td
                          className={
                            "py-1.5 text-right font-mono tabular-nums " +
                            (row.mismatches > 0
                              ? "text-amber-200"
                              : "text-muted-foreground/60")
                          }
                        >
                          {row.mismatches}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {h.mismatches.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <span className="text-[11px] tracking-normal text-muted-foreground">
                    {m.attendanceHistory.mismatchHeading}
                  </span>
                  <ul className="flex flex-col gap-1">
                    {h.mismatches.map((mm) => (
                      <li
                        key={`${mm.sessionDate}:${mm.discordUserId}:${mm.kind}`}
                        className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-md border border-border/30 bg-secondary/10 px-2 py-1"
                      >
                        <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                          {mm.sessionDate}
                        </span>
                        <span className="text-[12px] text-foreground">
                          {mm.displayName}
                        </span>
                        {/* min-w-0 が無いと flex 子が縮まず、狭い端末で
                            「(1/6 pull)」の括弧が画面外に切れる (mobile 実測)。 */}
                        <span className="min-w-0 text-[12px] text-amber-200">
                          {mismatchLabel(m, mm.kind, mm.pulls, mm.dayPulls)}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="text-[11px] leading-snug text-muted-foreground/85">
                    {m.attendanceHistory.mismatchNote}
                  </p>
                </div>
              )}
              {h.unmatched > 0 && (
                <p className="text-[11px] leading-snug text-amber-200/90">
                  {m.attendanceHistory.unmatchedNote(h.unmatched)}
                </p>
              )}
              {h.excluded > 0 && (
                <p className="text-[11px] leading-snug text-muted-foreground/85">
                  {m.attendanceHistory.excludedNote(h.excluded)}
                </p>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** ズレ 1 件の文言。部分参加だけは pull 数を添える。 */
function mismatchLabel(
  m: ReturnType<typeof useMessages>,
  kind: AttendanceMismatch,
  pulls: number,
  dayPulls: number,
): string {
  switch (kind) {
    case "absent-though-yes":
      return m.attendanceHistory.kindAbsentThoughYes;
    case "partial-though-yes":
      return m.attendanceHistory.kindPartialThoughYes(pulls, dayPulls);
    case "present-though-no":
      return m.attendanceHistory.kindPresentThoughNo;
    case "present-though-other":
      return m.attendanceHistory.kindPresentThoughOther;
  }
}
