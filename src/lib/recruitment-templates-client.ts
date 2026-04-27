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
  label: string;
  body: string;
  sortOrder: number;
};

type RecruitmentTemplateRow = {
  id: string;
  label: string;
  body: string;
  sort_order: number;
};

function rowToTemplate(row: RecruitmentTemplateRow): RecruitmentTemplate {
  return {
    id: row.id,
    label: row.label,
    body: row.body,
    sortOrder: row.sort_order,
  };
}

export async function fetchRecruitmentTemplates(): Promise<RecruitmentTemplate[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("recruitment_templates")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error || !data) return [];
  return (data as RecruitmentTemplateRow[]).map(rowToTemplate);
}

export async function createRecruitmentTemplate(input: {
  label: string;
  body: string;
}): Promise<{ ok: true; template: RecruitmentTemplate } | { ok: false; reason: string }> {
  const supabase = createClient();
  // Append to end.
  const { data: maxRow } = await supabase
    .from("recruitment_templates")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder = ((maxRow?.sort_order as number | undefined) ?? -1) + 1;

  const { data, error } = await supabase
    .from("recruitment_templates")
    .insert({
      label: input.label,
      body: input.body,
      sort_order: nextOrder,
    })
    .select("*")
    .single();
  if (error || !data) return { ok: false, reason: error?.message ?? "unknown" };
  return { ok: true, template: rowToTemplate(data as RecruitmentTemplateRow) };
}

export async function updateRecruitmentTemplate(
  id: string,
  patch: Partial<{ label: string; body: string }>,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const supabase = createClient();
  const { error } = await supabase
    .from("recruitment_templates")
    .update(patch)
    .eq("id", id);
  if (error) return { ok: false, reason: error.message };
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
          .select("*")
          .order("sort_order", { ascending: true })
          .order("created_at", { ascending: true });
        if (cancelled) return;
        if (error) {
          console.warn("[recruitment-templates] refetch error:", error.message);
          return;
        }
        setTemplates(((data ?? []) as RecruitmentTemplateRow[]).map(rowToTemplate));
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
