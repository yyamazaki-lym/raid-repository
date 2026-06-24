"use client";

import { createClient } from "@/lib/supabase/client";
import { useRealtimeTable } from "@/lib/use-realtime-table";
import {
  createCategoryMacroAction,
  updateCategoryMacroAction,
  deleteCategoryMacroAction,
  setCategoryMacroOrderAction,
} from "@/lib/server/category-macros-actions";

/**
 * Realtime hook (read) + 書き込み薄wrapper for `category_macros`。
 *
 * READ: `useRealtimeCategoryMacros` が anon key で live list を保持 (RLS が
 * SELECT を全開放)。
 * WRITE: 監査バッチC #18 (2026-06-24) で anon 直書きから **Server Action**
 * 経由に移行 (categories と同じ assertAdminResult ゲート + RLS の二層)。
 * 下の wrapper は呼び出し側 API ({ok,reason}) を維持しつつ長さ検証だけ
 * client 側で先に走らせ、実書き込みは action に委譲する。
 */

export type CategoryMacro = {
  id: string;
  categoryId: string;
  label: string;
  body: string;
  sortOrder: number;
};

type CategoryMacroRow = {
  id: string;
  category_id: string;
  label: string;
  body: string;
  sort_order: number;
};

function rowToMacro(row: CategoryMacroRow): CategoryMacro {
  return {
    id: row.id,
    categoryId: row.category_id,
    label: row.label ?? "",
    body: row.body,
    sortOrder: row.sort_order,
  };
}

// schema 側 CHECK (category_macros_text_sane) と同じ上限。DB が弾く前に
// 友好的なエラーを返すための入口検証。`.length` (UTF-16) は Postgres の
// char_length (コードポイント) 以上なので、ここを通れば DB も通る安全側。
const MACRO_BODY_MAX = 8000;
const MACRO_LABEL_MAX = 200;
function validateMacroText(
  label: string | undefined,
  body: string | undefined,
): string | null {
  if (body !== undefined && body.length > MACRO_BODY_MAX)
    return `本文が長すぎます（最大 ${MACRO_BODY_MAX} 文字）`;
  if (label !== undefined && label.length > MACRO_LABEL_MAX)
    return `ラベルが長すぎます（最大 ${MACRO_LABEL_MAX} 文字）`;
  return null;
}

export async function createCategoryMacro(input: {
  categoryId: string;
  label: string;
  body: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const lenError = validateMacroText(input.label, input.body);
  if (lenError) return { ok: false, reason: lenError };
  return createCategoryMacroAction(input);
}

export async function updateCategoryMacro(
  id: string,
  patch: Partial<{ label: string; body: string }>,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const lenError = validateMacroText(patch.label, patch.body);
  if (lenError) return { ok: false, reason: lenError };
  return updateCategoryMacroAction(id, patch);
}

export async function deleteCategoryMacro(
  id: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  return deleteCategoryMacroAction(id);
}

export async function setCategoryMacroOrder(
  orderedIds: string[],
): Promise<{ ok: true } | { ok: false; reason: string }> {
  return setCategoryMacroOrderAction(orderedIds);
}

export function useRealtimeCategoryMacros(
  categoryId: string,
  initial: CategoryMacro[],
): CategoryMacro[] {
  return useRealtimeTable<CategoryMacroRow, CategoryMacro>({
    channelPrefix: "category-macros",
    table: "category_macros",
    filter: `category_id=eq.${categoryId}`,
    initial,
    load: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("category_macros")
        .select("*")
        .eq("category_id", categoryId)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      return ((data ?? []) as CategoryMacroRow[]).map(rowToMacro);
    },
    // 一時的な subscribe 失敗後に全件再取得して stale 表示から自己回復する。
    refetchOnSubscribeError: true,
  });
}
