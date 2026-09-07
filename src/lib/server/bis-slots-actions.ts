"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { requireDiscordMember } from "./auth";
import { dbError } from "./db-error";
import { XIVGEAR_EQUIP_SLOTS } from "@/lib/xivgear-set";

/**
 * BiS の部位別「取得済」チェック (W-23、2026-09-07)。
 *
 * **サインイン済みのメンバーなら誰でも**トグルできる。
 * `category_bis_links.owner_name` は自由記述で Discord ID と紐づいていない
 * ため「本人だけ」を強制できず、実運用でも「今日ドロップした分をその場で
 * 誰かが付ける」のが自然 (本人待ちにすると埋まらない)。ロット表 Sheets と
 * 同じ信頼モデルで、`loot_weekly_checks` の「本人だけ」とは扱いが違う。
 *
 * RLS の書き込みポリシーは admin only なので、非 admin のトグルは
 * service role で通す (admin gate を掛けない代わりに、**書ける対象を
 * この 1 テーブルの 2 列に限定**している)。
 */

const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export async function setCategoryBisSlotAction(input: {
  bisLinkId: string;
  slot: string;
  obtained: boolean;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const member = await requireDiscordMember();
  // 公開デモの匿名ゲストは共有 ID なので書かせない (他の service role 経路と
  // 同じ扱い)。
  if (member.isDemoGuest) {
    return { ok: false, reason: "デモ表示中は変更できません" };
  }
  const id = input.bisLinkId?.trim() ?? "";
  if (!UUID_RE.test(id)) return { ok: false, reason: "BiS の ID が不正です" };
  if (!(XIVGEAR_EQUIP_SLOTS as readonly string[]).includes(input.slot)) {
    return { ok: false, reason: "部位の指定が不正です" };
  }

  const supabase = createSupabaseServiceRoleClient();
  const { error } = await supabase.from("category_bis_slots").upsert(
    {
      bis_link_id: id,
      slot: input.slot,
      obtained: input.obtained === true,
    },
    { onConflict: "bis_link_id,slot" },
  );
  if (error) return { ok: false, reason: dbError("BiS 部位の保存", error) };
  try {
    revalidatePath("/category", "layout");
  } catch {
    // best-effort
  }
  return { ok: true };
}
