"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  rowToCategory,
  type Category,
  type CategoryRow,
  type CategoryStatus,
} from "@/lib/supabase/types";

/**
 * Browser-side mutations against the `categories` table.
 *
 * These call Supabase directly via the anon key. RLS policies allow anon
 * to read/write everything. Once a write succeeds, Realtime broadcasts the
 * change to every other client subscribed to `useRealtimeCategories`, so
 * the UI updates automatically without a refetch.
 */

export async function updateCategoryStatus(
  id: string,
  status: CategoryStatus,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const supabase = createClient();
  const { error } = await supabase
    .from("categories")
    .update({ status })
    .eq("id", id);
  if (error) return { ok: false, reason: error.message };
  return { ok: true };
}

export async function setCategoryOrder(
  orderedIds: string[],
): Promise<{ ok: true } | { ok: false; reason: string }> {
  // Postgres has no native multi-row reorder; issue updates in parallel.
  const supabase = createClient();
  const updates = orderedIds.map((id, index) =>
    supabase.from("categories").update({ sort_order: index }).eq("id", id),
  );
  const results = await Promise.all(updates);
  const failed = results.find((r) => r.error);
  if (failed?.error) return { ok: false, reason: failed.error.message };
  return { ok: true };
}

export async function createCategory(input: {
  slug: string;
  name: string;
  status?: CategoryStatus;
}): Promise<{ ok: true; category: Category } | { ok: false; reason: string }> {
  const supabase = createClient();
  // Place new categories at the end (max sort_order + 1).
  const { data: maxRow } = await supabase
    .from("categories")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder = ((maxRow?.sort_order as number | undefined) ?? -1) + 1;

  const { data, error } = await supabase
    .from("categories")
    .insert({
      slug: input.slug,
      name: input.name,
      status: input.status ?? "未着手",
      sort_order: nextOrder,
    })
    .select("*")
    .single();
  if (error || !data) {
    return { ok: false, reason: error?.message ?? "unknown error" };
  }
  return { ok: true, category: rowToCategory(data as CategoryRow) };
}

export async function deleteCategory(
  id: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const supabase = createClient();
  const { error } = await supabase.from("categories").delete().eq("id", id);
  if (error) return { ok: false, reason: error.message };
  return { ok: true };
}

export async function updateCategory(
  id: string,
  patch: Partial<{
    name: string;
    slug: string;
    status: CategoryStatus;
    loot_sheet_url: string | null;
    mitigation_sheet_url: string | null;
    discord_strategy_channel_id: string | null;
    discord_video_channel_id: string | null;
  }>,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const supabase = createClient();
  const { error } = await supabase
    .from("categories")
    .update(patch)
    .eq("id", id);
  if (error) return { ok: false, reason: error.message };
  return { ok: true };
}

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
