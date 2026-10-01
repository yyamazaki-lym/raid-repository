"use client";

import { useMessages } from "@/lib/i18n/client";

/**
 * 祝日の目印 (2026-10-01 監査 U-17)。
 *
 * これまで祝日は文字色 (rose) と `title=` (hover) だけで示していたので、
 * タッチ端末や色の区別がつきにくい人には「なぜこの日だけ赤いのか」が
 * 分からなかった。小さな「祝」を見える形で添え、読み上げには祝日名を渡す
 * (名前は長いので画面には出さず、hover の `title=` は従来どおり残す)。
 */
export function HolidayMark({ name }: { name: string | null }) {
  const m = useMessages();
  return (
    <span
      className="ml-1 inline-flex items-center rounded-sm border border-rose-300/40 px-0.5 align-middle text-[11px] leading-none font-normal text-rose-300"
      title={name ?? undefined}
    >
      <span aria-hidden>{m.pastSimple.holidayMark}</span>
      <span className="sr-only">{name ?? m.pastSimple.holidayFallback}</span>
    </span>
  );
}
