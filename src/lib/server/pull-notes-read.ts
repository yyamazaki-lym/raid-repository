import "server-only";

import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { requireDiscordMember } from "./auth";
import { isPullNoteScope, type PullNote } from "@/lib/logs/pull-note-tags";

/**
 * ミス注釈 (W-7) の読み取り (2026-09-09 に Server Action から分離)。
 *
 * ⚠ **Server Action ではない素のモジュール**にしてあるのは、練習ログの
 * Server Component から**初期値を直接読む**ため。以前は
 * `PullNotesCard` が mount 後に Server Action を呼んでいて、注釈が 0 件の
 * 固定でも**練習ログを開くたびに往復 1 本**走っていた。
 */

export const PULL_NOTES_LIMIT = 400;

export type NoteRow = {
  id: string;
  report_code: string;
  fight_id: number;
  tag: string;
  scope: string;
  discord_user_id: string | null;
  note: string | null;
  created_by_id: string | null;
  created_at: string;
};

export function toPullNote(r: NoteRow): PullNote {
  return {
    id: r.id,
    reportCode: r.report_code,
    fightId: r.fight_id,
    tag: r.tag,
    scope: isPullNoteScope(r.scope) ? r.scope : "team",
    discordUserId: r.discord_user_id ?? null,
    note: r.note ?? null,
    createdById: r.created_by_id ?? null,
    createdAt: r.created_at,
  };
}

export type CategoryPullNotesResult =
  | { ok: true; notes: PullNote[]; truncated: boolean }
  | { ok: false; reason: string };

/**
 * コンテンツ単位の注釈 (傾向カード + Discord 用の本文)。
 *
 * 上限 400 件で打ち切る。傾向を見るのに全件は要らず、打ち切りは画面に出す
 * (「直近 400 件」と書く) ので数字の意味が曖昧にならない。
 */
export async function fetchCategoryPullNotes(
  categoryId: string,
): Promise<CategoryPullNotesResult> {
  await requireDiscordMember();
  if (!/^[0-9a-f-]{36}$/i.test(categoryId ?? "")) {
    return { ok: false, reason: "コンテンツの指定が不正です" };
  }
  try {
    const db = createSupabaseServiceRoleClient();
    const { data, error } = await db
      .from("fflogs_pull_notes")
      .select(
        "id, report_code, fight_id, tag, scope, discord_user_id, note, created_by_id, created_at",
      )
      .eq("category_id", categoryId)
      .order("created_at", { ascending: false })
      .limit(PULL_NOTES_LIMIT + 1);
    if (error) return { ok: false, reason: "注釈を取得できませんでした" };
    const rows = (data ?? []) as NoteRow[];
    return {
      ok: true,
      notes: rows.slice(0, PULL_NOTES_LIMIT).map(toPullNote),
      truncated: rows.length > PULL_NOTES_LIMIT,
    };
  } catch (e) {
    console.warn("[pull-notes] category fetch failed:", e);
    return { ok: false, reason: "注釈を取得できませんでした" };
  }
}
