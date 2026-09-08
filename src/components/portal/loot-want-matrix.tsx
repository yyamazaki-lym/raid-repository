"use client";

import { Dice5 } from "lucide-react";
import {
  buildLootWantMatrix,
  lootCellKind,
  type LootMemberInput,
} from "@/lib/loot-priority";
import { bisSlotLabel } from "@/lib/bis-slots";
import { useLocale, useMessages } from "@/lib/i18n/client";

/**
 * ロットの「欲しい人」行列 (W-24 + W-25、2026-09-08)。
 *
 * アイテムが落ちた瞬間に知りたいのは **「この部位を欲しいのは誰か」** で、
 * そこに「取得済が少ない人が先」という 1 つの規則で順番を添える。
 *
 * ## 提案止まり
 *
 * ⚠ **確定するボタンは作らない。** ノートのデメリット欄が「ルールが固定
 * ごとに多様 (左取り抜け / 優先制 / フリロ)」なので、番号は提案として
 * 出し、決めるのは人に残す。順番の理由 (取得済 n/11) をセルの hover に
 * 入れてあるので、提案を採るかどうかを人が判断できる。
 *
 * ## 層 × 部位の対応表は持たない
 *
 * どの層で何が落ちるかは固定の人が知っている。ゲーム側のデータ表を
 * 抱えると保守が続かないので、行は**部位**にする
 * (詳細は `lib/loot-priority.ts` の docstring)。
 *
 * ## 3 色セマンティクス (W-25)
 *
 *   - 緑 = 提案順 1 番目 (最良の相手)
 *   - 黄 = 欲しいが 1 番目ではない (代替あり)
 *   - 灰 = 取得済
 *   - 空 = そのジョブで数えない部位
 *
 * 色だけで意味を伝えないよう、緑と黄には**順番の数字**を、取得済には
 * チェックを入れる (`globals.css` の色の方針)。
 */
export function LootWantMatrix({ members }: { members: LootMemberInput[] }) {
  const m = useMessages();
  const locale = useLocale();
  // BiS リンクが 1 本も無い固定では何も出さない (入れる前から表が出ると
  // 「使えない機能」に見える)。
  if (members.length === 0) return null;
  const matrix = buildLootWantMatrix(members);

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border/40 bg-secondary/15 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Dice5 className="h-3 w-3 shrink-0 text-emerald-300/80" aria-hidden />
        <span className="font-mono text-[11px] tracking-[0.18em] text-muted-foreground uppercase">
          {m.lootWant.title}
        </span>
        <span className="text-[11px] text-muted-foreground/70">
          {m.lootWant.subtitle}
        </span>
      </div>

      {matrix.allDone ? (
        <span className="text-[12px] text-muted-foreground">
          {m.lootWant.allDone}
        </span>
      ) : (
        <>
          {/* 列数 = メンバー数なので、狭い端末では横スクロールさせる
              (本文 12px を維持する方を優先)。 */}
          <div className="overflow-x-auto">
            <table className="border-collapse text-[12px]">
              <thead>
                <tr className="text-left text-[11px] text-muted-foreground">
                  <th className="sticky left-0 z-10 bg-secondary/15 py-1 pr-2 font-normal">
                    {m.lootWant.colSlot}
                  </th>
                  {matrix.members.map((mem) => (
                    <th
                      key={mem.bisLinkId}
                      className="px-1 py-1 text-center font-normal"
                      title={m.lootWant.memberTitle(mem.obtained, mem.total)}
                    >
                      <span className="block max-w-[5rem] truncate">
                        {mem.label}
                      </span>
                      <span className="block font-mono text-[11px] tabular-nums opacity-70">
                        {mem.obtained}/{mem.total}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrix.rows.map((row) => (
                  <tr key={row.slot} className="border-t border-border/20">
                    <th className="sticky left-0 z-10 bg-secondary/15 py-1 pr-2 text-left font-normal whitespace-nowrap text-foreground/90">
                      {bisSlotLabel(row.slot, locale)}
                    </th>
                    {matrix.members.map((mem) => {
                      const kind = lootCellKind(row, mem.bisLinkId);
                      const w = row.wanters.find(
                        (x) => x.bisLinkId === mem.bisLinkId,
                      );
                      return (
                        <td
                          key={mem.bisLinkId}
                          className="px-1 py-1 text-center"
                          title={
                            kind === "done"
                              ? m.lootWant.cellDone
                              : kind === "n/a"
                                ? m.lootWant.cellNa
                                : m.lootWant.cellWant(
                                    w?.rank ?? 0,
                                    w?.obtained ?? 0,
                                    w?.total ?? 0,
                                  )
                          }
                        >
                          {kind === "done" ? (
                            <span className="font-mono text-[11px] text-muted-foreground/60">
                              ✓
                            </span>
                          ) : kind === "n/a" ? (
                            <span aria-hidden className="opacity-30">
                              ·
                            </span>
                          ) : (
                            <span
                              className={
                                "inline-flex h-4 w-4 items-center justify-center rounded-sm font-mono text-[11px] tabular-nums " +
                                (kind === "first"
                                  ? "bg-emerald-400/20 text-emerald-200"
                                  : "bg-amber-400/15 text-amber-200/90")
                              }
                            >
                              {w?.rank}
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] leading-snug text-muted-foreground/85">
            {m.lootWant.legend}
          </p>
        </>
      )}
    </div>
  );
}
