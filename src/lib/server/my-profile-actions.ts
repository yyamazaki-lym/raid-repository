"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { requireDiscordMember } from "./auth";
import { isJobKey } from "@/lib/jobs";

/**
 * 本人が自分のプロフィール (ジョブ) を設定する (L-8、2026-09-08)。
 *
 * ## なぜ本人が触れる必要があるのか
 *
 * 実機報告 L-8「ロール設定が非常に分かりにくい」。ロールの編集 UI は
 * **設定 → メンバー一覧の中だけ**にあり、しかも `canEdit` (admin) が
 * 無いと触れなかった。つまり **本人が自分のロールを設定する経路が
 * 存在しなかった** — 軽減表の「自分のロールだけ」を使うために admin に
 * 頼む必要がある状態だった。
 *
 * ジョブを本人が選べるようにして、ロールは**ジョブから導出**する
 * (`lib/jobs.ts` の `roleOfJob`)。設定は 1 つ減り、しかも軽減表の
 * 列 (シートのジョブ名の行) に当たるようになる。
 *
 * ## 書けるのは自分の行だけ
 *
 * ⚠ `discord_user_id = 自分` で **1 行だけ**更新する。admin であっても
 * この Server Action から他人の行は触れない (他人のジョブを直すのは
 * 設定のメンバー一覧側の仕事)。
 *
 * ## なぜ service role か
 *
 * `native_schedule_members` の更新は admin 向けの policy しか無く、
 * 一般メンバーのユーザースコープのクライアントでは silent に 0 行更新に
 * なる。ここは「自分の行だけ」を条件に固定した上で service role を使い、
 * **絞り込み条件をサーバー側から動かせないようにする**。
 */

export type SetMyJobResult =
  | { ok: true; job: string | null }
  | { ok: false; reason: string };

export async function setMyJobAction(job: string | null): Promise<SetMyJobResult> {
  const user = await requireDiscordMember();
  // 公開デモの匿名ゲストは共有 ID を持つので、service role 経路で
  // 書けてしまわないよう弾く (他の service role Server Action と同じ扱い)。
  if (user.isDemoGuest) {
    return { ok: false, reason: "デモ表示中は変更できません" };
  }
  const value = job === null || job === "" ? null : job;
  if (value !== null && !isJobKey(value)) {
    return { ok: false, reason: "知らないジョブです" };
  }

  try {
    const db = createSupabaseServiceRoleClient();
    const { data, error } = await db
      .from("native_schedule_members")
      .update({ job: value })
      .eq("discord_user_id", user.discordId)
      .select("discord_user_id");
    if (error) {
      console.warn("[my-profile] job update failed:", error);
      return { ok: false, reason: "保存できませんでした" };
    }
    if (!data || data.length === 0) {
      // メンバー一覧に自分の行が無い固定 (同期式 / 未登録) では書けない。
      // 何をすれば書けるようになるかを画面に出す。
      return {
        ok: false,
        reason: "メンバー一覧にあなたの行がありません (幹部に追加を依頼してください)",
      };
    }
    // 軽減表と /me はサーバーでジョブを読むので、両方を作り直させる。
    revalidatePath("/me");
    revalidatePath("/category", "layout");
    return { ok: true, job: value };
  } catch (e) {
    console.warn("[my-profile] job update failed:", e);
    return { ok: false, reason: "保存できませんでした" };
  }
}
