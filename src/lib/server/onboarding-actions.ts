"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { requireDiscordMember } from "./auth";
import { userIsAdmin } from "./admin-roles";
import { isOnboardingStepId } from "@/lib/onboarding-steps";

/**
 * 学習パスの進捗 (B-3、2026-09-08) の読み書き。
 *
 * ## 可視範囲
 *
 * - **本人**: 自分のチェック (付ける / 外す)
 * - **幹部 (admin)**: 「何人が終わったか」の人数だけ
 *
 * ⚠ **誰が終わっていないかは返さない。** 攻略リンクの既読 (W-27) で
 * 「誰が未読かは幹部のみ」にしたのと違い、学習パスは**新規メンバーが
 * 追いかけられている状態**を作りやすい。人数だけで「まだ全員終わって
 * いない」は分かるので、名前は出さない。
 *
 * ## なぜ service role か
 *
 * `category_onboarding_steps` は RLS 有効 + policy 0 本
 * (schema.sql 6b-11 / 7 章)。誰がどこまで見たかを公開 anon key で
 * 列挙されると「進んでいない人」の可視化になる。
 */

export type OnboardingStateResult =
  | {
      ok: true;
      /** 自分が済にした手順 id。 */
      mine: string[];
      /** 手順 id → 済にしたメンバーの人数 (admin のみ。非 admin は空)。 */
      counts: Record<string, number>;
      isAdmin: boolean;
    }
  | { ok: false; reason: string };

export async function fetchOnboardingStateAction(
  categoryId: string,
): Promise<OnboardingStateResult> {
  const user = await requireDiscordMember();
  const isAdmin = userIsAdmin(user.roles);
  if (!/^[0-9a-f-]{36}$/i.test(categoryId ?? "")) {
    return { ok: false, reason: "コンテンツの指定が不正です" };
  }
  try {
    const db = createSupabaseServiceRoleClient();
    const { data, error } = await db
      .from("category_onboarding_steps")
      .select("discord_user_id, step")
      .eq("category_id", categoryId);
    if (error) return { ok: false, reason: "進捗を取得できませんでした" };
    const rows = (data ?? []) as Array<{
      discord_user_id: string;
      step: string;
    }>;
    const mine = rows
      .filter((r) => r.discord_user_id === user.discordId)
      .map((r) => r.step);
    const counts: Record<string, number> = {};
    if (isAdmin) {
      for (const r of rows) {
        counts[r.step] = (counts[r.step] ?? 0) + 1;
      }
    }
    return { ok: true, mine, counts, isAdmin };
  } catch (e) {
    console.warn("[onboarding] fetch failed:", e);
    return { ok: false, reason: "進捗を取得できませんでした" };
  }
}

/**
 * 自分のチェックを付ける / 外す。
 *
 * ⚠ **相手は引数で受け取らない。** 呼び出した本人の ID で書くので、
 * 他人の進捗を触る経路が存在しない (W-7 の個人タグと同じ形)。
 */
export async function setOnboardingStepAction(input: {
  categoryId: string;
  step: string;
  done: boolean;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const user = await requireDiscordMember();
  if (!/^[0-9a-f-]{36}$/i.test(input.categoryId ?? "")) {
    return { ok: false, reason: "コンテンツの指定が不正です" };
  }
  if (!isOnboardingStepId(input.step)) {
    return { ok: false, reason: "手順の指定が不正です" };
  }
  try {
    const db = createSupabaseServiceRoleClient();
    if (input.done) {
      const { error } = await db.from("category_onboarding_steps").upsert(
        {
          category_id: input.categoryId,
          discord_user_id: user.discordId,
          step: input.step,
        },
        { onConflict: "category_id,discord_user_id,step" },
      );
      if (error) return { ok: false, reason: "進捗を保存できませんでした" };
    } else {
      const { error } = await db
        .from("category_onboarding_steps")
        .delete()
        .eq("category_id", input.categoryId)
        .eq("discord_user_id", user.discordId)
        .eq("step", input.step);
      if (error) return { ok: false, reason: "進捗を保存できませんでした" };
    }
    try {
      revalidatePath("/");
    } catch {
      // best-effort
    }
    return { ok: true };
  } catch (e) {
    console.warn("[onboarding] write failed:", e);
    return { ok: false, reason: "進捗を保存できませんでした" };
  }
}
