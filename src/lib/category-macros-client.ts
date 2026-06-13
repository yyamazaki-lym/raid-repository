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
  // 2.4 (2026-06-09) TODO #83: sort_order は schema 側 RPC
  // `next_category_macro_sort_order(p_category_id)` (SECURITY DEFINER) で計算。
  // 1 round-trip 化 + RLS の影響を受けず確実に最新 max を返せる。
  const { data: nextOrderData, error: rpcErr } = await supabase.rpc(
    "next_category_macro_sort_order",
    { p_category_id: input.categoryId },
  );
  if (rpcErr) return { ok: false, reason: rpcErr.message };
  const nextOrder = typeof nextOrderData === "number" ? nextOrderData : 0;

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
  // `.select("id")` で返却行数を確認する。RLS の UPDATE は USING で行が
  // 見えなくなるだけなので、非 admin が実行すると 0 行更新 + error=null に
  // なり、付けないと成功扱い (silent fail) になる。
  const { data, error } = await supabase
    .from("category_macros")
    .update(patch)
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, reason: error.message };
  if (!data)
    return { ok: false, reason: "更新できませんでした（権限がない可能性があります）" };
  return { ok: true };
}

export async function deleteCategoryMacro(
  id: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("category_macros")
    .delete()
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, reason: error.message };
  if (!data)
    return { ok: false, reason: "削除できませんでした（権限がない可能性があります）" };
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
        .eq("id", id)
        .select("id"),
    ),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) return { ok: false, reason: failed.error.message };
  // 1 件でも 0 行更新 = RLS で弾かれた (権限なし) → 失敗扱い。
  if (results.some((r) => !r.data || r.data.length === 0))
    return {
      ok: false,
      reason: "並び替えを保存できませんでした（権限がない可能性があります）",
    };
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
