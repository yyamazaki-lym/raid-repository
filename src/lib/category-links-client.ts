"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { isClearTitleForCategory } from "@/lib/clear-detection";
import { maybeSetFirstClearAt } from "@/lib/categories-client";
import {
  createCategoryLinkAction,
  deleteCategoryLinkAction,
  enrichVideoLinkDuration,
  setCategoryLinkOrderAction,
  updateCategoryLinkAction,
} from "@/lib/server/categories-actions";
import { parseYouTubeId } from "@/lib/youtube";
import {
  rowToCategoryLink,
  type CategoryLink,
  type CategoryLinkKind,
  type CategoryLinkRow,
} from "@/lib/supabase/types";

/**
 * Client wrappers + Realtime hook for `category_links`.
 *
 * 2.1 (2026-04-29) 以降: 書き込みは ADMIN gate 付きの server action
 * (`*Action`) を経由する。旧 anon key 直書きは RLS 未締めで誰でも書き
 * 込めていたため、設定書き込みと同様に server 側で `assertAdminResult()`
 * で gate するようにした。realtime subscription / refetch は読み取りのみ
 * なので supabase client のまま。
 */

export async function createCategoryLink(input: {
  categoryId: string;
  kind: CategoryLinkKind;
  title: string;
  url: string;
  description?: string;
  logsUrl?: string | null;
}): Promise<{ ok: true; link: CategoryLink } | { ok: false; reason: string }> {
  const created = await createCategoryLinkAction(input);
  if (!created.ok) return created;
  // server action returns id only; refetch the row so callers get the
  // full CategoryLink shape (CategoryLinkRow → CategoryLink mapping).
  const supabase = createClient();
  const { data, error } = await supabase
    .from("category_links")
    .select("*")
    .eq("id", created.linkId)
    .single();
  if (error || !data) {
    return { ok: false, reason: error?.message ?? "row fetch failed" };
  }
  const link = rowToCategoryLink(data as CategoryLinkRow);

  // Auto-detect first clear: if this is a video and the title is a
  // category-appropriate clear, fill `first_clear_at` (only if NULL).
  // Best-effort — don't fail the insert if this side-effect errors.
  if (link.kind === "video") {
    try {
      const { data: catRow } = await supabase
        .from("categories")
        .select("name")
        .eq("id", link.categoryId)
        .maybeSingle();
      const categoryName = (catRow as { name?: string | null } | null)?.name;
      if (isClearTitleForCategory(link.title, categoryName)) {
        await maybeSetFirstClearAt(
          link.categoryId,
          link.postedAt ?? link.createdAt,
        );
      }
    } catch (e) {
      console.warn("[category-links-client] first-clear auto-set failed:", e);
    }
  }

  // Auto-fetch YouTube duration for video links. Server-side via a
  // Server Action so credentials/User-Agent stay off the browser.
  if (link.kind === "video" && parseYouTubeId(link.url)) {
    try {
      await enrichVideoLinkDuration(link.id, link.url);
    } catch (e) {
      console.warn("[category-links-client] duration enrich failed:", e);
    }
  }
  return { ok: true, link };
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
  return updateCategoryLinkAction(id, patch);
}

export async function deleteCategoryLink(
  id: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  return deleteCategoryLinkAction(id);
}

/**
 * Bulk reorder — assigns sort_order = index for each given id.
 * Mirrors `setCategoryOrder` for categories. Updates run in parallel.
 */
export async function setCategoryLinkOrder(
  orderedIds: string[],
): Promise<{ ok: true } | { ok: false; reason: string }> {
  return setCategoryLinkOrderAction(orderedIds);
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
