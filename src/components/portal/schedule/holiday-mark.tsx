"use client";

import { useMessages } from "@/lib/i18n/client";

/**
 * 祝日の目印 (2026-10-01 監査 U-17)。
 *
 * これまで祝日は文字色 (rose) と `title=` (hover) だけで示していたので、
 * タッチ端末や色の区別がつきにくい人には「なぜこの日だけ赤いのか」が
 * 分からなかった。小さな「祝」を見える形で添え、読み上げには祝日名を渡す
 * (名前は長いので画面には出さず、hover の `title=` は従来どおり残す)。
 *
 * `placeholder` (2026-10-06): 祝日でない行に、同じ幅の見えない枠だけを置く。
 * 印が日付の幅を広げるぶん、祝日の行だけ時刻と人数のチップが右へずれて
 * いた (実機報告「祝日だと 8/8 などの参加者人数がずれる」)。表に祝日が
 * 1 日でもあれば、他の行もこの枠で同じ幅にそろえる。読み上げには何も渡さない。
 */
export function HolidayMark({
  name,
  placeholder = false,
}: {
  name: string | null;
  placeholder?: boolean;
}) {
  const m = useMessages();
  if (placeholder) {
    return (
      <span
        aria-hidden
        data-holiday-placeholder
        className="invisible ml-1 inline-flex items-center rounded-sm border px-0.5 align-middle text-[11px] leading-none font-normal"
      >
        {m.pastSimple.holidayMark}
      </span>
    );
  }
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
