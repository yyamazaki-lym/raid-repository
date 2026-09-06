"use client";

import { LayoutList, Table2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCollapsible } from "@/lib/use-collapsible";
import { useMessages } from "@/lib/i18n/client";

/**
 * 軽減表 / ロットタブの「シート (iframe) ⇄ カード」表示切替 (TODO #94)。
 *
 * カード表示は元々スマホ幅専用 (`md:hidden`) で、PC からは存在自体が
 * 確認できなかった (2026-08-28 ユーザー報告「カード表示は正直分からない」)。
 * PC にも切替ボタンを置き、同じカードをそのまま確認・利用できるようにする。
 *
 * - モバイル (md 未満): 既定はカード。ボタンでシート (iframe) に切替できる
 *   (タイムライン型などカード化に向かない作りのシートの逃げ道 —
 *   2026-08-28 実機報告)。選択は localStorage に永続
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
  const m = useMessages();
  const [cardMode, setCardMode] = useCollapsible(storageKey, false);
  // モバイル側は既定が逆 (カード) なので別フラグ = 「シート表示に切替済み」。
  const [spSheet, setSpSheet] = useCollapsible(`${storageKey}:sp-sheet`, false);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-end px-3 md:hidden">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setSpSheet(!spSheet)}
          className="gap-1.5 text-[11px] tracking-normal"
          aria-pressed={spSheet}
        >
          {spSheet ? (
            <>
              <LayoutList className="h-3.5 w-3.5" aria-hidden />
              {m.sheet.backToCards}
            </>
          ) : (
            <>
              <Table2 className="h-3.5 w-3.5" aria-hidden />
              {m.sheet.viewAsSheet}
            </>
          )}
        </Button>
      </div>
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
              {m.sheet.backToSheet}
            </>
          ) : (
            <>
              <LayoutList className="h-3.5 w-3.5" aria-hidden />
              {m.sheet.viewAsCards}
            </>
          )}
        </Button>
      </div>
      {/* モバイル: spSheet が OFF のときカード / PC: cardMode が ON のときカード。 */}
      <div
        className={
          (spSheet ? "hidden" : "block") +
          " px-3 " +
          (cardMode ? "md:block md:px-0" : "md:hidden")
        }
      >
        {cards}
      </div>
      <div
        className={
          (spSheet ? "block" : "hidden") +
          " " +
          (cardMode ? "md:hidden" : "md:block")
        }
      >
        {iframe}
      </div>
    </div>
  );
}
