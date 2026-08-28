"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { assertAdminResult } from "./auth";
import { dbError } from "./db-error";
import { httpUrlError } from "@/lib/url-validation";

/**
 * コンテンツごとの最適装備 (BiS) リンク (TODO #94)。
 *
 * portal は装備シミュレータを作らない — XivGear などは URL 1 本で構成を
 * 共有できるので、**URL を預かるだけ** にする (調査ノート §4 の
 * 「装備シミュレータの自作」= 非推奨)。権限は他の category 子テーブルと
 * 同じ admin-only。
 */

type WriteResult = { ok: true } | { ok: false; reason: string };

const LABEL_MAX = 200;
const JOB_MAX = 40;
const OWNER_MAX = 100;
const NOTE_MAX = 500;

type BisInput = {
  label: string;
  url: string;
  job?: string | null;
  ownerName?: string | null;
  note?: string | null;
};

function validate(input: BisInput): string | null {
  if (!input.label.trim()) return "ラベルを入力してください";
  if (input.label.length > LABEL_MAX) return "ラベルが長すぎます";
  // httpUrlError は空文字を「未入力 = エラーなし」とするので必須判定は自前で行う。
  if (!input.url.trim()) return "URL を入力してください";
  const urlErr = httpUrlError(input.url);
  if (urlErr) return urlErr;
  if (input.url.trim().length > 2000) return "URL が長すぎます";
  if ((input.job ?? "").length > JOB_MAX) return "ジョブ名が長すぎます";
  if ((input.ownerName ?? "").length > OWNER_MAX) return "担当者名が長すぎます";
  if ((input.note ?? "").length > NOTE_MAX) return "メモが長すぎます";
  return null;
}

const trimOrNull = (v: string | null | undefined) => {
  const s = (v ?? "").trim();
  return s ? s : null;
};

export async function createCategoryBisLinkAction(
  input: BisInput & { categoryId: string },
): Promise<WriteResult> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: "ADMIN ロールが必要です" };
  const err = validate(input);
  if (err) return { ok: false, reason: err };

  const supabase = await createClient();
  const { data: nextOrderData, error: rpcErr } = await supabase.rpc(
    "next_category_bis_link_sort_order",
    { p_category_id: input.categoryId },
  );
  if (rpcErr) return { ok: false, reason: dbError("並び順計算", rpcErr) };

  const { error } = await supabase.from("category_bis_links").insert({
    category_id: input.categoryId,
    label: input.label.trim(),
    url: input.url.trim(),
    job: trimOrNull(input.job),
    owner_name: trimOrNull(input.ownerName),
    note: trimOrNull(input.note),
    sort_order: typeof nextOrderData === "number" ? nextOrderData : 0,
  });
  if (error) return { ok: false, reason: dbError("BiS リンク作成", error) };
  revalidateQuietly();
  return { ok: true };
}

export async function updateCategoryBisLinkAction(
  id: string,
  input: BisInput,
): Promise<WriteResult> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: "ADMIN ロールが必要です" };
  const err = validate(input);
  if (err) return { ok: false, reason: err };

  const supabase = await createClient();
  const { error } = await supabase
    .from("category_bis_links")
    .update({
      label: input.label.trim(),
      url: input.url.trim(),
      job: trimOrNull(input.job),
      owner_name: trimOrNull(input.ownerName),
      note: trimOrNull(input.note),
    })
    .eq("id", id);
  if (error) return { ok: false, reason: dbError("BiS リンク更新", error) };
  revalidateQuietly();
  return { ok: true };
}

export async function deleteCategoryBisLinkAction(
  id: string,
): Promise<WriteResult> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: "ADMIN ロールが必要です" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("category_bis_links")
    .delete()
    .eq("id", id);
  if (error) return { ok: false, reason: dbError("BiS リンク削除", error) };
  revalidateQuietly();
  return { ok: true };
}

function revalidateQuietly() {
  try {
    revalidatePath("/category", "layout");
  } catch {
    // best-effort
  }
}
