/**
 * 練習ログ: フェーズ滞在時間 + 各フェーズへの初到達カード
 * (2026-09-06 W-2 / 初到達は 2026-09-07)。絶でのみ表示する。
 *
 * 2026-09-07 に `logs-view.tsx` から切り出した (#20)。分割の経緯と依存の
 * 向きは `./README.md` を参照。
 */
"use client";

import { type PhaseFirstReach, formatMs } from "@/lib/fflogs-fight-detail";
import { phaseBarToneClass, phaseTextToneClass } from "@/lib/fflogs-progress";
import { useMessages } from "@/lib/i18n/client";

/**
 * フェーズ滞在時間カード (2026-09-06 W-2、絶のみ)。取得済み pull の各
 * フェーズ滞在時間を合計し、積み上げバー + 凡例で出す。「P3 に時間の
 * 何割を使っているか」がそのまま練習の重心になる。
 */
export function PhaseTimeCard({
  totals,
  firstReach,
  truncated,
  allPulls,
  totalPulls,
}: {
  totals: Array<{ id: number; ms: number; share: number }>;
  /** 各フェーズへの初到達 (2026-09-07)。空なら節ごと出さない。 */
  firstReach: PhaseFirstReach[];
  truncated: boolean;
  /** 全件集計のときの母数 (pull 数)。null なら表示中の明細からの集計。 */
  allPulls: number | null;
  /** カテゴリの全 pull 数。母数がこれより少ないときに「情報あり N / 全 M」と出す。 */
  totalPulls: number;
}) {
  const m = useMessages();
  const totalMs = totals.reduce((acc, t) => acc + t.ms, 0);
  // 2026-09-07: フェーズ遷移は 2026-09-06 以降に取得した pull にしか無く、
  // 古い pull は同期の取り直し (1 回 40 レポート) で順に埋まる。母数が全 pull
  // より少ない間は、それが分かる表記にする (実機: 「P7 が 12 分は短すぎる」)。
  const partial = allPulls !== null && allPulls < totalPulls;
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border/40 bg-secondary/15 px-3 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase">
          {m.logs.phaseTimeTitle}
        </span>
        <span
          className="font-mono text-[9px] tracking-[0.12em] text-muted-foreground/70"
          title={partial ? m.logs.phaseTimePartialTitle : undefined}
        >
          {m.logs.phaseTimeTotal(formatMs(totalMs))}
          {allPulls !== null
            ? partial
              ? m.logs.phaseTimePartial(allPulls, totalPulls)
              : m.logs.phaseTimeAll(allPulls)
            : truncated
              ? m.logs.shownOnly
              : ""}
        </span>
      </div>
      <div
        className="flex h-2 w-full overflow-hidden rounded-sm bg-secondary/50"
        role="img"
        aria-label={totals
          .map((t) => `P${t.id} ${Math.round(t.share * 100)}%`)
          .join(" / ")}
      >
        {totals.map((t) => (
          <span
            key={t.id}
            className={phaseBarToneClass(t.id)}
            style={{ width: `${t.share * 100}%` }}
            title={`P${t.id}: ${formatMs(t.ms)} (${Math.round(t.share * 100)}%)`}
          />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-2 gap-y-0.5" aria-label={m.logs.phaseTimeAria}>
        {totals.map((t) => (
          <li
            key={t.id}
            className="inline-flex items-baseline gap-1 whitespace-nowrap font-mono text-[10px] tabular-nums"
          >
            <span className={phaseTextToneClass(t.id)}>
              P{t.id}
            </span>
            <span className="text-foreground/80">{Math.round(t.share * 100)}%</span>
            <span className="text-muted-foreground">{formatMs(t.ms)}</span>
          </li>
        ))}
      </ul>
      {/* 2026-09-07 実機要望: 各フェーズに初めて到達するまでの累計戦闘時間。
          滞在時間 (どこで時間を使ったか) の下に、進捗の節目を並べる。 */}
      {firstReach.length > 0 && (
        <div className="mt-1 flex flex-col gap-0.5 border-t border-border/30 pt-1">
          <span
            className="font-mono text-[9px] tracking-[0.12em] text-muted-foreground/70 uppercase"
            title={m.logs.phaseFirstReachHint}
          >
            {m.logs.phaseFirstReachTitle}
          </span>
          <ul
            className="flex flex-wrap gap-x-2 gap-y-0.5"
            aria-label={m.logs.phaseFirstReachAria}
          >
            {firstReach.map((r) => (
              <li
                key={r.id}
                className="inline-flex items-baseline gap-1 whitespace-nowrap font-mono text-[10px] tabular-nums"
                title={r.date ?? undefined}
              >
                <span className={phaseTextToneClass(r.id)}>
                  P{r.id}
                </span>
                <span className="text-foreground/80">{formatMs(r.ms)}</span>
                <span className="text-muted-foreground/80">
                  ({m.logs.pulls(r.pulls)})
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
