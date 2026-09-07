/**
 * 練習ログ: 日ごとの行 (見出し + 開いたときの pull 一覧)。
 *
 * 2026-09-07 に `logs-view.tsx` から切り出した (#20)。分割の経緯と依存の
 * 向きは `./README.md` を参照。
 */
"use client";

import { useState } from "react";
import { ChevronDown, Plus, Skull, Trash2, Trophy, Video } from "lucide-react";
import { wipeCauseCounts } from "@/lib/fflogs-fight-detail";
import { sessionSummary } from "@/lib/fflogs-session";
import { SessionSummaryRow } from "./session-summary-row";
import {
  type DaySummary,
  type FloorMap,
  floorHalf,
  floorLabel,
  floorToneClass,
  formatFightDuration,
  formatPercentage,
  percentageToneClass,
  phaseToneClass,
} from "@/lib/fflogs-progress";
import { useLocale, useMessages } from "@/lib/i18n/client";
import { PERF_TEXT } from "@/lib/perf-tone";
import { type ReportVideoLink } from "@/lib/supabase/fflogs-fights";
import { PullRow } from "./pull-row";
import { formatSignedOffset, videoName } from "./video-link";

export function DayRow({
  day,
  jumpNonce,
  onDeleteReport,
  deletingCode,
  videoLinks,
  canEdit,
  showPhase,
  reserveDeaths,
  floors,
  firstPullStartByReport,
  onEditOffset,
}: {
  day: DaySummary;
  /**
   * 「日ごとの到達度」の日付クリックで飛んできたときに増える値
   * (自分の日でなければ null)。値が変わったら開く。
   */
  jumpNonce: number | null;
  /** admin のみ: このレポートを練習ログから削除する。 */
  onDeleteReport?: (reportCode: string) => void;
  deletingCode: string | null;
  videoLinks: Record<string, ReportVideoLink[]>;
  canEdit: boolean;
  showPhase: boolean;
  /** カテゴリ全体で死亡数が 1 つでも取得済みか (見出しの列幅の確保用)。 */
  reserveDeaths: boolean;
  floors: FloorMap;
  firstPullStartByReport: Map<string, number>;
  /** videoId=null で「この report に動画を追加」、非 null でその行の編集。 */
  onEditOffset: (reportCode: string, videoId: string | null) => void;
}) {
  const m = useMessages();
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  // jumpNonce の変化で開く。effect で setState するとカスケードレンダー
  // (react-hooks/set-state-in-effect) になるため、React 公式の
  // 「レンダー中に前回値と比較して調整する」形にする。
  const [lastJump, setLastJump] = useState<number | null>(jumpNonce);
  if (jumpNonce !== lastJump) {
    setLastJump(jumpNonce);
    if (jumpNonce !== null && !open) setOpen(true);
  }
  const codes = Array.from(new Set(day.fights.map((f) => f.reportCode)));
  // その日の死亡数の合計 (2026-09-03)。1 pull も取得できていない日は出さない。
  const dayDeaths = day.fights.some((f) => f.deaths !== null)
    ? day.fights.reduce((acc, f) => acc + (f.deaths ?? 0), 0)
    : null;
  // 2026-09-03 実機要望「もう少し綺麗に揃えられないか」。pull 行は列幅を
  // 固定して縦に揃えるが、**その日に 1 つも無い列は幅を取らない** (PT 指標が
  // 未取得の古い日や、動画が紐づいていない日で無駄な空白を作らないため)。
  const reserve = {
    metrics: day.fights.some((f) => f.partyDps !== null || f.deaths !== null),
    // 2026-09-07: 1 レポートに複数動画。列幅はその日の最大本数ぶん確保して
    // おき、本数の少ない report の pull は空きスロットで埋める (LOGS /
    // ANALYSIS の位置が行ごとにずれないのを維持するため)。
    videoSlots: day.fights.reduce(
      (max, f) =>
        Math.max(
          max,
          (videoLinks[f.reportCode] ?? []).filter((v) => v.videoUrl).length,
        ),
      0,
    ),
    // 絶はフェーズを層と同じ位置のチップで出すので、その列を確保する。
    phase: showPhase && day.fights.some((f) => f.lastPhase !== null),
    // 2026-09-06 W-2: フェーズ滞在バー (絶で遷移が取れた日のみ)。
    phaseBar:
      showPhase && day.fights.some((f) => f.phases !== null && f.phases.length > 1),
  };
  // 2026-09-06 W-1: この日のワイプ原因 (初死亡の技) 上位 3 つ。
  const dayWipeCauses = wipeCauseCounts(day.fights.map((f) => f.wipe), 3, locale);
  // 2026-09-07 W-3: この日の拘束 / 実戦闘 / 戦闘外 / 平均プル長。
  const daySession = sessionSummary(day.fights);

  return (
    <li
      id={`log-day-${day.date}`}
      className="scroll-mt-24 rounded-md border border-border/40 bg-secondary/15"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-left hover:bg-secondary/25"
      >
        <ChevronDown
          className={
            "h-3 w-3 shrink-0 text-muted-foreground transition-transform " +
            (open ? "rotate-0" : "-rotate-90")
          }
          aria-hidden
        />
        {/* 2026-09-03 実機要望「見出しの層・残 HP・CLEAR も揃えられるか」。
            日付は表記がデータ由来で長さが揃わない (「2026-09-01」のことも
            「2026/09/01(火) 22:00-2:00」のこともある) ため、日付列に余りを
            吸わせ (flex-1)、以降の列は固定幅にして行ごとに同じ位置で始める。 */}
        <span className="min-w-0 flex-1 truncate font-display text-sm tabular-nums">
          {day.date}
        </span>
        <span className="flex shrink-0 items-center gap-2 font-mono text-[11px] whitespace-nowrap text-muted-foreground tabular-nums">
          {/* 「12 pull」を右寄せで固定幅に入れると、数字の右端も単位も揃う。 */}
          <span className="w-14 text-right">{m.logs.pulls(day.pulls)}</span>
          <span className="w-20 text-right">
            {m.logs.combatTime(formatFightDuration(day.fightSeconds))}
          </span>
          {reserveDeaths && (
            <span
              className="inline-flex w-11 items-center justify-end gap-0.5"
              title={dayDeaths !== null ? m.logs.dayDeathsTitle : m.logs.dayDeathsMissing}
            >
              {dayDeaths !== null && (
                <>
                  <Skull className="h-2.5 w-2.5 shrink-0" aria-hidden />
                  {dayDeaths}
                </>
              )}
            </span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          {/* 何層 / どのフェーズに挑んだ日かを常時表示 (2026-08-28 実機
              フィードバック / 絶は 2026-09-03 追加)。複数に跨る日は範囲表記
              (例: 1-4層 / P1-P3)。幅は固定して右の結果チップを揃える。 */}
          {(() => {
            const chipClass =
              "w-[3.75rem] shrink-0 rounded-sm border px-1 py-0.5 text-center font-mono text-[11px] whitespace-nowrap tabular-nums ";
            if (floors && day.bestFloor !== null) {
              const dayFloors = day.fights
                .map((f) =>
                  f.encounterId !== null
                    ? (floors.byEncounter.get(f.encounterId) ?? null)
                    : null,
                )
                .filter((v): v is number => v !== null);
              const minF = Math.min(...dayFloors);
              const maxF = Math.max(...dayFloors);
              // 範囲は表示層番号 (前半/後半とも 4) で出す。単一 index の
              // 日だけ「4層前半」のようなフルラベルで区別する。
              const minD = floors.displayFloorByIndex.get(minF) ?? minF;
              const maxD = floors.displayFloorByIndex.get(maxF) ?? maxF;
              // 2026-08-30: 単一層はその層の識別色、複数層 (複合) は cyan
              // (floorToneClass(null))。どの層の日かが色で拾えるように。
              const singleFloor = minD === maxD ? maxD : null;
              // その日が 1 つの層 index に収まるときだけ前半/後半色にする
              // (「4層前半と後半の両方に挑んだ日」は複合扱いのまま)。
              const singleHalf = minF === maxF ? floorHalf(floors, maxF) : null;
              return (
                <span className={chipClass + floorToneClass(singleFloor, singleHalf)}>
                  {minF === maxF
                    ? floorLabel(floors, maxF, locale)
                    : minD === maxD
                      ? m.logs.floorShort(maxD)
                      : m.logs.floorRange(minD, maxD)}
                </span>
              );
            }
            if (!showPhase) return null;
            const dayPhases = day.fights
              .map((f) => f.lastPhase)
              .filter((v): v is number => v !== null);
            if (dayPhases.length === 0) return null;
            const minP = Math.min(...dayPhases);
            const maxP = Math.max(...dayPhases);
            return (
              <span className={chipClass + phaseToneClass(minP === maxP ? maxP : null)}>
                {minP === maxP ? `P${maxP}` : `P${minP}-${maxP}`}
              </span>
            );
          })()}
          {/* 結果 (CLEAR / 残%) も固定幅・中央寄せ。フェーズは上のチップが
              担うので、ここでは残% だけを出す (層と同じ組み立て)。 */}
          {day.clears > 0 ? (
            <span className="inline-flex w-[4.5rem] shrink-0 items-center justify-center gap-1 rounded-sm border border-emerald-400/45 bg-emerald-400/10 px-1 py-0.5 font-mono text-[11px] whitespace-nowrap text-emerald-200">
              <Trophy className="h-3 w-3 shrink-0" aria-hidden />
              CLEAR
            </span>
          ) : (
            <span
              className={
                "w-[4.5rem] shrink-0 text-center font-mono text-[11px] whitespace-nowrap tabular-nums " +
                percentageToneClass(day.bestPercentage)
              }
            >
              {m.logs.hpLeftCompact(formatPercentage(day.bestPercentage))}
            </span>
          )}
        </span>
      </button>

      {open && (
        <div className="flex flex-col gap-2 border-t border-border/30 px-3 py-2">
          {canEdit && (
            <div className="flex flex-col gap-1">
              <span className="font-mono text-[11px] tracking-[0.14em] text-muted-foreground uppercase">
                {m.logs.videoOffset}
              </span>
              {/* 2026-09-07 実機要望 2 点:
                  (1) 同じ日に複数の動画 (前半/後半・視点違い) を紐づけたい。
                      → report ごとに 1 行を持ち、動画チップを横に並べる。
                        チップを押すとその動画の URL / オフセットだけを編集
                        するので、オフセットは動画ごとに独立して入れられる。
                  (2) 「ログ削除」がオフセットの真横だと押し間違えそう。
                      → 同じ行の右端 (ml-auto) へ離した。 */}
              {codes.map((code) => {
                const links = videoLinks[code] ?? [];
                return (
                  <div key={code} className="flex w-full flex-wrap items-center gap-1.5">
                    <span className="font-mono text-[12px] text-muted-foreground/70">
                      {code.slice(0, 6)}
                    </span>
                    {links.map((v, i) => (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => onEditOffset(code, v.id)}
                        className={
                          "inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 font-mono text-[11px] transition-colors " +
                          (v.videoUrl
                            ? "border-violet-400/45 bg-violet-400/10 text-violet-200 hover:bg-violet-400/20"
                            : "border-border/50 text-muted-foreground hover:text-foreground")
                        }
                        title={m.logs.editVideoTitle}
                      >
                        <Video className="h-3 w-3 shrink-0" aria-hidden />
                        {videoName(v, m.logs.videoNth(i + 1))}
                        <span className="text-muted-foreground tabular-nums">
                          {formatSignedOffset(v.offsetSeconds)}
                        </span>
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => onEditOffset(code, null)}
                      title={m.logs.addVideoTitle}
                      className="inline-flex items-center gap-1 rounded-sm border border-dashed border-border/60 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground transition-colors hover:border-violet-400/45 hover:text-violet-200"
                    >
                      <Plus className="h-3 w-3 shrink-0" aria-hidden />
                      {m.logs.addVideo}
                    </button>
                    {/* 2026-08-30: 誤って取り込んだレポート (ノーマル等) を
                        ここから消せるようにする。削除 = pull を消したうえで
                        以後の同期でも取り込まない (除外リスト行き)。 */}
                    {onDeleteReport && (
                      <button
                        type="button"
                        onClick={() => onDeleteReport(code)}
                        disabled={deletingCode === code}
                        aria-label={m.logs.deleteReportAria(code)}
                        title={m.logs.deleteReportTitle}
                        className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-sm border border-rose-500/30 px-1.5 py-0.5 font-mono text-[11px] text-rose-300/80 transition-colors hover:bg-rose-500/15 hover:text-rose-200 disabled:opacity-40"
                      >
                        <Trash2 className="h-3 w-3 shrink-0" aria-hidden />
                        {m.logs.deleteReport}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {dayWipeCauses.length > 0 && (
            <p
              className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[12px] tabular-nums"
              title={m.logs.dayWipeCausesTitle}
            >
              <span className="tracking-[0.14em] text-muted-foreground uppercase">
                {m.logs.wipeCauses}
              </span>
              {dayWipeCauses.map((c) => (
                <span key={c.ability} className="inline-flex items-baseline gap-1">
                  <span className={PERF_TEXT.bad}>{c.ability}</span>
                  <span className="text-muted-foreground">×{c.count}</span>
                </span>
              ))}
            </p>
          )}
          {/* 2026-09-07 W-3: セッションサマリー。pull 一覧の直上に置く
              (「この日は何をどれだけやったか」を読んでから明細に入る流れ)。 */}
          <SessionSummaryRow summary={daySession} />
          <ul className="flex flex-col gap-1">
            {day.fights.map((f, i) => (
              <PullRow
                key={`${f.reportCode}:${f.fightId}`}
                index={i + 1}
                fight={f}
                videos={videoLinks[f.reportCode] ?? []}
                showPhase={showPhase}
                floors={floors}
                firstPullStartMs={firstPullStartByReport.get(f.reportCode) ?? null}
                reserve={reserve}
              />
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}
