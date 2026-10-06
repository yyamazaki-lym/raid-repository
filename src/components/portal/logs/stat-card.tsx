/**
 * 練習ログ: 上部サマリのタイル (StatCard) と総 pull の内訳チップ
 * (PullBreakdownChips)。
 *
 * 2026-09-07 に `logs-view.tsx` から切り出した (#20)。分割の経緯と依存の
 * 向きは `./README.md` を参照。内訳チップは
 * StatCard の `sub` に入る前提の小さな部品なので同じファイルに置く。
 */
"use client";

import { type ReactNode } from "react";
import {
  type PullBreakdownItem,
  floorTextToneClass,
  phaseTextToneClass,
} from "@/lib/fflogs-progress";
import { useMessages } from "@/lib/i18n/client";

export function StatCard({
  label,
  value,
  sub,
  detail,
  highlight,
  title,
}: {
  label: string;
  value: string;
  sub?: string;
  /** value / sub の下に出す補足 (内訳チップなど)。 */
  detail?: ReactNode;
  highlight?: boolean;
  /** タイルの hover (値の定義の説明など。2026-10-06)。 */
  title?: string;
}) {
  return (
    <li
      title={title}
      className={
        "flex flex-col gap-0.5 rounded-md border px-3 py-2 " +
        (highlight
          ? "border-emerald-400/40 bg-emerald-400/5"
          : "border-border/40 bg-secondary/15")
      }
    >
      <span className="font-mono text-[11px] tracking-[0.14em] text-muted-foreground uppercase">
        {label}
      </span>
      {/* 2026-08-30: PC では一回り大きく (実機報告「PC から見ると小さい」)。 */}
      <span className="font-display text-lg tabular-nums sm:text-xl">{value}</span>
      {/* 2026-10-06: 切らずに折り返す。375px 幅でタイルの内側は 130px しか
          なく、「ログ合計 128:45:01 (表示中の分)」のように長い値が末尾で
          「…」に切れて、時間や注記が読めなくなるため。 */}
      {sub && (
        <span className="text-[11px] leading-snug break-words text-muted-foreground">
          {sub}
        </span>
      )}
      {detail}
    </li>
  );
}

/**
 * 総 pull タイルの内訳チップ (2026-09-03)。層は識別色 (FLOOR_TEXT_TONE /
 * 後半は fuchsia)、フェーズは foreground、討伐は emerald。枝葉が増えても
 * タイルの幅を壊さないよう、枠線なしの 10px mono を折り返して並べる。
 */
export function PullBreakdownChips({
  items,
  truncated,
}: {
  items: PullBreakdownItem[];
  truncated: boolean;
}) {
  const m = useMessages();
  const tone = (b: PullBreakdownItem): string => {
    switch (b.kind) {
      case "floor":
        return b.half === "second"
          ? "text-fuchsia-200"
          : floorTextToneClass(b.displayFloor);
      case "phase":
        // 2026-09-03: フェーズも識別色を持たせたので内訳チップも揃える
        // (総 pull の内訳 / 日の見出し / pull 行 / 到達度の右ラベルで同色)。
        return phaseTextToneClass(b.phase);
      case "clear":
        return "text-emerald-300";
      default:
        return "text-muted-foreground";
    }
  };
  return (
    <ul
      className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5"
      aria-label={m.logs.breakdownAria}
      title={truncated ? m.logs.breakdownTitleTruncated : m.logs.breakdownTitle}
    >
      {items.map((b) => (
        <li
          key={b.label}
          className="inline-flex items-baseline gap-1 whitespace-nowrap font-mono text-[12px] tabular-nums"
        >
          <span className={tone(b)}>{b.label}</span>
          <span className="text-muted-foreground">{b.count}</span>
        </li>
      ))}
    </ul>
  );
}
