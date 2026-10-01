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

const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** 制御文字を除去 + 長さ制限 (表示名用。空なら空文字)。 */
function sanitizeName(name: string | null | undefined): string {
  return (name ?? "").replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, NAME_MAX);
}

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
  // 2026-10-01 監査 S-8: 形の検査が無く、不正な文字列が service role の
  // upsert まで届いていた (FK で弾かれるがエラー文が出る)。
  if (!UUID_RE.test(input.categoryId ?? "")) {
    return { ok: false, reason: "コンテンツの指定が不正です" };
  }
  if (!isWeekStartString(input.weekStart)) {
    return { ok: false, reason: "週の指定が不正です" };
  }
  if (!isLootWeeklyStatus(input.status)) {
    return { ok: false, reason: "状態の指定が不正です" };
  }

  const supabase = createSupabaseServiceRoleClient();
  // 2026-10-01 監査 S-8: 表示名は以前は client の値をそのまま保存しており、
  // 他のメンバーの名前を名乗った行を作れた (表示側もこの列を優先していた)。
  // メンバー一覧に本人の行があればその表示名を server 側で使い、client の
  // 値はメンバー一覧に居ない人 (旧メンバー / 未登録) のときだけ使う。
  const { data: rosterRow } = await supabase
    .from("native_schedule_members")
    .select("display_name")
    .eq("discord_user_id", member.discordId)
    .maybeSingle();
  const rosterName = sanitizeName(
    (rosterRow as { display_name?: string } | null)?.display_name,
  );
  const displayName = rosterName || sanitizeName(input.displayName);
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
