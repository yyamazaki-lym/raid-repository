"use client";

import { useMessages } from "@/lib/i18n/client";

/**
 * 有志練習 (任意参加) バッジ (W-18、2026-09-08)。
 *
 * 調査ノート第 4 回 7-B W-18 のデメリット欄は **「本活動との区別を UI で
 * 強く出さないとコミットが薄まる」**。フラグを立てた日は自動確定・催促・
 * 出席集計から外れるので、**外れていることが行を見て分かる**必要がある。
 *
 * `FrameDeviationBadge` (琥珀 = いつもと違う) とは別の色にしている —
 * 「いつもと違う日」ではなく「そもそも全員で行く日ではない」ことを示すため。
 * 文字も併記するので色だけに頼っていない (`globals.css` の色の方針)。
 *
 * admin / 非 admin の両方に出す。切替の入口 (時刻編集 popover の
 * チェックボックス) は admin だけだが、**任意参加であることは全員が
 * 知る必要がある情報**なので表示は絞らない。
 */
export function OptionalSessionBadge({ optional }: { optional: boolean }) {
  const m = useMessages();
  if (!optional) return null;
  return (
    <span
      aria-label={m.optionalBadge.title}
      title={m.optionalBadge.title}
      className="inline-flex items-center rounded-sm border border-[var(--neon-violet)]/45 bg-[var(--neon-violet)]/10 px-1 py-[0.5px] font-mono text-[11px] leading-none tracking-normal text-[var(--neon-violet)]"
    >
      {m.optionalBadge.label}
    </span>
  );
}
