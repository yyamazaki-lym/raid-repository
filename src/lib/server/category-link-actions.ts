"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { assertAdminResult, requireDiscordMember } from "./auth";
import { dbError } from "./db-error";
import {
  LINK_TAG_MAX_PER_LINK,
  linkTagError,
  normalizeLinkTag,
} from "@/lib/link-tags";

/**
 * 攻略リンクの既読 (W-27) とタグ (B-1) の書き込み (2026-09-07)。
 *
 * 既読は **本人が自分の行だけ**を触る操作なので、`native_schedule_members`
 * の comment 更新 / `loot_weekly_checks` の本人チェックと同じ経路にする:
 * RLS は閉じたまま service role で bypass し、`discord_user_id` は
 * サーバーが `requireDiscordMember()` から取る (client から受け取らない —
 * 受け取ると他人の既読を付け外しできてしまう)。
 *
 * タグは共有物なので admin gate。
 */

type WriteResult = { ok: true } | { ok: false; reason: string };

const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function revalidateQuietly() {
  try {
    revalidatePath("/category", "layout");
  } catch {
    // best-effort
  }
}

/**
 * 自分の既読を付ける / 外す (W-27)。
 *
 * リンク ID の実在確認はしない — FK (`category_links(id) ON DELETE CASCADE`)
 * があるので存在しない ID の INSERT は DB が弾き、削除済みリンクの行は
 * カスケードで消える。
 */
export async function setCategoryLinkReadAction(
  linkId: string,
  read: boolean,
): Promise<WriteResult> {
  const member = await requireDiscordMember();
  // 公開デモの匿名ゲストは固定 ID を共有しているため、書かせると全員の
  // 既読が 1 行に混ざる。service role 経路なので明示的に弾く
  // (updateNativeScheduleMemberCommentAction と同じ理由)。
  if (member.isDemoGuest) {
    return { ok: false, reason: "デモ表示中は既読を変更できません" };
  }
  const id = linkId?.trim() ?? "";
  if (!UUID_RE.test(id)) return { ok: false, reason: "リンクの ID が不正です" };

  const supabase = createSupabaseServiceRoleClient();
  if (read) {
    // 既に既読なら read_at を更新しない (「最初に読んだ日時」を保つ)。
    const { error } = await supabase
      .from("category_link_reads")
      .upsert(
        { link_id: id, discord_user_id: member.discordId },
        { onConflict: "link_id,discord_user_id", ignoreDuplicates: true },
      );
    if (error) return { ok: false, reason: dbError("既読の保存", error) };
  } else {
    const { error } = await supabase
      .from("category_link_reads")
      .delete()
      .eq("link_id", id)
      .eq("discord_user_id", member.discordId);
    if (error) return { ok: false, reason: dbError("既読の取り消し", error) };
  }
  revalidateQuietly();
  return { ok: true };
}

/**
 * リンクにタグを付ける (B-1)。既に同じラベルがあれば何もしない (冪等)。
 * 上限 `LINK_TAG_MAX_PER_LINK` を超える追加は拒否する。
 */
export async function addCategoryLinkTagAction(
  linkId: string,
  label: string,
): Promise<WriteResult> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: "ADMIN ロールが必要です" };
  const id = linkId?.trim() ?? "";
  if (!UUID_RE.test(id)) return { ok: false, reason: "リンクの ID が不正です" };

  const err = linkTagError(label ?? "");
  if (err === "empty") return { ok: false, reason: "タグを入力してください" };
  if (err === "too_long") return { ok: false, reason: "タグは 24 文字以内です" };
  const normalized = normalizeLinkTag(label);

  const supabase = createSupabaseServiceRoleClient();
  const { data: existing, error: readError } = await supabase
    .from("tags")
    .select("label")
    .eq("target_type", "category_link")
    .eq("target_id", id);
  if (readError) return { ok: false, reason: dbError("タグ取得", readError) };
  const rows = (existing ?? []) as Array<{ label: string }>;
  // 大文字小文字だけ違うラベルも同じタグとして扱う (「p3」と「P3」を
  // 別タグにしない — 絞り込みが分裂する)。UNIQUE index は完全一致なので
  // ここで見る必要がある。
  if (rows.some((r) => r.label.toLowerCase() === normalized.toLowerCase())) {
    return { ok: true };
  }
  if (rows.length >= LINK_TAG_MAX_PER_LINK) {
    return {
      ok: false,
      reason: `タグは 1 リンクにつき ${LINK_TAG_MAX_PER_LINK} 個までです`,
    };
  }

  // created_by_name は入れない。AuthorizedUser は Discord ID とロールしか
  // 持たず、表示名を引くには native_schedule_members への追加問い合わせが
  // 要る。タグは共有物で「誰が付けたか」を UI に出す予定も無いため NULL。
  const { error } = await supabase.from("tags").insert({
    target_type: "category_link",
    target_id: id,
    label: normalized,
  });
  if (error) return { ok: false, reason: dbError("タグ追加", error) };
  revalidateQuietly();
  return { ok: true };
}

/** リンクからタグを外す (B-1)。大文字小文字は無視して一致させる。 */
export async function removeCategoryLinkTagAction(
  linkId: string,
  label: string,
): Promise<WriteResult> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: "ADMIN ロールが必要です" };
  const id = linkId?.trim() ?? "";
  if (!UUID_RE.test(id)) return { ok: false, reason: "リンクの ID が不正です" };
  const normalized = normalizeLinkTag(label ?? "");
  if (!normalized) return { ok: false, reason: "タグを指定してください" };

  const supabase = createSupabaseServiceRoleClient();
  // ilike は % / _ をワイルドカードとして解釈するのでエスケープする
  // (ラベルは自由入力なので「100%」のような値が来得る)。
  const escaped = normalized.replace(/([\\%_])/g, "\\$1");
  const { error } = await supabase
    .from("tags")
    .delete()
    .eq("target_type", "category_link")
    .eq("target_id", id)
    .ilike("label", escaped);
  if (error) return { ok: false, reason: dbError("タグ削除", error) };
  revalidateQuietly();
  return { ok: true };
}
