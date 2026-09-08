import "server-only";

import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { requireDiscordMember } from "./auth";
import { isMemberRole, type MemberRole } from "@/lib/member-roles";
import { roleOfJob } from "@/lib/jobs";

/**
 * 自分のメンバー行 (L-8、2026-09-08)。
 *
 * 軽減表の「自分のロール / 自分の担当」は **ジョブ**で列に当てるので、
 * ページ側で自分のジョブを知る必要がある。`/me` の `fetchMyDashboard` は
 * BiS や学習パスまで読むので、軽減表からはこの軽い読み取りだけを使う。
 *
 * ⚠ 返すのは**自分の行だけ**。他人のジョブは軽減表の絞り込みに要らない
 * (列に書かれているジョブ名で判定するので、他人が誰のジョブかは不要)。
 *
 * ロールは **ジョブから導出したもの優先**、ジョブ未設定なら手動指定の
 * `role` に落ちる (ジョブを入れる前の固定を壊さないため)。
 */

export type MyMember = {
  displayName: string | null;
  job: string | null;
  role: MemberRole | null;
  /** メンバー一覧に自分の行があるか (無いとジョブを保存できない)。 */
  registered: boolean;
};

export const EMPTY_MY_MEMBER: MyMember = {
  displayName: null,
  job: null,
  role: null,
  registered: false,
};

export async function fetchMyMember(): Promise<MyMember> {
  try {
    const user = await requireDiscordMember();
    const db = createSupabaseServiceRoleClient();
    const { data, error } = await db
      .from("native_schedule_members")
      .select("display_name, job, role")
      .eq("discord_user_id", user.discordId)
      .maybeSingle();
    if (error || !data) return EMPTY_MY_MEMBER;
    const r = data as {
      display_name?: string | null;
      job?: string | null;
      role?: string | null;
    };
    const job = r.job ?? null;
    return {
      displayName: r.display_name ?? null,
      job,
      role: roleOfJob(job) ?? (isMemberRole(r.role) ? r.role : null),
      registered: true,
    };
  } catch (e) {
    // 表示の劣化でしかないので、軽減表本体の描画は止めない。
    console.warn("[my-member] fetch failed:", e);
    return EMPTY_MY_MEMBER;
  }
}
