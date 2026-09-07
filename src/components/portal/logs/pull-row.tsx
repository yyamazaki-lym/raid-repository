/**
 * 練習ログ: pull 1 本の行 (時刻 / 層・フェーズ / 結果 / PT 指標 / 各種リンク)。
 *
 * 2026-09-07 に `logs-view.tsx` から切り出した (#20)。分割の経緯と依存の
 * 向きは `./README.md` を参照。
 */
"use client";

import {
  BarChart3,
  Film,
  Microscope,
  ShieldAlert,
  Skull,
  Swords,
} from "lucide-react";
import { formatMs, formatWipeLabel, jobAbbr } from "@/lib/fflogs-fight-detail";
import {
  type FightRow,
  type FloorMap,
  floorHalf,
  floorLabel,
  floorToneClass,
  formatFightDuration,
  formatPartyDps,
  formatPercentage,
  isClearFight,
  percentageToneClass,
  phaseToneClass,
} from "@/lib/fflogs-progress";
import {
  buildFflogsFightViewUrl,
  buildFflogsReportUrl,
  buildVideoTimestampUrl,
  buildXivAnalysisUrl,
  formatClock,
} from "@/lib/fflogs-url";
import { useLocale, useMessages } from "@/lib/i18n/client";
import { PERF_CHIP, PERF_TEXT, perfForDeaths } from "@/lib/perf-tone";
import { type ReportVideoLink } from "@/lib/supabase/fflogs-fights";
import { PhaseSpanBar } from "./phase-span-bar";
import { videoName } from "./video-link";

export function PullRow({
  index,
  fight,
  videos,
  showPhase,
  floors,
  firstPullStartMs,
  reserve,
}: {
  index: number;
  fight: FightRow;
  /** この pull のレポートに紐づいた動画 (0..n 本)。オフセットは 1 本ごと。 */
  videos: ReportVideoLink[];
  showPhase: boolean;
  floors: FloorMap;
  firstPullStartMs: number | null;
  /**
   * 列幅を確保するか (2026-09-03)。その日のどれかの pull に値があれば、
   * 値の無い pull も幅だけ残して縦揃えを保つ。1 つも無い列は幅を取らない。
   */
  reserve: {
    metrics: boolean;
    /** その日の 1 レポートあたり最大動画本数 (列幅の確保用)。 */
    videoSlots: number;
    phase: boolean;
    phaseBar: boolean;
  };
}) {
  const m = useMessages();
  const locale = useLocale();
  const durationSec = Math.max(0, Math.round((fight.endMs - fight.startMs) / 1000));
  // 日付のグルーピングが JST 基準なので時刻も JST に固定する
  // (閲覧者のタイムゾーンに依存すると日付と時刻がずれて見える)。
  const clock = new Date(fight.startMs).toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Tokyo",
  });

  // A-2 の肝: 「最初の pull の戦闘開始」からの相対位置 + オフセットで
  // 動画内時刻を計算する (オフセット = 動画上で pull #1 が始まる秒数)。
  // 2026-09-07: 1 レポートに複数動画。動画ごとにオフセットが違う (前半と
  // 後半が別投稿なら録画開始位置も別) ので、リンクは動画ごとに計算する。
  const videoJumps =
    firstPullStartMs === null
      ? []
      : videos.flatMap((v, i) => {
          if (!v.videoUrl) return [];
          const seconds = v.offsetSeconds + (fight.startMs - firstPullStartMs) / 1000;
          const href = buildVideoTimestampUrl(v.videoUrl, seconds);
          if (!href) return [];
          return [{ id: v.id, href, seconds, name: videoName(v, m.logs.videoNth(i + 1)) }];
        });

  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-sm border border-border/30 bg-background/30 px-2 py-1">
      {/* 2026-08-30: 10px 灰色一色の行を再配色 (実機報告「灰色だらけで
          見にくい」)。番号/時刻/時間は 11px に上げ、層は識別色チップ、
          結果 (CLEAR / 残%) は熱量色の別チップに分離した。
          2026-09-03: 3 つのメタ列 (#回数 / 時刻 / 戦闘時間) が同系の灰色で
          区別しづらかったので色相を分けた (実機要望)。層・結果・リンクが
          既に色で意味を持っているため、ここは主張しすぎない彩度に留める:
          #回数 = cyan / 時刻 = 寒色グレー / 戦闘時間 = indigo。
          戦闘時間に暖色 (amber) を当てると残 HP% の熱量色 (orange/amber) や
          Logs チップと同系になって「警告的な値」に見えるため避けた。
          3 色ともテーマ var を経由しない固定色にする — `--neon-cyan` は
          テーマで色相が動き (azure テーマでは indigo と、verdant では
          CLEAR の emerald と近づく)、列の区別がテーマ依存になるため。
          層 / 熱量色を全テーマ共通の固定色にしているのと同じ理由。
          桁数で列がずれないよう数値列は右寄せ + tabular-nums。 */}
      <span
        className="w-8 shrink-0 text-right font-mono text-[11px] text-cyan-300/80 tabular-nums"
        title={m.logs.pullIndexTitle(index)}
      >
        #{index}
      </span>
      <span
        className="w-9 shrink-0 font-mono text-[11px] text-slate-400 tabular-nums"
        title={m.logs.startTimeTitle}
      >
        {clock}
      </span>
      <span
        className="w-10 shrink-0 text-right font-mono text-[11px] text-indigo-300/90 tabular-nums"
        title={m.logs.durationTitle}
      >
        {formatFightDuration(durationSec)}
      </span>
      {(() => {
        const floor =
          floors && fight.encounterId !== null
            ? (floors.byEncounter.get(fight.encounterId) ?? null)
            : null;
        const displayFloor =
          floors && floor !== null
            ? (floors.displayFloorByIndex.get(floor) ?? floor)
            : null;
        const half = floor !== null ? floorHalf(floors, floor) : null;
        const isClear = isClearFight(fight, floors);
        // 層ラベルは「1層」〜「4層後半」で文字数が変わる。幅を固定して
        // 中央寄せにし、後続の列 (結果 / PT 指標) が行ごとにずれないようにする。
        // 2026-09-03: 絶はフェーズを同じ列のチップにする (結果チップから
        // 「P3 」の前置きが消え、零式と同じ「区間チップ + 残%」の並びになる)。
        const chipClass =
          "w-[3.75rem] shrink-0 rounded-sm border px-1 py-0.5 text-center font-mono text-[11px] whitespace-nowrap tabular-nums ";
        const segmentChip =
          floor !== null ? (
            <span className={chipClass + floorToneClass(displayFloor, half)}>
              {floorLabel(floors, floor, locale)}
            </span>
          ) : showPhase && fight.lastPhase !== null ? (
            <span className={chipClass + phaseToneClass(fight.lastPhase)}>
              P{fight.lastPhase}
            </span>
          ) : reserve.phase ? (
            <span className="w-[3.75rem] shrink-0" aria-hidden />
          ) : null;
        // 結果チップも幅を固定する (フェーズは上の区間チップに移したので
        // 零式・絶で同じ幅)。
        const resultWidth = "w-[4.25rem]";
        // kill は層を問わず CLEAR 表記 (最終層 = 濃い緑 / 他層 = 淡い緑)。
        const resultChip = fight.kill ? (
          <span
            className={
              `${resultWidth} shrink-0 rounded-sm px-1 py-0.5 text-center font-mono text-[11px] whitespace-nowrap tabular-nums ` +
              (isClear
                ? "bg-emerald-400/20 font-medium text-emerald-200"
                : "bg-emerald-400/10 text-emerald-200/80")
            }
          >
            CLEAR
          </span>
        ) : (
          <span
            className={`${resultWidth} shrink-0 rounded-sm bg-secondary/50 px-1 py-0.5 text-center font-mono text-[11px] whitespace-nowrap tabular-nums`}
          >
            <span className={percentageToneClass(fight.fightPercentage)}>
              {m.logs.hpLeftCompact(formatPercentage(fight.fightPercentage))}
            </span>
          </span>
        );
        // 2026-09-03: 残 HP% の横に PT 合計 DPS と死亡数 (取得済みの pull のみ)。
        // 個人の内訳は無い — PT として削れているか / 何人落ちたかだけ。
        // 値の無い pull もスロットの幅は残す (その日に 1 つでも値があるとき)
        // ので、数字が縦に揃う。
        const metrics = reserve.metrics ? (
          <span className="inline-flex shrink-0 items-center gap-2 font-mono text-[11px] whitespace-nowrap tabular-nums">
            <span
              className="inline-flex w-14 items-center justify-end gap-0.5 text-foreground/80"
              title={fight.partyDps !== null ? m.logs.partyDpsTitle : m.logs.partyDpsMissing}
            >
              {fight.partyDps !== null && (
                <>
                  <Swords
                    className="h-2.5 w-2.5 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                  {formatPartyDps(fight.partyDps)}
                </>
              )}
            </span>
            <span
              className={
                "inline-flex w-8 items-center justify-end gap-0.5 " +
                // 2026-09-06 (UI-12): 死亡数は 0 = 良い … 5+ = 悪い の 5 段階。
                (fight.deaths === 0
                  ? "text-muted-foreground"
                  : PERF_TEXT[perfForDeaths(fight.deaths)])
              }
              title={fight.deaths !== null ? m.logs.deathsTitle : m.logs.deathsMissing}
            >
              {fight.deaths !== null && (
                <>
                  <Skull className="h-2.5 w-2.5 shrink-0" aria-hidden />
                  {fight.deaths}
                </>
              )}
            </span>
          </span>
        ) : null;
        // 2026-09-06 W-2: フェーズ滞在バー (絶のみ)。遷移が取れていない
        // pull はその日に 1 つでもあれば幅だけ残す。
        const phaseBar =
          showPhase && fight.phases && fight.phases.length > 1 ? (
            <PhaseSpanBar spans={fight.phases} />
          ) : reserve.phaseBar ? (
            <span className="w-16 shrink-0" aria-hidden />
          ) : null;
        // 2026-09-06 W-1: ワイプ原因 (最初に落ちたジョブ ← 致命技 +同時死亡数)。
        // 個人名は持っていない。可変幅なので左グループの末尾に置く。
        const wipeChip = fight.wipe ? (
          <span
            className={
              "inline-flex max-w-[15rem] min-w-0 items-center gap-1 rounded-sm border px-1.5 py-0.5 font-mono text-[11px] tabular-nums " +
              PERF_CHIP.bad
            }
            title={
              m.logs.wipeFirstDeath(formatMs(fight.wipe.t)) +
              (fight.wipe.phase !== null ? ` (P${fight.wipe.phase})` : "") +
              ` / ${jobAbbr(fight.wipe.job)}` +
              (fight.wipe.ability ? ` ← ${fight.wipe.ability}` : "") +
              (fight.wipe.cluster > 1 ? m.logs.wipeCluster(fight.wipe.cluster) : "") +
              m.logs.wipeDeaths(fight.wipe.total)
            }
          >
            <Skull className="h-2.5 w-2.5 shrink-0 opacity-80" aria-hidden />
            <span className="truncate">{formatWipeLabel(fight.wipe, locale)}</span>
          </span>
        ) : null;
        return (
          <>
            {segmentChip}
            {phaseBar}
            {resultChip}
            {metrics}
            {wipeChip}
          </>
        );
      })()}
      <span className="ml-auto flex shrink-0 items-center gap-1">
        {/* FFLogs 群: 概要 (Logs) + 死亡 + 被ダメの 3 ビュー。2026-08-30
            調査 §2 の deep link。行が伸びないよう、追加の 2 つは
            アイコンのみ (ラベルは title / aria-label) にして左右に
            border でつないだ 1 グループとして見せる。 */}
        <span className="inline-flex items-center overflow-hidden rounded-sm border border-amber-400/45 bg-amber-400/10">
          <a
            href={buildFflogsReportUrl(fight.reportCode, fight.fightId)}
            target="_blank"
            rel="noopener noreferrer"
            title={m.logs.openFflogsTitle}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 font-mono text-[10px] tracking-[0.14em] text-amber-200 uppercase transition-colors hover:bg-amber-400/20"
          >
            <BarChart3 className="h-2.5 w-2.5" aria-hidden />
            Logs
          </a>
          <a
            href={buildFflogsFightViewUrl(
              fight.reportCode,
              fight.fightId,
              "deaths",
            )}
            target="_blank"
            rel="noopener noreferrer"
            title={m.logs.deathsViewTitle}
            aria-label={m.logs.deathsViewAria}
            className="inline-flex items-center border-l border-amber-400/35 px-1.5 py-0.5 text-amber-200/85 transition-colors hover:bg-amber-400/20 hover:text-amber-100"
          >
            <Skull className="h-2.5 w-2.5" aria-hidden />
          </a>
          <a
            href={buildFflogsFightViewUrl(
              fight.reportCode,
              fight.fightId,
              "damage-taken",
            )}
            target="_blank"
            rel="noopener noreferrer"
            title={m.logs.damageTakenTitle}
            aria-label={m.logs.damageTakenAria}
            className="inline-flex items-center border-l border-amber-400/35 px-1.5 py-0.5 text-amber-200/85 transition-colors hover:bg-amber-400/20 hover:text-amber-100"
          >
            <ShieldAlert className="h-2.5 w-2.5" aria-hidden />
          </a>
        </span>
        {/* XIVAnalysis: この pull のスキル回し / CD 落ちを自動で指摘してくれる。
            開くのは自分たちの pull を自分たちで見るための導線 (§1-F)。 */}
        <a
          href={buildXivAnalysisUrl(fight.reportCode, fight.fightId)}
          target="_blank"
          rel="noopener noreferrer"
          title={m.logs.xivAnalysisTitle}
          className="inline-flex items-center gap-1 rounded-sm border border-sky-400/45 bg-sky-400/10 px-1.5 py-0.5 font-mono text-[10px] tracking-[0.14em] text-sky-200 uppercase transition-colors hover:bg-sky-400/15"
        >
          <Microscope className="h-2.5 w-2.5" aria-hidden />
          Analysis
        </a>
        {/* 動画チップは「1:13:08」まで入る幅で固定し、動画が無い pull には
            同じ幅の空きを置く (その日に動画がある場合のみ)。これで LOGS /
            ANALYSIS の位置が行ごとにずれない。
            2026-09-07: 複数動画のときは 1 本 = 1 チップで横に並べ、頭に
            本数の番号を付ける (どのチップがどの動画かをホバー無しで拾える)。
            スロット数はその日の最大本数なので、日の中では縦に揃う。 */}
        {(() => {
          const multi = reserve.videoSlots > 1;
          // 番号 (「1 」) が入るぶんだけ複数動画の日は少し広げる。
          const slotClass = multi ? "w-[5.5rem]" : "w-[4.75rem]";
          const spacers = Math.max(0, reserve.videoSlots - videoJumps.length);
          return (
            <>
              {videoJumps.map((j, i) => (
                <a
                  key={j.id}
                  href={j.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={m.logs.videoMomentTitleNamed(j.name)}
                  className={
                    `inline-flex ${slotClass} items-center justify-center gap-1 rounded-sm border border-violet-400/45 bg-violet-400/10 px-1 py-0.5 font-mono text-[10px] tracking-[0.1em] whitespace-nowrap text-violet-200 uppercase transition-colors hover:bg-violet-400/15`
                  }
                >
                  <Film className="h-2.5 w-2.5 shrink-0" aria-hidden />
                  {multi && (
                    <span className="text-violet-200/60 tabular-nums">{i + 1}</span>
                  )}
                  {formatClock(j.seconds)}
                </a>
              ))}
              {Array.from({ length: spacers }, (_, i) => (
                <span
                  key={`video-slot-${i}`}
                  className={`${slotClass} shrink-0`}
                  aria-hidden
                />
              ))}
            </>
          );
        })()}
      </span>
    </li>
  );
}
