"use client";

import { createClient } from "@/lib/supabase/client";
import { useRealtimeTable } from "@/lib/use-realtime-table";
import {
  rowToCategory,
  type Category,
  type CategoryRow,
  type CategoryStatus,
} from "@/lib/supabase/types";
import {
  createCategoryAction,
  deleteCategoryAction,
  maybeSetFirstClearAtAction,
  setCategoryOrderAction,
  updateCategoryAction,
  updateCategoryStatusAction,
  type CategoryUpdatePatch,
} from "@/lib/server/categories-actions";

/**
 * Browser-side category helpers.
 *
 * READ: `useRealtimeCategories` keeps a live list via the anon key (RLS
 * allows everyone to read).
 *
 * WRITE: 2.1 (TODO #21) — moved from direct anon writes to **Server Actions**
 * so we can gate by Discord admin role (`DISCORD_ADMIN_ROLE_IDS`). The wrapper
 * functions below preserve the existing call sites' API ({ok: true|false,...})
 * so callers don't change. Non-admins get back `{ok: false, reason: "not_admin"}`.
 */

export async function updateCategoryStatus(
  id: string,
  status: CategoryStatus,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  return updateCategoryStatusAction(id, status);
}

export async function setCategoryOrder(
  orderedIds: string[],
): Promise<{ ok: true } | { ok: false; reason: string }> {
  return setCategoryOrderAction(orderedIds);
}

export async function createCategory(input: {
  slug: string;
  name: string;
  status?: CategoryStatus;
}): Promise<{ ok: true; category: Category } | { ok: false; reason: string }> {
  return createCategoryAction(input);
}

export async function deleteCategory(
  id: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  return deleteCategoryAction(id);
}

export async function updateCategory(
  id: string,
  patch: CategoryUpdatePatch,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  return updateCategoryAction(id, patch);
}

/**
 * If the category's `first_clear_at` is currently NULL, set it to the
 * given timestamp. No-op otherwise (we never overwrite an existing value
 * automatically — only manual edits via the dialog can change it once set).
 *
 * **Not admin-gated**: any member's video upload should be able to mark
 * a clear (this is auto-fired from the link form when a clear-keyword
 * title is detected). The server action skips the admin check by design.
 */
export async function maybeSetFirstClearAt(
  categoryId: string,
  isoTimestamp: string,
): Promise<{ updated: boolean; reason?: string }> {
  return maybeSetFirstClearAtAction(categoryId, isoTimestamp);
}

// Re-export so callers can import `Category`/etc. from the same module.
export type { Category, CategoryRow };

/**
 * Live category list — starts from `initial` (server-rendered) and listens to
 * Realtime changes on the `categories` table. On any change, refetches the
 * full list (keeps the implementation simple; categories are <50 rows).
 *
 * 共通土台は `useRealtimeTable` (全件 refetch モード)。
 */
export function useRealtimeCategories(initial: Category[]): Category[] {
  return useRealtimeTable<CategoryRow, Category>({
    channelPrefix: "categories",
    table: "categories",
    initial,
    load: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("categories")
        .select("*")
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      return ((data ?? []) as CategoryRow[]).map(rowToCategory);
    },
  });
}
