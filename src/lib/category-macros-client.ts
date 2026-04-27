"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * CRUD + Realtime hook for `category_macros` (per-category in-game
 * text macros). Pattern mirrors `category-links-client.ts` /
 * `recruitment-templates-client.ts`.
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

export async function createCategoryMacro(input: {
  categoryId: string;
  label: string;
  body: string;
}): Promise<{ ok: true; macro: CategoryMacro } | { ok: false; reason: string }> {
  const supabase = createClient();
  const { data: maxRow } = await supabase
    .from("category_macros")
    .select("sort_order")
    .eq("category_id", input.categoryId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder = ((maxRow?.sort_order as number | undefined) ?? -1) + 1;

  const { data, error } = await supabase
    .from("category_macros")
    .insert({
      category_id: input.categoryId,
      label: input.label,
      body: input.body,
      sort_order: nextOrder,
    })
    .select("*")
    .single();
  if (error || !data) return { ok: false, reason: error?.message ?? "unknown" };
  return { ok: true, macro: rowToMacro(data as CategoryMacroRow) };
}

export async function updateCategoryMacro(
  id: string,
  patch: Partial<{ label: string; body: string }>,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const supabase = createClient();
  const { error } = await supabase
    .from("category_macros")
    .update(patch)
    .eq("id", id);
  if (error) return { ok: false, reason: error.message };
  return { ok: true };
}

export async function deleteCategoryMacro(
  id: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const supabase = createClient();
  const { error } = await supabase
    .from("category_macros")
    .delete()
    .eq("id", id);
  if (error) return { ok: false, reason: error.message };
  return { ok: true };
}

export async function setCategoryMacroOrder(
  orderedIds: string[],
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const supabase = createClient();
  const results = await Promise.all(
    orderedIds.map((id, index) =>
      supabase
        .from("category_macros")
        .update({ sort_order: index })
        .eq("id", id),
    ),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) return { ok: false, reason: failed.error.message };
  return { ok: true };
}

export function useRealtimeCategoryMacros(
  categoryId: string,
  initial: CategoryMacro[],
): CategoryMacro[] {
  const [macros, setMacros] = useState<CategoryMacro[]>(initial);
  const id = useId();

  const initialRef = useRef(initial);
  useEffect(() => {
    if (initial !== initialRef.current) {
      initialRef.current = initial;
      setMacros(initial);
    }
  }, [initial]);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();

    const refetch = async () => {
      if (cancelled) return;
      try {
        const { data, error } = await supabase
          .from("category_macros")
          .select("*")
          .eq("category_id", categoryId)
          .order("sort_order", { ascending: true })
          .order("created_at", { ascending: true });
        if (cancelled) return;
        if (error) {
          console.warn("[category-macros] refetch error:", error.message);
          return;
        }
        setMacros(((data ?? []) as CategoryMacroRow[]).map(rowToMacro));
      } catch (e) {
        console.warn("[category-macros] refetch exception:", e);
      }
    };

    const channel = supabase
      .channel(`category-macros-${id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "category_macros",
          filter: `category_id=eq.${categoryId}`,
        },
        () => {
          void refetch();
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      try {
        void supabase.removeChannel(channel);
      } catch (e) {
        console.warn("[category-macros] removeChannel error:", e);
      }
    };
  }, [id, categoryId]);

  return macros;
}
