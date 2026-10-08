"use server";

import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { requireDiscordMember } from "./auth";
import { userIsAdmin } from "./admin-roles";
import { limitDemoGuest } from "./external-fetch-guard";
import {
  isPullNoteScope,
  isPullNoteTagId,
  type PullNote,
  type PullNoteScope,
} from "@/lib/logs/pull-note-tags";
// 読み取りと共有ヘルパは素のモジュール側 (Server Component から直接呼ぶため)。
import {
  fetchCategoryPullNotes,
  redactPullNotesForGuest,
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
/**
 * 1 人が 24 時間に付けられる注釈の数 (2026-10-07 セキュリティ精査 M-2)。
 * 練習 1 回 (数十 pull) に全部タグを付けても届かない値。上限が無いと、
 * fight_id を変えながら呼ぶだけで傾向カードと Discord 用の要約が偽の注釈で
 * 埋まった。⚠ "use server" のファイルなので export しない。
 */
const NOTES_PER_DAY_LIMIT = 200;
/**
 * 公開デモの匿名ゲストが pull 1 本ぶんの注釈を取れる回数 (IP ごと、2026-10-08)。
 * 練習ログの行を開くたびに 1 回なので、pull 詳細 (1 分 60 回) と同じにする。
 * ⚠ export しない。
 */
const DEMO_GUEST_NOTES_LIMIT = { limit: 60, windowMs: 60_000 };

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
  // 2026-10-08 (2026-10-07 セキュリティ精査の残り): 公開デモの匿名ゲストは
  // IP ごとに回数を絞る (service role の読み取りを回数の制限なく起こせた)。
  const limited = await limitDemoGuest(user, "pull-notes", DEMO_GUEST_NOTES_LIMIT);
  if (limited) return { ok: false, reason: limited };
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
    const notes = ((data ?? []) as NoteRow[]).map(toPullNote);
    return {
      ok: true,
      // 2026-10-01 監査 S-4: 公開デモのゲストには ID を伏せて返す。
      notes: user.isDemoGuest ? redactPullNotesForGuest(notes) : notes,
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
  /**
   * 呼び出し側が持つカテゴリ。⚠ 2026-10-07 (M-2) からは使わず、pull の行
   * (`fflogs_fights.category_id`) から取る (言い値で別のカテゴリに付けられたため)。
   */
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

  try {
    const db = createSupabaseServiceRoleClient();
    // 2026-10-07 セキュリティ精査 M-2: その pull が実在するかを確かめ、カテゴリは
    // その行から取る。以前はクライアントの言い値 (`input.categoryId`) をそのまま
    // 入れ、実在しない pull にも付けられた。
    const { data: fight, error: fightError } = await db
      .from("fflogs_fights")
      .select("category_id")
      .eq("report_code", code)
      .eq("fight_id", input.fightId)
      .maybeSingle();
    if (fightError) {
      console.warn("[pull-notes] fight lookup failed:", fightError.message);
      return { ok: false, reason: "注釈を保存できませんでした" };
    }
    if (!fight) {
      return { ok: false, reason: "その pull が見つかりません" };
    }
    const categoryId = (fight.category_id as string | null) ?? null;
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count, error: countError } = await db
      .from("fflogs_pull_notes")
      .select("id", { count: "exact", head: true })
      .eq("created_by_id", user.discordId)
      .gte("created_at", since);
    if (countError) {
      console.warn("[pull-notes] count failed:", countError.message);
      return { ok: false, reason: "注釈を保存できませんでした" };
    }
    if ((count ?? 0) >= NOTES_PER_DAY_LIMIT) {
      return {
        ok: false,
        reason: `注釈は 1 日 ${NOTES_PER_DAY_LIMIT} 件までです。時間をおいてから付けてください`,
      };
    }
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
    // 2026-10-07 セキュリティ精査: `revalidatePath("/")` は呼ばない。画面は
    // 注釈を取り直す (`fetchPullNotesAction`) ので不要で、呼ぶとメンバーが
    // 連打するたびに TOP の外部取得 (同期式のスケジュール) を捨てさせられた。
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
    // 2026-10-07 セキュリティ精査: `revalidatePath("/")` は呼ばない。画面は
    // 注釈を取り直す (`fetchPullNotesAction`) ので不要で、呼ぶとメンバーが
    // 連打するたびに TOP の外部取得 (同期式のスケジュール) を捨てさせられた。
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
