/**
 * 練習ログ: チーム実績バッジ (W-31、2026-09-07)。
 *
 * **チームの実績だけ**を出す — 個人 DPS / 出席率のランキングは作らない
 * という方針と整合させるため。種類は 4 つに絞ってある (乱発すると陳腐化
 * して誰も見なくなる、というのが調査ノートのデメリット欄の指摘)。
 *
 * 討伐が 1 つも無いカテゴリでは何も出さない (練習中に空のカードが出ると
 * 「まだ何も無い」ことだけを主張する枠になってしまう)。
 *
 * 分割の経緯と依存の向きは `./README.md` を参照。
 */
"use client";

import { Award } from "lucide-react";
import {
  teamBadgeToneClass,
  type TeamBadge,
} from "@/lib/fflogs-session";
import { formatFightDuration } from "@/lib/fflogs-progress";
import { useMessages } from "@/lib/i18n/client";

export function TeamBadgesCard({ badges }: { badges: TeamBadge[] }) {
  const m = useMessages();
  if (badges.length === 0) return null;

  return (
    <section className="flex flex-col gap-1.5 rounded-md border border-border/40 bg-secondary/10 px-3 py-2">
      <h3 className="inline-flex items-center gap-1.5 font-mono text-[10px] tracking-[0.16em] text-muted-foreground uppercase">
        <Award className="h-3 w-3 text-amber-300" aria-hidden />
        {m.teamBadges.title}
      </h3>
      <ul className="flex flex-wrap items-center gap-1.5">
        {badges.map((b) => (
          <li
            key={b.kind}
            className={
              "inline-flex items-center gap-1.5 rounded-sm border px-2 py-1 font-mono text-[11px] whitespace-nowrap tabular-nums " +
              teamBadgeToneClass(b.kind)
            }
            title={m.teamBadges.hint(b.kind)}
          >
            <span>{m.teamBadges.label(b.kind)}</span>
            {b.kind === "fastestClear" && b.value !== null && (
              <span className="opacity-80">{formatFightDuration(b.value)}</span>
            )}
            {b.kind === "clears" && b.value !== null && (
              <span className="opacity-80">{m.teamBadges.times(b.value)}</span>
            )}
            {b.date && (
              <span className="text-[10px] opacity-60">{b.date}</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
