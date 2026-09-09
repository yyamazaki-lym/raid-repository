import "server-only";

import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { requireDiscordMember } from "./auth";
import { userIsAdmin } from "./admin-roles";

/**
 * 学習パス (B-3) の進捗の読み取り (2026-09-09 に Server Action から分離)。
 *
 * ⚠ **Server Action ではない素のモジュール**にしてあるのは、攻略情報タブの
 * Server Component から**初期値を直接読む**ため。以前は画面が mount 後に
 * `fetchOnboardingStateAction` を呼んでいて、**タブを開くたびに往復 1 本**
 * 余計に走っていた (しかも描画が 1 フレーム遅れる)。
 *
 * トグル後の再取得は `setOnboardingStepAction` が戻り値に載せるので、
 * 画面から Server Action として呼ぶ経路は互換のために残しているだけ。
 */

export type OnboardingStateOk = {
  ok: true;
  /** 自分が済にした手順 id。 */
  mine: string[];
  /** 手順 id → 済にしたメンバーの人数 (admin のみ。非 admin は空)。 */
  counts: Record<string, number>;
  isAdmin: boolean;
};

export type OnboardingStateResult =
  | OnboardingStateOk
  | { ok: false; reason: string };

export async function fetchOnboardingState(
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
