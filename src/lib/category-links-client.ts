"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  rowToCategoryLink,
  type CategoryLink,
  type CategoryLinkKind,
  type CategoryLinkRow,
} from "@/lib/supabase/types";

/**
 * Client mutations + Realtime hook for `category_links`.
 *
 * Same pattern as `categories-client.ts` — a category-scoped subscription
 * refetches the link list on any change, and CRUD calls go directly to the
 * REST API (RLS allows anon).
 */

export async function createCategoryLink(input: {
  categoryId: string;
  kind: CategoryLinkKind;
  title: string;
  url: string;
  description?: string;
  logsUrl?: string | null;
}): Promise<{ ok: true; link: CategoryLink } | { ok: false; reason: string }> {
  const supabase = createClient();
  // New entries appended to end (max sort_order + 1 within this category+kind).
  const { data: maxRow } = await supabase
    .from("category_links")
    .select("sort_order")
    .eq("category_id", input.categoryId)
    .eq("kind", input.kind)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder = ((maxRow?.sort_order as number | undefined) ?? -1) + 1;

  const { data, error } = await supabase
    .from("category_links")
    .insert({
      category_id: input.categoryId,
      kind: input.kind,
      title: input.title,
      url: input.url,
      description: input.description ?? null,
      logs_url: input.logsUrl ?? null,
      sort_order: nextOrder,
    })
    .select("*")
    .single();
  if (error || !data) {
    return { ok: false, reason: error?.message ?? "unknown error" };
  }
  return { ok: true, link: rowToCategoryLink(data as CategoryLinkRow) };
}

export async function updateCategoryLink(
  id: string,
  patch: Partial<{
    title: string;
    url: string;
    description: string | null;
    logs_url: string | null;
  }>,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const supabase = createClient();
  const { error } = await supabase
    .from("category_links")
    .update(patch)
    .eq("id", id);
  if (error) return { ok: false, reason: error.message };
  return { ok: true };
}

export async function deleteCategoryLink(
  id: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const supabase = createClient();
  const { error } = await supabase
    .from("category_links")
    .delete()
    .eq("id", id);
  if (error) return { ok: false, reason: error.message };
  return { ok: true };
}

/**
 * Bulk reorder — assigns sort_order = index for each given id.
 * Mirrors `setCategoryOrder` for categories. Updates run in parallel.
 */
export async function setCategoryLinkOrder(
  orderedIds: string[],
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const supabase = createClient();
  const results = await Promise.all(
    orderedIds.map((id, index) =>
      supabase
        .from("category_links")
        .update({ sort_order: index })
        .eq("id", id),
    ),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) return { ok: false, reason: failed.error.message };
  return { ok: true };
}

/**
 * Live link list for a category + kind. Mirrors `useRealtimeCategories`.
 */
export function useRealtimeCategoryLinks(
  categoryId: string,
  kind: CategoryLinkKind,
  initial: CategoryLink[],
): CategoryLink[] {
  const [links, setLinks] = useState<CategoryLink[]>(initial);
  const id = useId();

  const initialRef = useRef(initial);
  useEffect(() => {
    if (initial !== initialRef.current) {
      initialRef.current = initial;
      setLinks(initial);
    }
  }, [initial]);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();

    const refetch = async () => {
      if (cancelled) return;
      try {
        const { data, error } = await supabase
          .from("category_links")
          .select("*")
          .eq("category_id", categoryId)
          .eq("kind", kind)
          .order("sort_order", { ascending: true })
          .order("created_at", { ascending: true });
        if (cancelled) return;
        if (error) {
          console.warn("[category-links-client] refetch error:", error.message);
          return;
        }
        setLinks(((data ?? []) as CategoryLinkRow[]).map(rowToCategoryLink));
      } catch (e) {
        console.warn("[category-links-client] refetch exception:", e);
      }
    };

    const channel = supabase
      .channel(`category-links-${id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "category_links",
          filter: `category_id=eq.${categoryId}`,
        },
        () => {
          void refetch();
        },
      )
      .subscribe((status, err) => {
        if (err) {
          console.warn(
            "[category-links-client] subscribe error:",
            status,
            err,
          );
        }
      });

    return () => {
      cancelled = true;
      try {
        void supabase.removeChannel(channel);
      } catch (e) {
        console.warn("[category-links-client] removeChannel error:", e);
      }
    };
  }, [id, categoryId, kind]);

  return links;
}
