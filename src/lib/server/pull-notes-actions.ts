"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { requireDiscordMember } from "./auth";
import { userIsAdmin } from "./admin-roles";
import {
  isPullNoteScope,
  isPullNoteTagId,
  type PullNote,
  type PullNoteScope,
} from "@/lib/logs/pull-note-tags";
// 読み取りと共有ヘルパは素のモジュール側 (Server Component から直接呼ぶため)。
import {
  fetchCategoryPullNotes,
  toPullNote,
  type CategoryPullNotesResult,
  type NoteRow,
} from "./pull-notes-read";

/**
 * ミス注釈 (W-7、2026-09-08) の読み書き。
 *
 * ## 誰が書けるか
 *
 * - `scope='team'` (既定): **固定のメンバーなら誰でも**。「なぜ崩れたか」は
 *   その場に居た人が一番分かるので、admin に絞ると付かなくなる。
 * - `scope='self'`: **本人が自分に付けるときだけ。** `discord_user_id` は
 *   引数で受けず、**呼び出した本人の ID を server 側で埋める** —
 *   他人に個人タグを付ける経路を構造から無くすため
 *   (調査ノート W-7 の「個人責任の可視化は雰囲気悪化の恐れ」への回答)。
 *
 * ## 誰が消せるか
 *
 * 自分が付けたもの、または admin。付けた人以外が黙って消せると
 * 「無かったことにする」が起きる。
 *
 * ## なぜ service role か
 *
 * `fflogs_pull_notes` は RLS 有効 + policy 0 本 (schema.sql 6b-10 / 7 章)。
 * 「誰がどの pull に何のタグを付けたか」を公開 anon key で列挙されると、
 * それ自体が個人責任の可視化になる。読み書きの権限判定をこの層に集約する。
 */

const NOTE_MAX = 200;

export type PullNotesResult =
  | { ok: true; notes: PullNote[]; viewerId: string; isAdmin: boolean }
  | { ok: false; reason: string };

/** pull 1 本ぶんの注釈 (展開行が開いたときに引く)。 */
export async function fetchPullNotesAction(
  reportCode: string,
  fightId: number,
): Promise<PullNotesResult> {
  const user = await requireDiscordMember();
  const code = (reportCode ?? "").trim();
  if (!/^[A-Za-z0-9]{8,64}$/.test(code) || !Number.isInteger(fightId)) {
    return { ok: false, reason: "pull の指定が不正です" };
  }
  try {
    const db = createSupabaseServiceRoleClient();
    const { data, error } = await db
      .from("fflogs_pull_notes")
      .select(
        "id, report_code, fight_id, tag, scope, discord_user_id, note, created_by_id, created_at",
      )
      .eq("report_code", code)
      .eq("fight_id", fightId)
      .order("created_at", { ascending: true });
    if (error) return { ok: false, reason: "注釈を取得できませんでした" };
    return {
      ok: true,
      notes: ((data ?? []) as NoteRow[]).map(toPullNote),
      viewerId: user.discordId,
      isAdmin: userIsAdmin(user.roles),
    };
  } catch (e) {
    console.warn("[pull-notes] fetch failed:", e);
    return { ok: false, reason: "注釈を取得できませんでした" };
  }
}

export type AddPullNoteInput = {
  reportCode: string;
  fightId: number;
  categoryId: string | null;
  tag: string;
  scope: PullNoteScope;
  note?: string | null;
};

export async function addPullNoteAction(
  input: AddPullNoteInput,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const user = await requireDiscordMember();
  // 公開デモの匿名ゲストは共有 ID を持つので、service role 経路で
  // 書けてしまわないよう弾く (他の service role Server Action と同じ扱い)。
  if (user.isDemoGuest) {
    return { ok: false, reason: "デモ表示中は変更できません" };
  }
  const code = (input.reportCode ?? "").trim();
  if (!/^[A-Za-z0-9]{8,64}$/.test(code) || !Number.isInteger(input.fightId)) {
    return { ok: false, reason: "pull の指定が不正です" };
  }
  if (!isPullNoteTagId(input.tag)) {
    return { ok: false, reason: "タグの指定が不正です" };
  }
  if (!isPullNoteScope(input.scope)) {
    return { ok: false, reason: "帰属の指定が不正です" };
  }
  const note = (input.note ?? "").trim();
  if (note.length > NOTE_MAX) {
    return { ok: false, reason: `一言は ${NOTE_MAX} 文字以内で入力してください` };
  }
  const categoryId =
    input.categoryId && /^[0-9a-f-]{36}$/i.test(input.categoryId)
      ? input.categoryId
      : null;

  try {
    const db = createSupabaseServiceRoleClient();
    const { error } = await db.from("fflogs_pull_notes").insert({
      report_code: code,
      fight_id: input.fightId,
      category_id: categoryId,
      tag: input.tag,
      scope: input.scope,
      // ⚠ 個人タグの相手は **引数で受け取らない**。呼び出した本人の ID を
      // ここで埋めるので、他人に個人タグを付ける経路が存在しない。
      discord_user_id: input.scope === "self" ? user.discordId : null,
      note: note || null,
      created_by_id: user.discordId,
    });
    if (error) {
      // 同じ pull に同じタグを二重に付けた (式 UNIQUE 違反) は「既にある」。
      if (error.code === "23505") {
        return { ok: false, reason: "そのタグは既に付いています" };
      }
      console.warn("[pull-notes] insert failed:", error.message);
      return { ok: false, reason: "注釈を保存できませんでした" };
    }
    try {
      revalidatePath("/");
    } catch {
      // best-effort
    }
    return { ok: true };
  } catch (e) {
    console.warn("[pull-notes] insert failed:", e);
    return { ok: false, reason: "注釈を保存できませんでした" };
  }
}

export async function deletePullNoteAction(
  id: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const user = await requireDiscordMember();
  // 公開デモの匿名ゲストは共有 ID を持つので、service role 経路で
  // 書けてしまわないよう弾く (他の service role Server Action と同じ扱い)。
  if (user.isDemoGuest) {
    return { ok: false, reason: "デモ表示中は変更できません" };
  }
  const isAdmin = userIsAdmin(user.roles);
  if (!/^[0-9a-f-]{36}$/i.test(id ?? "")) {
    return { ok: false, reason: "注釈の指定が不正です" };
  }
  try {
    const db = createSupabaseServiceRoleClient();
    // 自分が付けたもの or admin だけ。付けた人以外が黙って消せると
    // 「無かったことにする」が起きる。
    let q = db.from("fflogs_pull_notes").delete().eq("id", id);
    if (!isAdmin) q = q.eq("created_by_id", user.discordId);
    const { data, error } = await q.select("id");
    if (error) {
      console.warn("[pull-notes] delete failed:", error.message);
      return { ok: false, reason: "注釈を削除できませんでした" };
    }
    if (!data || data.length === 0) {
      return { ok: false, reason: "自分が付けた注釈だけ削除できます" };
    }
    try {
      revalidatePath("/");
    } catch {
      // best-effort
    }
    return { ok: true };
  } catch (e) {
    console.warn("[pull-notes] delete failed:", e);
    return { ok: false, reason: "注釈を削除できませんでした" };
  }
}

export type { CategoryPullNotesResult } from "./pull-notes-read";

/**
 * コンテンツ単位の注釈を Server Action として引く。
 *
 * ⚠ 初期表示は `logs/page.tsx` が `fetchCategoryPullNotes` を**サーバーで
 * 直接呼ぶ** (2026-09-09)。以前はカードが mount 後にこれを呼んでいたため、
 * 練習ログを開くたびに往復 1 本が余計に走っていた。この Server Action は
 * 注釈を足した / 消した後の再取得のために残してある。
 */
export async function fetchCategoryPullNotesAction(
  categoryId: string,
): Promise<CategoryPullNotesResult> {
  return fetchCategoryPullNotes(categoryId);
}
