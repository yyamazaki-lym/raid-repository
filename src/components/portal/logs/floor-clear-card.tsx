/**
 * 練習ログ: 各層の初討伐カード (L-1、2026-09-08 実機要望)。零式 (層モデル)
 * でのみ表示する。
 *
 * 絶には「各フェーズへの初到達」(`phase-time-card.tsx`) があるのに、零式には
 * 層ごとの節目が無かった。チーム実績バッジ (`team-badges-card.tsx`) の
 * 「初討伐」もティア全体で 1 つだけで、「3 層をいつ抜けたか」が残らない。
 * 層フィルタがあるのだから層ごとに出す、というのがこのカード。
 *
 * 見せ方は絶の「初到達まで」に揃える — 識別色のラベル + 所要時間 + pull 数を
 * 1 行に並べ、日時は hover。置き場所も絶と同じ 2 カラムの右側 (絶では
 * `PhaseTimeCard` が占める枠)。値の意味は `floorFirstClears`
 * (`@/lib/fflogs-session`) の docstring を参照。
 *
 * ## pull 数は「その層 + 通算」の併記 (2026-09-08 の判断)
 *
 * 零式は**層を行き来する** (4 層で詰まっている間に 1〜3 層を消化で回す) ので、
 * 前に出すのは**その層の pull 数**。ティア開始からの通算は絶との一貫性のため
 * 後ろに小さく添える。
 *
 * 併記で幅が破綻しないかは Chromium で実測した (JetBrains Mono 400 / 12px +
 * CJK フォールバック、`gap-x-1`):
 *
 *   | 項目                                    | 幅      |
 *   |-----------------------------------------|---------|
 *   | 4層後半 1:23:45 246 pull 通算 519        | 216 px  |
 *   | F4b 1:23:45 246 pulls total 519 (en)    | 214 px  |
 *   | 通算を落とした場合                        | 159 px  |
 *   | 絶の P3 2:54:43 (78 pull) / P7 の最長     | 138 / 159 px |
 *
 * カード内幅も同じ条件で測った (`max-w-5xl` + `px-4`/`sm:px-6`、2 カラムの
 * `gap-2`、カードの `px-3`): **320px 端末 262px / 640px 266px (2 カラムの
 * 切り替わりが最も狭い) / 1024px 以上 458px**。216px はどれにも収まるので
 * **併記のまま**にした (実機の第 1 希望)。1 行に並ぶ数も 640px で 1 個 /
 * 1024px で 2 個と、絶の「初到達まで」(同じ幅で 1 個 / 3 個) とほぼ同じ密度。
 *
 * ⚠ 最も狭い 640px での余裕は 50px しかない。**値を 1 つ増やすなら通算を
 * hover へ退避すること** (`floorClearHover` が既に日時と一緒に出している)。幅を稼ぐために
 * 文字を小さくするのは不可 — `text-[11px]` が `scripts/check-font-sizes.mjs`
 * の下限そのもの。保険として項目自体を `flex-wrap` にしてあり、想定より
 * 狭い端末や 4 桁の pull 数では「通算 N」だけが次行へ落ちる。
 *
 * ## 出さないもの
 *
 * - **未討伐の層**: 「まだ倒していない」以上の情報が無く、層フィルタの
 *   チップで足りる (`floorFirstClears` が返さない)。
 * - **明細が打ち切られている (`truncated`) とき**: 明細は新しい順に切られる
 *   ので、古い pull が落ちると初討伐も pull 数も過小になる。サマリータイルの
 *   「初クリア」を truncated で出さないのと同じ理由 (誤情報を作らない)。
 *   判断は呼び出し側。
 */
"use client";

import { formatMs } from "@/lib/fflogs-fight-detail";
import { floorTextToneClass } from "@/lib/fflogs-progress";
import type { FloorFirstClear } from "@/lib/fflogs-session";
import { useMessages } from "@/lib/i18n/client";
import { jstYmdString } from "@/lib/jst-date";

export type FloorClearItem = FloorFirstClear & {
  /** 表示ラベル (例: "3層" / "4層後半")。`floorLabel` で引いたもの。 */
  label: string;
  /** 表示上の層番号 (前半 / 後半とも 4)。識別色に使う。 */
  displayFloor: number;
  /** 最終層の前半 / 後半 (分割の無い層は null)。 */
  half: "first" | "second" | null;
};

export function FloorClearCard({ clears }: { clears: FloorClearItem[] }) {
  const m = useMessages();
  if (clears.length === 0) return null;
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border/40 bg-secondary/15 px-3 py-2">
      <span
        className="font-mono text-[11px] tracking-[0.14em] text-muted-foreground uppercase"
        title={m.logs.floorClearHint}
      >
        {m.logs.floorClearTitle}
      </span>
      <ul
        className="flex flex-wrap gap-x-3 gap-y-0.5"
        aria-label={m.logs.floorClearAria}
      >
        {clears.map((c) => (
          <li
            key={c.index}
            // flex-wrap: 想定より狭い端末で「通算 N」だけが折り返せるように
            // する (項目ごと横へ溢れさせない)。個々の断片は nowrap。
            className="inline-flex flex-wrap items-baseline gap-x-1 font-mono text-[12px] tabular-nums"
            title={m.logs.floorClearHover(
              // 日付は `session_date` (日ごとの行と同じキー) を優先する。
              // 深夜まで続いたセッションでは startMs の JST 暦日が翌日に
              // なるため、ここで壁時計から作ると日の行と食い違う。
              // 時刻は `pull-row.tsx` と同じく JST 固定 (閲覧者の TZ に
              // 依存させると日付と時刻がずれて見える)。
              c.date ?? jstYmdString(new Date(c.startMs)),
              new Date(c.startMs).toLocaleTimeString("ja-JP", {
                hour: "2-digit",
                minute: "2-digit",
                timeZone: "Asia/Tokyo",
              }),
              c.overallPulls,
            )}
          >
            {/* 層の識別色。4 層前半 / 後半は色相を分ける (`stat-card.tsx` の
                内訳チップと同じ扱い — floorTextToneClass は表示層番号しか
                見ないので後半だけ呼び出し側で fuchsia に振る)。 */}
            <span
              className={
                "whitespace-nowrap " +
                (c.half === "second"
                  ? "text-fuchsia-200"
                  : floorTextToneClass(c.displayFloor))
              }
            >
              {c.label}
            </span>
            <span className="whitespace-nowrap text-foreground/80">
              {formatMs(c.ms)}
            </span>
            <span className="whitespace-nowrap text-muted-foreground/80">
              {m.logs.pulls(c.pulls)}
            </span>
            <span className="whitespace-nowrap text-muted-foreground/60">
              {m.logs.floorClearOverall(c.overallPulls)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
