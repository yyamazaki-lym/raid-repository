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
 *
 * ## 2026-09-08 の実機報告 3 点 (L-5)
 *
 *   1. **色が強すぎた。** `PERF_CHIP` をそのまま使っていたが、チップ 1 個の
 *      彩度が適切でも 30 個並ぶと総量が違う。箱専用の `PERF_BOX` に替えた
 *      (`perf-tone.ts` 参照)。
 *   2. **`✓` が中央より下に出た。** 原因は実測で確定した (2026-09-08):
 *      **U+2713 は JetBrains Mono に無く、OS のフォールバックフォントが
 *      描いていた**。同フォントの advance を測ると数字 / 英字は 60 単位で
 *      揃うのに `✓` だけ 68.3 単位 = 等幅の枠に収まっておらず、別フォント
 *      由来だと分かる (`document.fonts.check` は family がロード済みなら
 *      true を返すので判定に使えない)。
 *
 *      フォールバック先は OS ごとに違う (Windows なら Segoe UI Symbol 系)
 *      ため、**縦位置が閲覧環境ごとに変わる**。Chromium での実測では箱の
 *      中心から 0.13px 上 (数字は 0.06px 上) で目視できない差だったが、
 *      報告環境では下にずれて見えていた。`place-items-center` では直らない
 *      — グリッドが中央に置くのは字形ではなく行ボックスで、その中の字形の
 *      位置はフォントの ascent/descent が決める。
 *
 *      そこで **SVG のチェックに差し替えた**。実測で箱の中心との差が
 *      0.00px になり、**環境によって変わる余地が無くなる**。
 *      ⚠ 文字の `✓` に戻すと、この「環境依存」がそのまま戻る。
 *   3. **飛んだ先が分からなかった。** 30 行の中へスクロールしても、どれに
 *      来たのかが見えない。押した pull を短くハイライトする
 *      (`day-row.tsx` → `pull-row.tsx` の `flashNonce`)。
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
import { PERF_BOX, perfForProgress } from "@/lib/perf-tone";
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
        const tone = PERF_BOX[perfForProgress(progress)];
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
              {f.kill ? (
                // 討伐は SVG のチェック。文字の `✓` (U+2713) は JetBrains Mono
                // に無く OS のフォールバックが描くため、縦位置が閲覧環境ごとに
                // 変わる (2026-09-08 実機報告 + 実測。docstring 参照)。
                // SVG なら箱の中心に対して対称に置けるので、どの環境でも
                // **数字の箱と縦が揃う**。
                <svg
                  viewBox="0 0 12 12"
                  className="h-3 w-3"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M2.5 6.5 5 9l4.5-5.5" />
                </svg>
              ) : (
                segmentLabel
              )}
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
