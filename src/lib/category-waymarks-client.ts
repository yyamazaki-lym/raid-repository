"use client";

import { createClient } from "@/lib/supabase/client";
import { useRealtimeTable } from "@/lib/use-realtime-table";
import {
  createCategoryWaymarkAction,
  updateCategoryWaymarkAction,
  deleteCategoryWaymarkAction,
  setCategoryWaymarkOrderAction,
} from "@/lib/server/category-waymarks-actions";

/**
 * Realtime hook (read) + 書き込み薄wrapper for `category_waymarks`
 * (TODO #94 / A-5)。`category-macros-client.ts` と同型。
 *
 * body に入るのは EchoPlan / Waymark Preset 系ツールが import/export する
 * markercode 文字列。portal 側は中身を解釈せず「そのまま預かって配る」だけ
 * (調査ノート §4「作図エディタの自作」= 非推奨 と同じ線引き)。
 */

/**
 * 種別 (2026-08-30 調査 C-6)。`waymark` = ウェイマーク markercode、
 * `board` = 7.4 のストラテジーボード共有コード (`[stgy:...]`)。
 * 保管 + ワンタップコピーという要件が同一なので同じテーブルで扱う。
 */
export type CategoryWaymarkKind = "waymark" | "board";

export type CategoryWaymark = {
  id: string;
  categoryId: string;
  kind: CategoryWaymarkKind;
  label: string;
  body: string;
  note: string | null;
  sortOrder: number;
};

type CategoryWaymarkRow = {
  id: string;
  category_id: string;
  kind: string | null;
  label: string;
  body: string;
  note: string | null;
  sort_order: number;
};

function rowToWaymark(row: CategoryWaymarkRow): CategoryWaymark {
  return {
    id: row.id,
    categoryId: row.category_id,
    // 旧行 (kind 追加前) は NULL を返しうるので waymark に倒す。
    kind: row.kind === "board" ? "board" : "waymark",
    label: row.label ?? "",
    body: row.body,
    note: row.note ?? null,
    sortOrder: row.sort_order,
  };
}

// schema 側 CHECK (category_waymarks_text_sane) と同じ上限。
const WAYMARK_BODY_MAX = 8000;
const WAYMARK_LABEL_MAX = 200;
const WAYMARK_NOTE_MAX = 500;

function validateWaymarkText(
  label: string | undefined,
  body: string | undefined,
  note: string | null | undefined,
): string | null {
  if (body !== undefined && body.length > WAYMARK_BODY_MAX)
    return `本文が長すぎます（最大 ${WAYMARK_BODY_MAX} 文字）`;
  if (label !== undefined && label.length > WAYMARK_LABEL_MAX)
    return `ラベルが長すぎます（最大 ${WAYMARK_LABEL_MAX} 文字）`;
  if (note != null && note.length > WAYMARK_NOTE_MAX)
    return `メモが長すぎます（最大 ${WAYMARK_NOTE_MAX} 文字）`;
  return null;
}

export async function createCategoryWaymark(input: {
  categoryId: string;
  kind: CategoryWaymarkKind;
  label: string;
  body: string;
  note: string | null;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const lenError = validateWaymarkText(input.label, input.body, input.note);
  if (lenError) return { ok: false, reason: lenError };
  return createCategoryWaymarkAction(input);
}

export async function updateCategoryWaymark(
  id: string,
  patch: Partial<{ label: string; body: string; note: string | null }>,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const lenError = validateWaymarkText(patch.label, patch.body, patch.note);
  if (lenError) return { ok: false, reason: lenError };
  return updateCategoryWaymarkAction(id, patch);
}

export async function deleteCategoryWaymark(
  id: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  return deleteCategoryWaymarkAction(id);
}

export async function setCategoryWaymarkOrder(
  orderedIds: string[],
): Promise<{ ok: true } | { ok: false; reason: string }> {
  return setCategoryWaymarkOrderAction(orderedIds);
}

export function useRealtimeCategoryWaymarks(
  categoryId: string,
  initial: CategoryWaymark[],
): CategoryWaymark[] {
  return useRealtimeTable<CategoryWaymarkRow, CategoryWaymark>({
    channelPrefix: "category-waymarks",
    table: "category_waymarks",
    filter: `category_id=eq.${categoryId}`,
    initial,
    load: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("category_waymarks")
        .select("*")
        .eq("category_id", categoryId)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      return ((data ?? []) as CategoryWaymarkRow[]).map(rowToWaymark);
    },
    refetchOnSubscribeError: true,
  });
}
