/**
 * 練習ログ: プル・ボックス列 (UI-1、2026-09-08)。
 *
 * 調査ノート第 4 回 8-3 UI-1。元ネタは WoWAnalyzer の `PerformanceBoxRow`
 * (1 キャスト = 1 小箱、5 段階で色分け、hover ツールチップ)。
 *
 * 現行の「1 pull = 1 行」は **1 日 30 pull で 30 行**に伸びる。日を開かないと
 * 中身が見えず、開くと今度は縦に長すぎて「その日どう転がったか」が読めない。
 * 箱列なら 1 日ぶんが 1〜3 行に収まり、**日を開かずに**「序盤で崩れて後半
 * 持ち直した」「ずっと同じところで止まっている」が分かる。
 *
 * ## 色だけで意味を伝えない (WCAG 1.4.1)
 *
 * 調査ノートのリスク欄そのもの。箱の中に**到達区間の番号を必ず書く**
 * (零式なら層番号、絶ならフェーズ番号)。討伐した pull は `✓`。
 * hover / 読み上げには時刻・区間・残 HP%・死亡数を入れる。
 *
 * そのため、**区間モデルを持つコンテンツ (零式 / 絶) でしか描かない**。
 * 討滅など区間が無いコンテンツでは箱に書ける略号が無く、色だけの列に
 * なってしまう — その場合は従来どおり日の見出しの残 HP% で足りる。
 *
 * ⚠ 討伐の箱は区間番号ではなく `✓` になる。その pull の「どの層か」は色と
 * hover に落ちるが、討伐 pull で最初に知りたいのは層ではなく討伐そのもの
 * なので、番号より `✓` を優先した。
 *
 * ## タッチ目標 (WCAG 2.5.8)
 *
 * 箱は 20px、間隔 4px で **ピッチ 24px**。24px 未満の目標は「間隔を含めて
 * 24px の円が他の目標と重ならずに収まる」なら例外に該当するので、この対に
 * している。箱を 24px にすると 1 日 30 pull がスマホで 4 行になり、
 * 「1 行で俯瞰」という狙いが消える。**大きさと間隔は対で変えること。**
 */
"use client";

import {
  floorLabel,
  formatFightDuration,
  formatPercentage,
  pullProgress,
  type FightRow,
  type FloorMap,
} from "@/lib/fflogs-progress";
import { PERF_CHIP, perfForProgress } from "@/lib/perf-tone";
import { useLocale, useMessages } from "@/lib/i18n/client";

export function PullBoxRow({
  fights,
  floors,
  segmentCount,
  showPhase,
  onPick,
}: {
  /** その日の pull (時刻順)。 */
  fights: FightRow[];
  floors: FloorMap;
  /** 区間の総数 (層数 / フェーズ数)。null なら描かない。 */
  segmentCount: number | null;
  showPhase: boolean;
  /** 箱を押したときに開く pull。 */
  onPick: (reportCode: string, fightId: number) => void;
}) {
  const m = useMessages();
  const locale = useLocale();
  // 区間モデルが無いコンテンツでは略号を書けないので出さない (docstring)。
  if (segmentCount === null || fights.length === 0) return null;

  return (
    <ul
      className="flex flex-wrap gap-1 px-3 pb-2"
      aria-label={m.logs.pullBoxAria}
    >
      {fights.map((f, i) => {
        const progress = pullProgress(f, floors, segmentCount);
        const tone = PERF_CHIP[perfForProgress(progress)];
        const floorIndex =
          floors && f.encounterId !== null
            ? (floors.byEncounter.get(f.encounterId) ?? null)
            : null;
        const segmentLabel = floors
          ? floorIndex !== null
            ? String(floors.displayFloorByIndex.get(floorIndex) ?? floorIndex)
            : "?"
          : f.lastPhase !== null
            ? String(f.lastPhase)
            : "?";
        const segmentFull = floors
          ? floorIndex !== null
            ? floorLabel(floors, floorIndex, locale)
            : m.logs.pullBoxUnknownSegment
          : f.lastPhase !== null
            ? `P${f.lastPhase}`
            : m.logs.pullBoxUnknownSegment;
        // hover / 読み上げ: 何本目 / 時刻 / 区間 / 結果 / 戦闘時間 / 死亡数。
        const clock = new Date(f.startMs).toLocaleTimeString("ja-JP", {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "Asia/Tokyo",
        });
        const title = m.logs.pullBoxTitle({
          index: i + 1,
          clock,
          segment: segmentFull,
          result: f.kill
            ? m.logs.kill
            : m.logs.hpLeftCompact(formatPercentage(f.fightPercentage)),
          duration: formatFightDuration(
            Math.max(0, Math.round((f.endMs - f.startMs) / 1000)),
          ),
          deaths: f.deaths,
        });
        return (
          <li key={`${f.reportCode}-${f.fightId}`}>
            <button
              type="button"
              onClick={() => onPick(f.reportCode, f.fightId)}
              title={title}
              aria-label={title}
              className={
                // 20px 角 + gap-1 (4px) で 24px ピッチ (docstring の 2.5.8)。
                "grid h-5 w-5 place-items-center rounded-sm border font-mono text-[11px] leading-none tabular-nums transition-transform hover:scale-110 " +
                tone +
                // 討伐は枠を強調して列の中で目を引かせる (色は上のスケール
                // のまま = best)。
                (f.kill ? " ring-1 ring-emerald-300/70" : "")
              }
            >
              {f.kill ? "✓" : segmentLabel}
            </button>
          </li>
        );
      })}
      {/* 略号が「層番号 / フェーズ番号」のどちらかは日ごとに変わらないので、
          列の末尾に 1 つだけ凡例を出す (箱ごとに書くと列が伸びる)。 */}
      <li className="self-center pl-1 font-mono text-[11px] text-muted-foreground/70">
        {showPhase ? m.logs.pullBoxLegendPhase : m.logs.pullBoxLegendFloor}
      </li>
    </ul>
  );
}
