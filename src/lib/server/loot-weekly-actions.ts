"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { requireDiscordMember } from "./auth";
import { dbError } from "./db-error";
import { isLootWeeklyStatus, type LootWeeklyStatus } from "@/lib/loot-weekly";
import { isWeekStartString } from "@/lib/week-jst";

/**
 * 週制限の消化チェック (TODO #94 / A-4) の書き込み。
 *
 * **本人書き込みの通し方**: RLS は 7 章ループの admin-only のまま据え置き、
 * ここで service role を使って「呼び出し元の discord_id の行だけ」を
 * upsert する。`updateNativeScheduleMemberCommentAction` と同じ設計で、
 * member-writable な RLS 面 (= PostgREST 直叩きで全行書き換えできる面) を
 * 増やさないための選択。監査 M-1 (schedule_session_memos の所有者問題) と
 * 同種のリスクを新規に作らない。
 *
 * 他人の行は UI からは触れない (client に Discord ID を一切渡さないため)。
 * 「代わりにチェックする」導線が必要になったら、ロスターのキーを server 側で
 * 解決する専用 action を足す想定。
 */

type WriteResult = { ok: true } | { ok: false; reason: string };

const NOTE_MAX = 200;
const NAME_MAX = 100;

/** DB の CHECK (loot_weekly_checks_text_sane) と同じく制御文字を除去 + 長さ制限。 */
function sanitizeNote(note: string | null | undefined): string | null {
  if (note == null) return null;
  const cleaned = note.replace(/[\u0000-\u001F\u007F]/g, "").trim();
  return cleaned ? cleaned.slice(0, NOTE_MAX) : null;
}

/** 自分の今週の消化状態を設定する (非 admin メンバーも可)。 */
export async function setMyLootWeeklyStatusAction(input: {
  categoryId: string;
  weekStart: string;
  status: LootWeeklyStatus;
  /** 行が新規のときに使う表示名 (ロスター未登録の固定向け)。 */
  displayName?: string;
  note?: string | null;
}): Promise<WriteResult> {
  const member = await requireDiscordMember();
  // demo の匿名ゲストは固定 discord_id を持つので、service role 経路で
  // 書けてしまわないよう明示的に弾く (read-only 公開が前提)。
  if (member.isDemoGuest) {
    return { ok: false, reason: "デモ表示中は変更できません" };
  }
  if (!isWeekStartString(input.weekStart)) {
    return { ok: false, reason: "週の指定が不正です" };
  }
  if (!isLootWeeklyStatus(input.status)) {
    return { ok: false, reason: "状態の指定が不正です" };
  }

  const displayName = (input.displayName ?? "").trim().slice(0, NAME_MAX);
  const supabase = createSupabaseServiceRoleClient();
  const { error } = await supabase.from("loot_weekly_checks").upsert(
    {
      category_id: input.categoryId,
      week_start: input.weekStart,
      discord_user_id: member.discordId,
      display_name: displayName,
      status: input.status,
      note: sanitizeNote(input.note),
    },
    { onConflict: "category_id,week_start,discord_user_id" },
  );
  if (error) return { ok: false, reason: dbError("消化チェック更新", error) };
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
