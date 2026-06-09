"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * CRUD + Realtime hook for the `recruitment_templates` table.
 *
 * Templates are pre-written PT-募集 message bodies that members copy
 * into Discord / FF14 PT-募集 sites. Stored in Supabase so all
 * members see the same library; one click copies to clipboard.
 */

export type RecruitmentTemplate = {
  id: string;
  /** Optional sub-label within a category (e.g. "1層" / "2層"). */
  label: string;
  body: string;
  sortOrder: number;
  categoryId: string | null;
  /** Joined from `categories.name` for display. NULL when category was deleted. */
  categoryName: string | null;
};

type RecruitmentTemplateRow = {
  id: string;
  label: string;
  body: string;
  sort_order: number;
  category_id: string | null;
  // Supabase nested-select returns the related row as a one-to-one
  // object at runtime even though its strict types model it as an
  // array. We accept either for safety.
  categories:
    | { name: string }
    | { name: string }[]
    | null;
};

function rowToTemplate(row: RecruitmentTemplateRow): RecruitmentTemplate {
  const cat = Array.isArray(row.categories) ? row.categories[0] : row.categories;
  return {
    id: row.id,
    label: row.label ?? "",
    body: row.body,
    sortOrder: row.sort_order,
    categoryId: row.category_id ?? null,
    categoryName: cat?.name ?? null,
  };
}

const SELECT_WITH_CATEGORY =
  "id, label, body, sort_order, category_id, categories(name)";

export async function fetchRecruitmentTemplates(): Promise<RecruitmentTemplate[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("recruitment_templates")
    .select(SELECT_WITH_CATEGORY)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error || !data) return [];
  return (data as unknown as RecruitmentTemplateRow[]).map(rowToTemplate);
}

export async function createRecruitmentTemplate(input: {
  categoryId: string;
  label: string;
  body: string;
}): Promise<{ ok: true; template: RecruitmentTemplate } | { ok: false; reason: string }> {
  const supabase = createClient();
  // 2.4 (2026-06-09) TODO #83: sort_order は schema 側 RPC
  // `next_recruitment_template_sort_order()` (SECURITY DEFINER) で計算。
  // 1 round-trip 化 + RLS の影響を受けず確実に最新 max を返せる。
  // INSERT との完全な atomic 化ではないが、JS 側で SELECT してから
  // INSERT する従来パターンよりは race window が短い。
  const { data: nextOrderData, error: rpcErr } = await supabase.rpc(
    "next_recruitment_template_sort_order",
  );
  if (rpcErr) return { ok: false, reason: rpcErr.message };
  const nextOrder = typeof nextOrderData === "number" ? nextOrderData : 0;

  const { data, error } = await supabase
    .from("recruitment_templates")
    .insert({
      category_id: input.categoryId,
      label: input.label,
      body: input.body,
      sort_order: nextOrder,
    })
    .select(SELECT_WITH_CATEGORY)
    .single();
  if (error || !data) return { ok: false, reason: error?.message ?? "unknown" };
  return {
    ok: true,
    template: rowToTemplate(data as unknown as RecruitmentTemplateRow),
  };
}

export async function updateRecruitmentTemplate(
  id: string,
  patch: Partial<{ label: string; body: string; categoryId: string | null }>,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const supabase = createClient();
  const dbPatch: Record<string, unknown> = {};
  if (patch.label !== undefined) dbPatch.label = patch.label;
  if (patch.body !== undefined) dbPatch.body = patch.body;
  if (patch.categoryId !== undefined) dbPatch.category_id = patch.categoryId;
  const { error } = await supabase
    .from("recruitment_templates")
    .update(dbPatch)
    .eq("id", id);
  if (error) return { ok: false, reason: error.message };
  return { ok: true };
}

/**
 * Bulk reorder — assigns sort_order = index for each given id.
 * Updates run in parallel.
 */
export async function setRecruitmentTemplateOrder(
  orderedIds: string[],
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const supabase = createClient();
  const results = await Promise.all(
    orderedIds.map((id, index) =>
      supabase
        .from("recruitment_templates")
        .update({ sort_order: index })
        .eq("id", id),
    ),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) return { ok: false, reason: failed.error.message };
  return { ok: true };
}

export async function deleteRecruitmentTemplate(
  id: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const supabase = createClient();
  const { error } = await supabase
    .from("recruitment_templates")
    .delete()
    .eq("id", id);
  if (error) return { ok: false, reason: error.message };
  return { ok: true };
}

/**
 * Live list — refetches on any DB change. Mirrors `useRealtimeCategories`.
 */
export function useRealtimeRecruitmentTemplates(
  initial: RecruitmentTemplate[],
): RecruitmentTemplate[] {
  const [templates, setTemplates] = useState<RecruitmentTemplate[]>(initial);
  const id = useId();

  const initialRef = useRef(initial);
  useEffect(() => {
    if (initial !== initialRef.current) {
      initialRef.current = initial;
      setTemplates(initial);
    }
  }, [initial]);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();

    const refetch = async () => {
      if (cancelled) return;
      try {
        const { data, error } = await supabase
          .from("recruitment_templates")
          .select(SELECT_WITH_CATEGORY)
          .order("sort_order", { ascending: true })
          .order("created_at", { ascending: true });
        if (cancelled) return;
        if (error) {
          console.warn("[recruitment-templates] refetch error:", error.message);
          return;
        }
        setTemplates(
          ((data ?? []) as unknown as RecruitmentTemplateRow[]).map(rowToTemplate),
        );
      } catch (e) {
        console.warn("[recruitment-templates] refetch exception:", e);
      }
    };

    const channel = supabase
      .channel(`recruitment-templates-${id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "recruitment_templates" },
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
        console.warn("[recruitment-templates] removeChannel error:", e);
      }
    };
  }, [id]);

  return templates;
}
