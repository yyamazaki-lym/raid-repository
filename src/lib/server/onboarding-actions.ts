"use server";

import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { requireDiscordMember } from "./auth";
import { isOnboardingStepId } from "@/lib/onboarding-steps";
// 読み取りは素のモジュール側にある (攻略情報タブの Server Component が
// 初期値を直接読むため)。型もそちらが正。
import {
  fetchOnboardingState,
  type OnboardingStateOk,
  type OnboardingStateResult,
} from "./onboarding-state";

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

export async function fetchOnboardingStateAction(
  categoryId: string,
): Promise<OnboardingStateResult> {
  return fetchOnboardingState(categoryId);
}

/**
 * 自分のチェックを付ける / 外す。
 *
 * ⚠ **相手は引数で受け取らない。** 呼び出した本人の ID で書くので、
 * 他人の進捗を触る経路が存在しない (W-7 の個人タグと同じ形)。
 */
export type SetOnboardingStepResult =
  | { ok: true; state: OnboardingStateOk | null }
  | { ok: false; reason: string };

export async function setOnboardingStepAction(input: {
  categoryId: string;
  step: string;
  done: boolean;
}): Promise<SetOnboardingStepResult> {
  const user = await requireDiscordMember();
  // 公開デモの匿名ゲストは共有 ID を持つので、service role 経路で
  // 書けてしまわないよう弾く (他の service role Server Action と同じ扱い)。
  if (user.isDemoGuest) {
    return { ok: false, reason: "デモ表示中は変更できません" };
  }
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
    // ⚠ **`revalidatePath("/")` は呼ばない** (2026-09-09)。
    //   * 学習パスが出るのは `/category/[slug]/strategy` と `/me` で、
    //     `revalidatePath("/")` が作るタグ (`_N_T_/` / `_N_T_/index`) は
    //     **どちらにも当たらない** — 狙った無効化はできていなかった
    //   * portal の全ルートは動的 (認証で cookie を読む) なのでページ HTML の
    //     キャッシュは無く、無効化する対象も無い。一方で Server Action が
    //     revalidate すると**そのページの RSC が再描画されてレスポンスに
    //     同梱される** (攻略情報タブの 11 本のクエリが再実行される)
    // 画面は下の `state` を受け取って即座に追いつく。
    //
    // 保存後の状態をここで返す (2026-09-09)。以前は画面側が
    // `setOnboardingStepAction` の完了を待ってから
    // `fetchOnboardingStateAction` を呼んでいて、**チェック 1 回で往復 2 本**
    // 直列になっていた。
    const state = await fetchOnboardingState(input.categoryId);
    return { ok: true, state: state.ok ? state : null };
  } catch (e) {
    console.warn("[onboarding] write failed:", e);
    return { ok: false, reason: "進捗を保存できませんでした" };
  }
}
