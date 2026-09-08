"use client";

import { textLengthError } from "@/lib/text-length-error";
import { createClient } from "@/lib/supabase/client";

/** 表示言語。辞書は import せず引数で受ける (url-validation.ts と同方針)。 */
type TextLocale = "ja" | "en";
import { useRealtimeTable } from "@/lib/use-realtime-table";
import {
  createCategoryMacroAction,
  updateCategoryMacroAction,
  deleteCategoryMacroAction,
  setCategoryMacroOrderAction,
  setCategoryMacroCurrentAction,
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
  /**
   * UI-7 (2026-09-08): このコンテンツで**採用中**のマクロか。
   * 1 コンテンツに 1 本だけ (DB の部分 UNIQUE index で保証)。
   * 列が無い旧 DB では常に false。
   */
  isCurrent: boolean;
};

type CategoryMacroRow = {
  id: string;
  category_id: string;
  label: string;
  body: string;
  sort_order: number;
  is_current?: boolean | null;
};

function rowToMacro(row: CategoryMacroRow): CategoryMacro {
  return {
    id: row.id,
    categoryId: row.category_id,
    label: row.label ?? "",
    body: row.body,
    sortOrder: row.sort_order,
    isCurrent: row.is_current === true,
  };
}

// schema 側 CHECK (category_macros_text_sane) と同じ上限。DB が弾く前に
// 友好的なエラーを返すための入口検証 (文言は text-length-error.ts に集約)。
const MACRO_BODY_MAX = 8000;
const MACRO_LABEL_MAX = 200;
function validateMacroText(
  label: string | undefined,
  body: string | undefined,
  locale: TextLocale = "ja",
): string | null {
  return textLengthError(
    [
      { field: "body", value: body, max: MACRO_BODY_MAX },
      { field: "label", value: label, max: MACRO_LABEL_MAX },
    ],
    locale,
  );
}

export async function createCategoryMacro(
  input: {
    categoryId: string;
    label: string;
    body: string;
  },
  locale: TextLocale = "ja",
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const lenError = validateMacroText(input.label, input.body, locale);
  if (lenError) return { ok: false, reason: lenError };
  return createCategoryMacroAction(input);
}

export async function updateCategoryMacro(
  id: string,
  patch: Partial<{ label: string; body: string }>,
  locale: TextLocale = "ja",
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const lenError = validateMacroText(patch.label, patch.body, locale);
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

/**
 * UI-7 (2026-09-08): 採用中のマクロを切り替える (null で解除)。
 * 1 コンテンツ 1 本の保証は DB の部分 UNIQUE index と action 側の
 * 更新順にある (`setCategoryMacroCurrentAction` の docstring)。
 */
export async function setCategoryMacroCurrent(input: {
  categoryId: string;
  macroId: string | null;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  return setCategoryMacroCurrentAction(input);
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
