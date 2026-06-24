"use client";

import { createClient } from "@/lib/supabase/client";
import { useRealtimeTable } from "@/lib/use-realtime-table";
import {
  createRecruitmentTemplateAction,
  updateRecruitmentTemplateAction,
  deleteRecruitmentTemplateAction,
  setRecruitmentTemplateOrderAction,
} from "@/lib/server/recruitment-templates-actions";

/**
 * Read helpers + Realtime hook + 書き込み薄wrapper for `recruitment_templates`。
 *
 * Templates are pre-written PT-募集 message bodies that members copy
 * into Discord / FF14 PT-募集 sites. Stored in Supabase so all
 * members see the same library; one click copies to clipboard.
 *
 * WRITE: 監査バッチC #18 (2026-06-24) で anon 直書きから Server Action 経由に
 * 移行 (categories と同じ assertAdminResult ゲート + RLS の二層)。READ
 * (fetchRecruitmentTemplates / useRealtimeRecruitmentTemplates) は anon のまま。
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

// schema 側 CHECK (recruitment_templates_text_sane) と同じ上限。DB が弾く前に
// 友好的なエラーを返すための入口検証 (category-macros-client と同方針)。
const TEMPLATE_BODY_MAX = 8000;
const TEMPLATE_LABEL_MAX = 200;
function validateTemplateText(
  label: string | undefined,
  body: string | undefined,
): string | null {
  if (body !== undefined && body.length > TEMPLATE_BODY_MAX)
    return `本文が長すぎます（最大 ${TEMPLATE_BODY_MAX} 文字）`;
  if (label !== undefined && label.length > TEMPLATE_LABEL_MAX)
    return `ラベルが長すぎます（最大 ${TEMPLATE_LABEL_MAX} 文字）`;
  return null;
}

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
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const lenError = validateTemplateText(input.label, input.body);
  if (lenError) return { ok: false, reason: lenError };
  return createRecruitmentTemplateAction(input);
}

export async function updateRecruitmentTemplate(
  id: string,
  patch: Partial<{ label: string; body: string; categoryId: string | null }>,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const lenError = validateTemplateText(patch.label, patch.body);
  if (lenError) return { ok: false, reason: lenError };
  return updateRecruitmentTemplateAction(id, patch);
}

/**
 * Bulk reorder — assigns sort_order = index for each given id.
 * Updates run in parallel.
 */
export async function setRecruitmentTemplateOrder(
  orderedIds: string[],
): Promise<{ ok: true } | { ok: false; reason: string }> {
  return setRecruitmentTemplateOrderAction(orderedIds);
}

export async function deleteRecruitmentTemplate(
  id: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  return deleteRecruitmentTemplateAction(id);
}

/**
 * Live list — refetches on any DB change. Mirrors `useRealtimeCategories`.
 * 共通土台は `useRealtimeTable` (全件 refetch モード)。
 */
export function useRealtimeRecruitmentTemplates(
  initial: RecruitmentTemplate[],
): RecruitmentTemplate[] {
  return useRealtimeTable<RecruitmentTemplateRow, RecruitmentTemplate>({
    channelPrefix: "recruitment-templates",
    table: "recruitment_templates",
    initial,
    load: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("recruitment_templates")
        .select(SELECT_WITH_CATEGORY)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      return ((data ?? []) as unknown as RecruitmentTemplateRow[]).map(
        rowToTemplate,
      );
    },
    // 一時的な subscribe 失敗後に全件再取得して stale 表示から自己回復する。
    refetchOnSubscribeError: true,
  });
}
