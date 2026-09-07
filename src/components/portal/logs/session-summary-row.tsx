/**
 * 練習ログ: セッションサマリー (W-3、2026-09-07)。
 *
 * 日を開いたときに pull 一覧の上へ 1 行で出す。「22:00 から 2 時間で何本
 * 回せたか」が固定運営の実際の議論なので、pull 数だけでなく拘束時間と
 * 戦闘外の割合、平均プル長を並べる。
 *
 * ⚠ 「戦闘外」は休憩・解説・作戦会議・リセット待ちを全部含む。「無駄な
 * 時間」ではないので、ラベルは「戦闘外」に留めて価値判断を混ぜない
 * (調査ノート第 4 回 W-3 の「文言で吸収」)。
 *
 * 分割の経緯と依存の向きは `./README.md` を参照。
 */
"use client";

import { Clock, Hourglass, Swords, Timer } from "lucide-react";
import type { SessionSummary } from "@/lib/fflogs-session";
import { formatFightDuration } from "@/lib/fflogs-progress";
import { useMessages } from "@/lib/i18n/client";

export function SessionSummaryRow({ summary }: { summary: SessionSummary }) {
  const m = useMessages();
  if (summary.pulls === 0) return null;
  const sec = (ms: number) => Math.max(0, Math.round(ms / 1000));
  const pct = Math.round(summary.downtimeRatio * 100);

  return (
    <p
      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-sm border border-border/30 bg-background/20 px-2 py-1.5 font-mono text-[11px] tabular-nums"
      title={m.sessionSummary.title}
    >
      <span className="tracking-[0.14em] text-muted-foreground uppercase">
        {m.sessionSummary.label}
      </span>
      <span className="inline-flex items-center gap-1 text-slate-300">
        <Clock className="h-2.5 w-2.5 shrink-0" aria-hidden />
        {m.sessionSummary.span(formatFightDuration(sec(summary.spanMs)))}
      </span>
      <span className="inline-flex items-center gap-1 text-indigo-300/90">
        <Swords className="h-2.5 w-2.5 shrink-0" aria-hidden />
        {m.sessionSummary.fight(formatFightDuration(sec(summary.fightMs)))}
      </span>
      <span
        className="inline-flex items-center gap-1 text-amber-200/85"
        title={m.sessionSummary.downtimeTitle}
      >
        <Hourglass className="h-2.5 w-2.5 shrink-0" aria-hidden />
        {m.sessionSummary.downtime(
          formatFightDuration(sec(summary.downtimeMs)),
          pct,
        )}
      </span>
      <span className="inline-flex items-center gap-1 text-cyan-300/85">
        <Timer className="h-2.5 w-2.5 shrink-0" aria-hidden />
        {m.sessionSummary.avgPull(formatFightDuration(sec(summary.avgPullMs)))}
      </span>
      <span className="text-muted-foreground">
        {m.sessionSummary.killWipe(summary.kills, summary.wipes)}
      </span>
    </p>
  );
}
