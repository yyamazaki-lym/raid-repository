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
const PULL_NOTES_LIMIT = 400;

type NoteRow = {
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

function toPullNote(r: NoteRow): PullNote {
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

export type CategoryPullNotesResult =
  | { ok: true; notes: PullNote[]; truncated: boolean }
  | { ok: false; reason: string };

/**
 * コンテンツ単位の注釈 (傾向カード + Discord 用の本文)。
 *
 * 上限 400 件で打ち切る。傾向を見るのに全件は要らず、打ち切りは画面に出す
 * (「直近 400 件」と書く) ので数字の意味が曖昧にならない。
 */
export async function fetchCategoryPullNotesAction(
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
