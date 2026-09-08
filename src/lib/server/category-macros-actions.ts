"use server";

import { createClient } from "@/lib/supabase/server";
import { assertAdminResult } from "./auth";
import { dbError } from "./db-error";

/**
 * category_macros の書き込み Server Actions (監査バッチC #18, 2026-06-24)。
 *
 * 旧来は `src/lib/category-macros-client.ts` から anon key で直接書き込み、
 * 防御は RLS の is_admin claim のみだった (categories は #21 で Server Action
 * + assertAdminResult に移行済)。認可漏れは無いが防御層が非対称だったため、
 * categories と同じ「app gate (assertAdminResult) + RLS」の二層に揃える。
 *
 * 読み取り (useRealtimeCategoryMacros) は従来どおり anon client のまま
 * (RLS が SELECT を全開放)。長さ検証は client 側 (createCategoryMacro 等) で
 * 先に走る + DB の CHECK (category_macros_text_sane) が最終ガード。
 */

type MacroWriteResult = { ok: true } | { ok: false; reason: string };

export async function createCategoryMacroAction(input: {
  categoryId: string;
  label: string;
  body: string;
}): Promise<MacroWriteResult> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: auth.reason };

  const supabase = await createClient();
  // sort_order は SECURITY DEFINER RPC で計算 (TODO #83、client 経路と同じ)。
  const { data: nextOrderData, error: rpcErr } = await supabase.rpc(
    "next_category_macro_sort_order",
    { p_category_id: input.categoryId },
  );
  if (rpcErr) return { ok: false, reason: dbError("並び順計算", rpcErr) };
  const nextOrder = typeof nextOrderData === "number" ? nextOrderData : 0;

  const { error } = await supabase.from("category_macros").insert({
    category_id: input.categoryId,
    label: input.label,
    body: input.body,
    sort_order: nextOrder,
  });
  if (error) return { ok: false, reason: dbError("マクロ作成", error) };
  return { ok: true };
}

export async function updateCategoryMacroAction(
  id: string,
  patch: Partial<{ label: string; body: string }>,
): Promise<MacroWriteResult> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: auth.reason };

  const supabase = await createClient();
  const { error } = await supabase
    .from("category_macros")
    .update(patch)
    .eq("id", id);
  if (error) return { ok: false, reason: dbError("マクロ更新", error) };
  return { ok: true };
}

export async function deleteCategoryMacroAction(
  id: string,
): Promise<MacroWriteResult> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: auth.reason };

  const supabase = await createClient();
  const { error } = await supabase.from("category_macros").delete().eq("id", id);
  if (error) return { ok: false, reason: dbError("マクロ削除", error) };
  return { ok: true };
}

/**
 * UI-7 (2026-09-08): 「採用中」のマクロを 1 本に切り替える。
 *
 * ⚠ **他を false にしてから対象を true にする。** 逆順だと一瞬 2 本が
 * true になり、部分 UNIQUE index (`category_macros_current_uidx`) に
 * 弾かれる。`macroId` に null を渡すと「採用中なし」に戻す。
 */
export async function setCategoryMacroCurrentAction(input: {
  categoryId: string;
  macroId: string | null;
}): Promise<MacroWriteResult> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: auth.reason };
  if (!/^[0-9a-f-]{36}$/i.test(input.categoryId ?? "")) {
    return { ok: false, reason: "コンテンツの指定が不正です" };
  }
  if (input.macroId !== null && !/^[0-9a-f-]{36}$/i.test(input.macroId)) {
    return { ok: false, reason: "マクロの指定が不正です" };
  }

  const supabase = await createClient();
  const cleared = await supabase
    .from("category_macros")
    .update({ is_current: false })
    .eq("category_id", input.categoryId)
    .eq("is_current", true);
  if (cleared.error) {
    // 解除も設定も利用者から見れば「切り替え」1 つなので、失敗の文言は
    // 段階で分けない (押した操作と違う語が出ると原因を誤解させる)。
    return { ok: false, reason: dbError("採用中の切り替え", cleared.error) };
  }
  if (input.macroId === null) return { ok: true };
  const set = await supabase
    .from("category_macros")
    .update({ is_current: true })
    .eq("id", input.macroId)
    .eq("category_id", input.categoryId);
  if (set.error) {
    return { ok: false, reason: dbError("採用中の切り替え", set.error) };
  }
  return { ok: true };
}

export async function setCategoryMacroOrderAction(
  orderedIds: string[],
): Promise<MacroWriteResult> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: auth.reason };

  const supabase = await createClient();
  const results = await Promise.all(
    orderedIds.map((id, index) =>
      supabase.from("category_macros").update({ sort_order: index }).eq("id", id),
    ),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) return { ok: false, reason: dbError("並び替え", failed.error) };
  return { ok: true };
}
