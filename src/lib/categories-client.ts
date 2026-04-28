"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
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
 * Channel name uses React's `useId()` so two component instances on the same
 * page (e.g. CategoryList + CategorySwitcher) get different subscriptions.
 */
export function useRealtimeCategories(initial: Category[]): Category[] {
  const [categories, setCategories] = useState<Category[]>(initial);
  const id = useId();

  // Update when initial changes (e.g. after router.refresh()).
  const initialRef = useRef(initial);
  useEffect(() => {
    if (initial !== initialRef.current) {
      initialRef.current = initial;
      setCategories(initial);
    }
  }, [initial]);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();

    const refetch = async () => {
      if (cancelled) return;
      try {
        const { data, error } = await supabase
          .from("categories")
          .select("*")
          .order("sort_order", { ascending: true })
          .order("created_at", { ascending: true });
        if (cancelled) return;
        if (error) {
          console.warn("[categories-client] refetch error:", error.message);
          return;
        }
        setCategories(((data ?? []) as CategoryRow[]).map(rowToCategory));
      } catch (e) {
        console.warn("[categories-client] refetch exception:", e);
      }
    };

    const channel = supabase
      .channel(`categories-${id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "categories" },
        () => {
          void refetch();
        },
      )
      .subscribe((status, err) => {
        if (err) {
          console.warn("[categories-client] subscribe error:", status, err);
        }
      });

    return () => {
      cancelled = true;
      try {
        void supabase.removeChannel(channel);
      } catch (e) {
        console.warn("[categories-client] removeChannel error:", e);
      }
    };
  }, [id]);

  return categories;
}
