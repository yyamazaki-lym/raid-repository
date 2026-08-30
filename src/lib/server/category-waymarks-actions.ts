"use server";

import { createClient } from "@/lib/supabase/server";
import { assertAdminResult } from "./auth";
import { dbError } from "./db-error";

/**
 * category_waymarks の書き込み Server Actions (TODO #94 / A-5)。
 *
 * `category-macros-actions.ts` と同型 (assertAdminResult の app gate +
 * RLS の admin policy の二層)。ウェイマークはマクロと同じ「配布物」で、
 * 権限モデルを変える理由が無いのでそのまま踏襲する。
 */

type WaymarkWriteResult = { ok: true } | { ok: false; reason: string };

export async function createCategoryWaymarkAction(input: {
  categoryId: string;
  /** 2026-08-30: 'waymark' (markercode) / 'board' (ストラテジーボード共有コード)。 */
  kind?: "waymark" | "board";
  label: string;
  body: string;
  note: string | null;
}): Promise<WaymarkWriteResult> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: auth.reason };

  const supabase = await createClient();
  // sort_order は SECURITY DEFINER RPC で計算 (13c / 6b-7 と同じ TOCTOU 回避)。
  const { data: nextOrderData, error: rpcErr } = await supabase.rpc(
    "next_category_waymark_sort_order",
    { p_category_id: input.categoryId },
  );
  if (rpcErr) return { ok: false, reason: dbError("並び順計算", rpcErr) };
  const nextOrder = typeof nextOrderData === "number" ? nextOrderData : 0;

  const { error } = await supabase.from("category_waymarks").insert({
    category_id: input.categoryId,
    kind: input.kind === "board" ? "board" : "waymark",
    label: input.label,
    body: input.body,
    note: input.note,
    sort_order: nextOrder,
  });
  if (error) return { ok: false, reason: dbError("ウェイマーク作成", error) };
  return { ok: true };
}

export async function updateCategoryWaymarkAction(
  id: string,
  patch: Partial<{ label: string; body: string; note: string | null }>,
): Promise<WaymarkWriteResult> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: auth.reason };

  const supabase = await createClient();
  const { error } = await supabase
    .from("category_waymarks")
    .update(patch)
    .eq("id", id);
  if (error) return { ok: false, reason: dbError("ウェイマーク更新", error) };
  return { ok: true };
}

export async function deleteCategoryWaymarkAction(
  id: string,
): Promise<WaymarkWriteResult> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: auth.reason };

  const supabase = await createClient();
  const { error } = await supabase
    .from("category_waymarks")
    .delete()
    .eq("id", id);
  if (error) return { ok: false, reason: dbError("ウェイマーク削除", error) };
  return { ok: true };
}

export async function setCategoryWaymarkOrderAction(
  orderedIds: string[],
): Promise<WaymarkWriteResult> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: auth.reason };

  const supabase = await createClient();
  const results = await Promise.all(
    orderedIds.map((id, index) =>
      supabase
        .from("category_waymarks")
        .update({ sort_order: index })
        .eq("id", id),
    ),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error)
    return { ok: false, reason: dbError("並び替え", failed.error) };
  return { ok: true };
}
