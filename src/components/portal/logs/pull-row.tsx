/**
 * 練習ログ: pull 1 本の行 (時刻 / 層・フェーズ / 結果 / PT 指標 / 各種リンク)。
 *
 * 2026-09-07 に `logs-view.tsx` から切り出した (#20)。分割の経緯と依存の
 * 向きは `./README.md` を参照。
 *
 * ## 1 行に収める (L-6、2026-09-08 実機報告)
 *
 * 26 pull の日を開くと行によって内容が横幅を超えて 2 行になり、行の高さが
 * 揃わず一覧性が落ちていた。折り返しは `<li>` の `flex-wrap` で起きる。
 * **`flex-wrap` を外すと今度は溢れる**ので、どの列を可変にするかを決めた:
 *
 *   - **可変にできるのは技名 (ワイプ原因) だけ。** 他は桁数で幅が決まる
 *     (#回数 / 時刻 / 戦闘時間 / 区間 / 結果 / DPS / 死亡数) か、リンクの
 *     ラベル幅で決まる
 *   - 技名は `max-w-[15rem]` の固定をやめ、`min-w-0` + `flex-1` で
 *     **残り幅に応じて縮む**ようにした。省略した全文は既存の `title` に入る
 *   - **PT 合計 DPS はクリア pull だけに出す。** 練習中の pull の DPS は
 *     「途中で落ちた分だけ低い」だけで判断材料にならない。クリア pull では
 *     タイムの裏付けになるので残す (列幅の確保も、その日にクリアがある
 *     ときだけ = `reserve.metricsDps`)
 *   - **動画チップは「マーク 1 個 + 番号」だけにする。** 再生開始時刻を
 *     行に出さない (2026-09-08 実機要望)。どの動画も同じ pull の同じ瞬間へ
 *     飛ぶので、行で要るのは「どれを開くか」だけ。幅が 5.5N → 1.25 + 1.25N rem
 *
 * ⚠ 死亡数は練習 pull でも意味がある (何人落ちたか) ので残す。DPS だけを
 * 出し分けている。
 *
 * ## 詳細は下へ展開する (UI-14、2026-09-08)
 *
 * 構造化リキャップ (死亡イベントの一覧) を**行に足すことはできない** —
 * L-6 で 1 行に収めたばかりで、可変列も技名の 1 つで使い切っている。
 * 行の右端に開閉ボタンだけを置き、中身は `w-full` の子として下の行に
 * 展開する (`flex-wrap` の折り返しをそのまま使うので、レイアウトの
 * 仕組みを増やさない)。取得は開いたときだけ (`pull-detail-panel.tsx`)。
 */
"use client";

import { useState } from "react";
import {
  BarChart3,
  ChevronDown,
  Film,
  Microscope,
  ShieldAlert,
  Skull,
  Swords,
} from "lucide-react";
import {
  formatMs,
  formatWipeLabel,
  jobAbbr,
  wipeAbilityLabel,
} from "@/lib/fflogs-fight-detail";
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
import { PullDetailPanel } from "./pull-detail-panel";
import { videoName } from "./video-link";

/**
 * pull 行の DOM id (UI-1、2026-09-08)。プル・ボックス列 (`pull-box-row.tsx`)
 * が押された pull までスクロールするのに使う。report code + fight ID の対は
 * `fflogs_fights` の複合主キーそのものなので衝突しない。
 */
export function pullAnchorId(reportCode: string, fightId: number): string {
  return `log-pull-${reportCode}-${fightId}`;
}

export function PullRow({
  index,
  fight,
  categoryId,
  videos,
  showPhase,
  floors,
  firstPullStartMs,
  flashNonce,
  reserve,
}: {
  index: number;
  fight: FightRow;
  /** W-7 (2026-09-08): ミス注釈をコンテンツ単位で集計するための非正規化キー。 */
  categoryId: string | null;
  /** この pull のレポートに紐づいた動画 (0..n 本)。オフセットは 1 本ごと。 */
  videos: ReportVideoLink[];
  showPhase: boolean;
  floors: FloorMap;
  firstPullStartMs: number | null;
  /**
   * この pull がプル・ボックス列から選ばれた回数 (L-5 ③、2026-09-08)。
   * null なら選ばれていない。**値が変わるたびにハイライトを出し直す**
   * ため、真偽値ではなく nonce にしてある (同じ pull の箱を続けて押しても
   * もう一度光る — 真偽値だと 2 回目は再生されない)。
   */
  flashNonce: number | null;
  /**
   * 列幅を確保するか (2026-09-03)。その日のどれかの pull に値があれば、
   * 値の無い pull も幅だけ残して縦揃えを保つ。1 つも無い列は幅を取らない。
   */
  reserve: {
    metrics: boolean;
    /**
     * PT 合計 DPS の列幅を確保するか (L-6、2026-09-08)。
     * **その日にクリア pull があるときだけ** true。DPS はクリア pull にしか
     * 出さないので、クリアの無い日は列そのものを作らない。
     */
    metricsDps: boolean;
    /** その日の 1 レポートあたり最大動画本数 (列幅の確保用)。 */
    videoSlots: number;
    phase: boolean;
    phaseBar: boolean;
  };
}) {
  const m = useMessages();
  const locale = useLocale();
  // UI-14 (2026-09-08): 詳細の開閉。開いたことがある pull は state を
  // 持ったままにする (閉じて開き直しても再取得しない)。
  const [detailOpen, setDetailOpen] = useState(false);
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
    <li
      // UI-1 (2026-09-08): プル・ボックス列から個々の pull へ飛べるように
      // 錨を付ける。report + fight ID の対はカテゴリ内で一意
      // (`fflogs_fights` の複合主キーと同じ)。
      id={pullAnchorId(fight.reportCode, fight.fightId)}
      className="relative flex scroll-mt-24 flex-wrap items-center gap-x-2 gap-y-1 rounded-sm border border-border/30 bg-background/30 px-2 py-1"
    >
      {/* L-5 ③ (2026-09-08): 箱から飛んできた行を短く光らせる。30 行の中へ
          スクロールしても「どれに来たか」が分からないという実機報告。
          `key` に nonce を入れて要素を作り直すことでアニメを再生する
          (同じ pull を続けて押しても再度光る)。行の内容には触らない
          overlay なので、レイアウトもタブ順も動かない。
          動きの停止は `prefers-reduced-motion` (globals.css) 側。 */}
      {flashNonce !== null && (
        <span
          key={flashNonce}
          aria-hidden
          className="pull-jump-flash pointer-events-none absolute inset-0 rounded-sm ring-2 ring-[var(--neon-cyan)]/70"
        />
      )}
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
      {/* UI-14 (2026-09-08): 詳細 (構造化リキャップ) の開閉は **#回数の列を
          そのままボタンにする**。独立したボタンを右端に足すと行幅が
          +22px 増え、L-6 で下げた折り返しの閾値 (実データで約 670px) が
          押し戻される (実測でそうなった)。`#` の記号は意味を持たないので、
          そこを開閉の矢印に差し替えれば **幅は 1px も増えない**。
          死亡が 0 件の pull (kill / 未取得) でも押せるままにする —
          「取得できていない」と分かること自体に意味がある。 */}
      <button
        type="button"
        onClick={() => setDetailOpen((v) => !v)}
        aria-expanded={detailOpen}
        aria-label={m.logs.pullDetailToggleNth(index)}
        title={m.logs.pullDetailToggleNth(index)}
        className={
          "inline-flex w-8 shrink-0 items-center justify-end gap-0.5 font-mono text-[11px] tabular-nums transition-colors " +
          (detailOpen
            ? "text-[var(--neon-cyan)]"
            : "text-cyan-300/80 hover:text-[var(--neon-cyan)]")
        }
      >
        <ChevronDown
          className={
            "h-2.5 w-2.5 shrink-0 transition-transform " +
            (detailOpen ? "" : "-rotate-90")
          }
          aria-hidden
        />
        {index}
      </button>
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
            {/* L-6 (2026-09-08): DPS はクリア pull だけ。練習中の pull の
                DPS は「途中で落ちた分だけ低い」だけで判断材料にならず、
                行幅を食って折り返しの原因になっていた。クリア pull では
                タイムの裏付けになるので残す。列幅はその日にクリアが
                あるときだけ確保する。 */}
            {reserve.metricsDps && (
              <span
                className="inline-flex w-14 items-center justify-end gap-0.5 text-foreground/80"
                title={
                  fight.kill && fight.partyDps !== null
                    ? m.logs.partyDpsTitle
                    : m.logs.partyDpsClearOnly
                }
              >
                {fight.kill && fight.partyDps !== null && (
                  <>
                    <Swords
                      className="h-2.5 w-2.5 shrink-0 text-muted-foreground"
                      aria-hidden
                    />
                    {formatPartyDps(fight.partyDps)}
                  </>
                )}
              </span>
            )}
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
        // L-7 (2026-09-08): 技名は表示言語で選ぶ (`ja` / `en` が入っていれば
        // それ、無ければ FFLogs が返した名前)。
        const wipeAbility = fight.wipe
          ? wipeAbilityLabel(fight.wipe, locale)
          : null;
        const wipeChip = fight.wipe ? (
          <span
            className={
              // L-6 (2026-09-08): 固定の max-w をやめ、残り幅に応じて縮む
              // ようにする (狭い画面では隣のリンク群に寄りすぎ、広い画面では
              // 逆に余っていた)。行の中で**可変にできるのはここだけ**なので、
              // flex-1 を持つのもこの列だけにすること。
              "inline-flex min-w-0 flex-1 basis-0 items-center gap-1 rounded-sm border px-1.5 py-0.5 font-mono text-[11px] tabular-nums " +
              PERF_CHIP.bad
            }
            title={
              m.logs.wipeFirstDeath(formatMs(fight.wipe.t)) +
              (fight.wipe.phase !== null ? ` (P${fight.wipe.phase})` : "") +
              ` / ${jobAbbr(fight.wipe.job)}` +
              (wipeAbility ? ` ← ${wipeAbility}` : "") +
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
            className="inline-flex items-center gap-1 px-1.5 py-0.5 font-mono text-[11px] tracking-[0.14em] text-amber-200 uppercase transition-colors hover:bg-amber-400/20"
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
          className="inline-flex items-center gap-1 rounded-sm border border-sky-400/45 bg-sky-400/10 px-1.5 py-0.5 font-mono text-[11px] tracking-[0.14em] text-sky-200 uppercase transition-colors hover:bg-sky-400/15"
        >
          <Microscope className="h-2.5 w-2.5" aria-hidden />
          Analysis
        </a>
        {/* 動画チップ。動画が無い pull には同じ幅の空きを置く (その日に
            動画がある場合のみ) ので、LOGS / ANALYSIS の位置が行ごとに
            ずれない。スロット数はその日の最大本数なので日の中で縦に揃う。
            中身の変遷と幅の根拠は下のブロックのコメントを参照。 */}
        {(() => {
          // 動画チップ (L-6、2026-09-08 → 2026-09-08 実機要望で再縮小)。
          //
          // 経緯: もともと 1 本 = 1 チップ (各 5.5rem) で、複数動画の行が
          // 折り返す原因になっていた。まず「枠を共有した 1 グループ」に畳み、
          // 1 本目だけ再生開始時刻を出す形にした。その実機確認で
          // **「再生開始時間はいらない。動画マークと動画ナンバーだけにして
          // 小さくできるか」**という要望が出たので、時刻を全部落とした。
          //
          // 妥当な要望だった: どの動画も**同じ pull の同じ瞬間**へ飛ぶので、
          // 行の中で知りたいのは「動画があるか / どれを開くか」だけ。時刻は
          // 開いた先で見える値で、行に出す必要が無い (名前と時刻は title に
          // 入れてある)。
          //
          // 形: フィルムのマークをグループの先頭に **1 個だけ**置き、その右に
          // 番号のリンクを並べる (`▶ 1 2`)。マークを番号ごとに繰り返さない
          // のは幅のため。番号だけだと意味が読めないので、マークは要る。
          //
          // 幅: 5.5N rem → 1.25 + 1.25N rem。1 本で 4.75rem → 2.5rem、
          // 2 本で 6.25rem → 3.75rem。
          if (reserve.videoSlots === 0) return null;
          // その日の最大本数ぶんだけ幅を確保して、LOGS / ANALYSIS の位置が
          // 行ごとにずれないのを維持する (従来の spacer と同じ役割)。
          const reservedWidth = `calc(1.25rem + ${reserve.videoSlots} * 1.25rem)`;
          return (
            <span
              className="inline-flex shrink-0 items-stretch"
              style={{ width: reservedWidth }}
            >
              {videoJumps.length > 0 && (
                <span className="inline-flex h-full items-stretch overflow-hidden rounded-sm border border-violet-400/45 bg-violet-400/10">
                  {/* マークは 1 個だけ。押せないので aria からも外す
                      (すぐ右の番号リンクが動画 1 本ずつに対応する)。 */}
                  <span
                    className="inline-flex w-5 shrink-0 items-center justify-center text-violet-200/70"
                    aria-hidden
                  >
                    <Film className="h-2.5 w-2.5" aria-hidden />
                  </span>
                  {videoJumps.map((j, i) => (
                    <a
                      key={j.id}
                      href={j.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={m.logs.videoMomentTitleNamedAt(
                        j.name,
                        formatClock(j.seconds),
                      )}
                      aria-label={m.logs.videoMomentTitleNamedAt(
                        j.name,
                        formatClock(j.seconds),
                      )}
                      className="inline-flex w-5 items-center justify-center border-l border-violet-400/35 py-0.5 font-mono text-[11px] text-violet-200 tabular-nums transition-colors hover:bg-violet-400/20"
                    >
                      {i + 1}
                    </a>
                  ))}
                </span>
              )}
            </span>
          );
        })()}
      </span>
      {/* UI-14: 展開パネル。`w-full` なので flex-wrap の折り返しで行の
          下に落ちる (追加のレイアウト機構は要らない)。 */}
      {detailOpen && (
        <PullDetailPanel
          reportCode={fight.reportCode}
          fightId={fight.fightId}
          categoryId={categoryId}
        />
      )}
    </li>
  );
}
