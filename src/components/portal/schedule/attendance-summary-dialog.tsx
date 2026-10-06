"use client";

import { useState, useTransition } from "react";
import { ClipboardCheck, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  fetchAttendanceSummaryAction,
  refetchUnmatchedAttendanceAction,
} from "@/lib/server/attendance-summary-actions";
import type { AttendanceHistory } from "@/lib/schedule/attendance-history";
import type { AttendanceMismatch } from "@/lib/schedule/attendance-actuals";
import { useServerText } from "@/lib/i18n/use-server-text";
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
  const sr = useServerText();
  const m = useMessages();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [data, setData] = useState<{
    selfOnly: boolean;
    windowDays: number;
    history: AttendanceHistory;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refetching, startRefetch] = useTransition();

  const load = async () => {
    const r = await fetchAttendanceSummaryAction();
    if (!r.ok) {
      setError(sr(r.reason));
      setData(null);
      return;
    }
    setData({
      selfOnly: r.selfOnly,
      windowDays: r.windowDays,
      history: r.history,
    });
  };

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) return;
    setError(null);
    start(load);
  };

  // 2026-10-06: 突合できなかった日のレポートを取り直す (幹部のみ)。参加者名は
  // 保存しないので、「ログ名」を後から入れた日はレポートを取り直さないと
  // 数え直せない (詳細は `refetchUnmatchedAttendanceAction`)。終わったら
  // 集計を読み直して、紐づいた日を画面に反映する。
  const onRefetch = () => {
    startRefetch(async () => {
      const r = await refetchUnmatchedAttendanceAction();
      if (!r.ok) {
        toast.error(sr(r.reason));
        return;
      }
      if (r.requested === 0) {
        // 対象はあるのに 1 件も取りに行けなかった (FFLogs の取得枠・時間切れ)
        // ときに「取り直すレポートはありません」と出さない。
        if (r.remaining > 0) {
          toast.warning(m.attendanceHistory.refetchStalled(r.remaining));
        } else {
          toast.info(m.attendanceHistory.refetchNothing);
        }
        return;
      }
      toast.success(
        m.attendanceHistory.refetchDone(r.requested, r.attendanceMatched) +
          (r.failed > 0 ? m.logsSync.failedSuffix(r.failed) : "") +
          (r.remaining > 0 ? m.attendanceHistory.refetchRemaining(r.remaining) : ""),
      );
      if (r.attendanceUnresolved > 0) {
        toast.warning(
          m.logsSync.attendanceUnresolved(
            r.attendanceMatched,
            r.attendanceUnresolvedNames.join(" / "),
          ),
        );
      }
      if (r.attendanceNoNameReports > 0) {
        toast.warning(m.logsSync.attendanceNoNames(r.attendanceNoNameReports));
      }
      setError(null);
      await load();
    });
  };

  const h = data?.history;
  // 取り直しは幹部だけ (Server Action 側でも確かめる)。突合できなかった日が
  // ある時だけ出す。
  const refetchBlock =
    h && !data!.selfOnly && h.unmatched > 0 ? (
      <div className="flex flex-col gap-1.5 rounded-md border border-border/40 bg-secondary/10 px-3 py-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={refetching}
          onClick={onRefetch}
          className="h-8 gap-1.5 self-start px-3 text-[12px] tracking-normal"
        >
          {refetching ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          )}
          {refetching
            ? m.attendanceHistory.refetchRunning
            : m.attendanceHistory.refetchButton}
        </Button>
        <p className="text-[11px] leading-snug text-muted-foreground/85">
          {m.attendanceHistory.refetchHint}
        </p>
      </div>
    ) : null;

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
            <>
              <div className="rounded-md border border-border/40 bg-secondary/10 px-3 py-2 text-[12px] text-muted-foreground">
                {/* ⚠ 「pull はあるのに参加者が 1 人も紐づいていない」は
                    「全員休んだ」ではなく **突合が効いていない** サイン。
                    ログが無いだけの場合と文言を分ける (直し方が違う)。 */}
                {h.unmatched > 0
                  ? m.attendanceHistory.emptyUnmatched(h.unmatched)
                  : m.attendanceHistory.emptyNoLog}
              </div>
              {refetchBlock}
            </>
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
              {refetchBlock}
              {h.excluded > 0 && (
                <p className="text-[11px] leading-snug text-muted-foreground/85">
                  {m.attendanceHistory.excludedNote(h.excluded)}
                </p>
              )}
              {/* L-14 (2026-09-09): 同期式で回答のスナップショットが無い日。
                  「全員不在」にはせず、外した数を出して母数を黙って
                  減らさない。 */}
              {h.noAttendanceData > 0 && (
                <p className="text-[11px] leading-snug text-muted-foreground/85">
                  {m.attendanceHistory.noAttendanceDataNote(h.noAttendanceData)}
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
