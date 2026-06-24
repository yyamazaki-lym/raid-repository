"use server";

import { createClient } from "@/lib/supabase/server";
import { assertAdminResult } from "./auth";
import { dbError } from "./db-error";

/**
 * recruitment_templates の書き込み Server Actions (監査バッチC #18, 2026-06-24)。
 * category-macros-actions と同方針 (app gate + RLS の二層化)。読み取り
 * (fetchRecruitmentTemplates / useRealtimeRecruitmentTemplates) は anon のまま。
 */

type TemplateWriteResult = { ok: true } | { ok: false; reason: string };

export async function createRecruitmentTemplateAction(input: {
  categoryId: string;
  label: string;
  body: string;
}): Promise<TemplateWriteResult> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: auth.reason };

  const supabase = await createClient();
  const { data: nextOrderData, error: rpcErr } = await supabase.rpc(
    "next_recruitment_template_sort_order",
  );
  if (rpcErr) return { ok: false, reason: dbError("並び順計算", rpcErr) };
  const nextOrder = typeof nextOrderData === "number" ? nextOrderData : 0;

  const { error } = await supabase.from("recruitment_templates").insert({
    category_id: input.categoryId,
    label: input.label,
    body: input.body,
    sort_order: nextOrder,
  });
  if (error) return { ok: false, reason: dbError("募集文作成", error) };
  return { ok: true };
}

export async function updateRecruitmentTemplateAction(
  id: string,
  patch: Partial<{ label: string; body: string; categoryId: string | null }>,
): Promise<TemplateWriteResult> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: auth.reason };

  const dbPatch: Record<string, unknown> = {};
  if (patch.label !== undefined) dbPatch.label = patch.label;
  if (patch.body !== undefined) dbPatch.body = patch.body;
  if (patch.categoryId !== undefined) dbPatch.category_id = patch.categoryId;

  const supabase = await createClient();
  const { error } = await supabase
    .from("recruitment_templates")
    .update(dbPatch)
    .eq("id", id);
  if (error) return { ok: false, reason: dbError("募集文更新", error) };
  return { ok: true };
}

export async function deleteRecruitmentTemplateAction(
  id: string,
): Promise<TemplateWriteResult> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: auth.reason };

  const supabase = await createClient();
  const { error } = await supabase
    .from("recruitment_templates")
    .delete()
    .eq("id", id);
  if (error) return { ok: false, reason: dbError("募集文削除", error) };
  return { ok: true };
}

export async function setRecruitmentTemplateOrderAction(
  orderedIds: string[],
): Promise<TemplateWriteResult> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: auth.reason };

  const supabase = await createClient();
  const results = await Promise.all(
    orderedIds.map((id, index) =>
      supabase
        .from("recruitment_templates")
        .update({ sort_order: index })
        .eq("id", id),
    ),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) return { ok: false, reason: dbError("並び替え", failed.error) };
  return { ok: true };
}
