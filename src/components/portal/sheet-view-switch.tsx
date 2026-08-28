"use client";

import { LayoutList, Table2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCollapsible } from "@/lib/use-collapsible";

/**
 * 軽減表 / ロットタブの「シート (iframe) ⇄ カード」表示切替 (TODO #94)。
 *
 * カード表示は元々スマホ幅専用 (`md:hidden`) で、PC からは存在自体が
 * 確認できなかった (2026-08-28 ユーザー報告「カード表示は正直分からない」)。
 * PC にも切替ボタンを置き、同じカードをそのまま確認・利用できるようにする。
 *
 * - モバイル (md 未満): 常にカード。ボタンは出さない (従来どおり)
 * - PC (md 以上): 既定はシート。ボタンでカードに切替、選択は localStorage に
 *   永続 (`use-collapsible` を「カード表示フラグ」として流用)
 */
export function SheetViewSwitch({
  storageKey,
  cards,
  iframe,
}: {
  storageKey: string;
  cards: React.ReactNode;
  iframe: React.ReactNode;
}) {
  const [cardMode, setCardMode] = useCollapsible(storageKey, false);

  return (
    <div className="flex flex-col gap-2">
      <div className="hidden justify-end px-1 md:flex">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setCardMode(!cardMode)}
          className="gap-1.5 text-[11px] tracking-normal"
          aria-pressed={cardMode}
        >
          {cardMode ? (
            <>
              <Table2 className="h-3.5 w-3.5" aria-hidden />
              シート表示に戻す
            </>
          ) : (
            <>
              <LayoutList className="h-3.5 w-3.5" aria-hidden />
              カード表示で見る
            </>
          )}
        </Button>
      </div>
      {/* モバイルは常時カード、PC はトグルが ON のときだけカード。 */}
      <div className={cardMode ? "px-3 md:px-0" : "px-3 md:hidden"}>{cards}</div>
      <div className={cardMode ? "hidden" : "hidden md:block"}>{iframe}</div>
    </div>
  );
}
