"use client";

import { useCallback, useSyncExternalStore } from "react";
import { ChevronRight, Dice5 } from "lucide-react";
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
 *
 * ## 畳める (L-15、2026-09-09 実機報告)
 *
 * 「欲しい人の欄は閉じられるようにしたい」。開閉は**コンテンツごとに
 * localStorage で覚える** (絶では畳んで零式では開く、が続くように)。
 *
 * ⚠ SSR では常に開いた状態を返す (`getServerSnapshot`)。閉じた状態を
 * サーバーで再現できないので、hydration の後に localStorage の値へ
 * 切り替える形にしてある (`useSyncExternalStore` の想定した使い方)。
 *
 * ⚠ **固定ごとに丸ごと消すのは admin 側の設定**
 * (`tabConfig.loot.wantMatrix`)。零式と絶で取得装備が違うため、使わない
 * コンテンツでは全員に対して出さない — こちらは「読む人が畳む」だけ。
 */

const STORAGE_PREFIX = "rr_loot_want_open:";

/** localStorage の変更を購読する (同じタブ内の変更も拾う)。 */
const listeners = new Set<() => void>();
function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}
function emit() {
  for (const cb of listeners) cb();
}
function readOpen(key: string): boolean {
  try {
    // 既定は開く (今までの見た目を変えない)。"0" のときだけ閉じる。
    return window.localStorage.getItem(STORAGE_PREFIX + key) !== "0";
  } catch {
    return true;
  }
}
function writeOpen(key: string, open: boolean) {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + key, open ? "1" : "0");
  } catch {
    // プライベートウィンドウ等では覚えられないだけ (表示は動く)。
  }
  emit();
}
export function LootWantMatrix({
  members,
  storageKey,
}: {
  members: LootMemberInput[];
  /** 開閉を覚える単位 (コンテンツの slug)。 */
  storageKey: string;
}) {
  const m = useMessages();
  const locale = useLocale();
  const open = useSyncExternalStore(
    subscribe,
    useCallback(() => readOpen(storageKey), [storageKey]),
    // SSR / hydration 中は開いた状態 (上の docstring 参照)。
    () => true,
  );
  // BiS リンクが 1 本も無い固定では何も出さない (入れる前から表が出ると
  // 「使えない機能」に見える)。
  if (members.length === 0) return null;
  const matrix = buildLootWantMatrix(members);

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border/40 bg-secondary/15 px-3 py-2.5">
      {/* L-15: 見出しごと開閉ボタンにする (押せる範囲を広く取る)。 */}
      <button
        type="button"
        onClick={() => writeOpen(storageKey, !open)}
        aria-expanded={open}
        className="flex flex-wrap items-center gap-2 text-left"
      >
        <ChevronRight
          className={
            "h-3 w-3 shrink-0 text-muted-foreground transition-transform " +
            (open ? "rotate-90" : "")
          }
          aria-hidden
        />
        <Dice5 className="h-3 w-3 shrink-0 text-emerald-300/80" aria-hidden />
        <span className="font-mono text-[11px] tracking-[0.18em] text-muted-foreground uppercase">
          {m.lootWant.title}
        </span>
        <span className="text-[11px] text-muted-foreground/70">
          {open ? m.lootWant.subtitle : m.lootWant.collapsedHint}
        </span>
      </button>

      {!open ? null : matrix.allDone ? (
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
