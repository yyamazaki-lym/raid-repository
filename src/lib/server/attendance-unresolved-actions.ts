"use server";

import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { stillUnresolvedNames } from "@/lib/schedule/attendance-actuals";
import { assertAdminResult } from "./auth";

/**
 * 出席の自動突合で「ログに出たが、どのメンバーにも一致しなかった名前」の一覧
 * (2026-10-06、実機「出席サマリーが 0 日のまま」の調査から)。
 *
 * これまで名前は同期のトースト (最大 12 件) にしか出ず、見逃すと「ログ名」に
 * 何を入れればよいか分からなかった。`fflogs_attendance_unresolved` は同期が
 * 書き溜めている (W-6) ので、設定のメンバー一覧の下に出して、そのまま
 * メンバーの「ログ名」に割り当てられるようにする。
 *
 * - **admin だけ**。表は RLS 有効 + policy 0 本 (schema.sql 6b-9) なので
 *   service role で読み、可否はここで決める
 * - 今のメンバー一覧で一致する名前は外す。ログ名を保存した直後に、次の同期を
 *   待たずに一覧から消えるようにするため (表の行自体は次の同期が消す)
 */

export type UnresolvedLogName = {
  name: string;
  /** その名前が映っていた pull 数 (レポートごとの最大)。 */
  pulls: number;
  /** 最後に見た日 (YYYY-MM-DD)。分からなければ null。 */
  lastSessionDate: string | null;
};

/** 画面に出す上限 (多すぎると読まれない)。 */
const SHOW_LIMIT = 30;

export async function fetchUnresolvedLogNamesAction(): Promise<
  { ok: true; names: UnresolvedLogName[] } | { ok: false; reason: string }
> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: "ADMIN ロールが必要です" };
  try {
    const db = createSupabaseServiceRoleClient();
    const [unresolvedRes, membersRes] = await Promise.all([
      db
        .from("fflogs_attendance_unresolved")
        .select("character_name, pulls, last_session_date")
        .order("last_session_date", { ascending: false, nullsFirst: false })
        .order("character_name", { ascending: true })
        .limit(200),
      db
        .from("native_schedule_members")
        .select("discord_user_id, display_name, fflogs_character_name"),
    ]);
    const readError = unresolvedRes.error ?? membersRes.error;
    if (readError) {
      console.warn("[attendance-unresolved] read failed:", readError.message);
      return { ok: false, reason: "対応表に無い名前の取得に失敗しました" };
    }
    const rows = (unresolvedRes.data ?? []) as Array<{
      character_name: string;
      pulls: number | null;
      last_session_date: string | null;
    }>;
    const members = (
      (membersRes.data ?? []) as Array<{
        discord_user_id: string;
        display_name: string | null;
        fflogs_character_name: string | null;
      }>
    ).map((r) => ({
      discordUserId: r.discord_user_id,
      displayName: r.display_name ?? "",
      characterName: r.fflogs_character_name ?? null,
    }));
    // 突合と同じ規則で、今のメンバーに一致しない名前だけを残す。
    const names = stillUnresolvedNames(
      rows.map((r) => ({
        name: r.character_name.trim(),
        pulls: Math.max(0, Math.trunc(Number(r.pulls) || 0)),
        lastSessionDate: r.last_session_date ?? null,
      })),
      members,
    ).slice(0, SHOW_LIMIT);
    return { ok: true, names };
  } catch (e) {
    console.warn("[attendance-unresolved] failed:", e);
    return { ok: false, reason: "対応表に無い名前の取得に失敗しました" };
  }
}
