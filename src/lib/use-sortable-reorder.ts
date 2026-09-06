"use client";

import { useCallback, useState } from "react";
import { useMessages } from "@/lib/i18n/client";
import {
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { toast } from "sonner";

export type ReorderResult = { ok: boolean; reason?: string };

/**
 * `list` を楽観順 `order` に並べ替えた配列を返す。`order` に無い id は末尾。
 * 各リスト component に散らばっていた idx-map ソートを共通化 (C-4)。
 */
export function applyOptimisticOrder<T extends { id: string }>(
  list: T[],
  order: string[] | null,
): T[] {
  if (!order) return list;
  const idx = new Map(order.map((id, i) => [id, i] as const));
  return [...list].sort((a, b) => {
    const ai = idx.get(a.id);
    const bi = idx.get(b.id);
    if (ai === undefined && bi === undefined) return 0;
    if (ai === undefined) return 1;
    if (bi === undefined) return -1;
    return ai - bi;
  });
}

/**
 * DnD 並び替えの共通フック (総合レビュー C-1 / C-4)。
 *
 * - sensors (Mouse 距離 6 / Touch 長押し 200ms / Keyboard) を共通化。
 * - 楽観順 state を保持し、`commit` が「楽観反映 → 永続化 → 失敗時ロールバック」
 *   を担う。
 * - **C-1 修正**: 旧実装の `setTimeout(1500)` で無条件に楽観 state を捨てる方式
 *   (Realtime UPDATE が間に合わないと古い順へちらつき巻戻り、cleanup も無し) を
 *   廃止。代わりに `syncOnSettle` で「DB 確定順が楽観順に追いついたら畳む」値
 *   マッチ方式 (schedule-list.tsx の override 値マッチと同じ意味論) に統一する。
 *
 * 並べ替えの index 計算やグループ化はリスト側で異なるため、高レベルの
 * `handleDragEnd` (単純な 1 リスト用) と低レベルの `commit` (filtered↔global
 * マッピングやグループ並び替え用) の両方を公開する。
 */
export function useSortableReorder(opts: {
  persist: (orderedIds: string[]) => Promise<ReorderResult>;
  /** 失敗 toast の接頭辞。 */
  errorMessage?: string;
}) {
  const m = useMessages();
  const { persist, errorMessage = m.common.reorderFailed } = opts;
  const [optimisticOrder, setOptimisticOrder] = useState<string[] | null>(null);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 6 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  // 楽観順を反映 → 永続化。失敗時はロールバック + toast。成功時は即時
  // クリアせず値マッチ (`syncOnSettle`) に畳ませる (C-1)。
  const commit = useCallback(
    async (
      displayIds: string[],
      persistIds: string[] = displayIds,
    ): Promise<ReorderResult> => {
      setOptimisticOrder(displayIds);
      const result = await persist(persistIds);
      if (!result.ok) {
        toast.error(`${errorMessage}: ${result.reason ?? ""}`);
        setOptimisticOrder(null);
      }
      return result;
    },
    [persist, errorMessage],
  );

  // 単純 1 リスト用: 表示中リストの index を arrayMove して commit。
  // `toPersistIds` で表示順 → 永続順の変換 (例: DB が ASC で表示が DESC の
  // 動画リストは reverse) を吸収する。並べ替えなし (over 無し / 同一) なら no-op。
  const handleDragEnd = useCallback(
    async (
      event: DragEndEvent,
      displayed: ReadonlyArray<{ id: string }>,
      toPersistIds: (ids: string[]) => string[] = (ids) => ids,
    ): Promise<ReorderResult | undefined> => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const oldIndex = displayed.findIndex((d) => d.id === active.id);
      const newIndex = displayed.findIndex((d) => d.id === over.id);
      if (oldIndex < 0 || newIndex < 0) return;
      const next = arrayMove([...displayed], oldIndex, newIndex).map(
        (d) => d.id,
      );
      return commit(next, toPersistIds(next));
    },
    [commit],
  );

  // 値マッチ: DB 確定の表示順 (`confirmedOrder`) と楽観順で、双方に存在する
  // id の相対順序が一致したら楽観 state を畳んで Realtime 値に追従する。
  // 追いつくまでは保持してちらつき (古い順への巻戻り) を防ぐ。並行 add/delete
  // があっても交差集合で比較するので安定して畳める。Realtime 更新の度に呼ぶ。
  const syncOnSettle = useCallback((confirmedOrder: string[]) => {
    setOptimisticOrder((curr) => {
      if (!curr) return null;
      const confirmedSet = new Set(confirmedOrder);
      const optimisticSet = new Set(curr);
      const inConfirmed = confirmedOrder.filter((id) => optimisticSet.has(id));
      const inOptimistic = curr.filter((id) => confirmedSet.has(id));
      const matched =
        inConfirmed.length === inOptimistic.length &&
        inConfirmed.every((id, i) => id === inOptimistic[i]);
      return matched ? null : curr;
    });
  }, []);

  return {
    optimisticOrder,
    sensors,
    commit,
    handleDragEnd,
    syncOnSettle,
  };
}
