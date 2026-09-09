import "server-only";

import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { requireDiscordMember } from "./auth";
import { isMemberRole, type MemberRole } from "@/lib/member-roles";
import { isJobKey, jobsForCategory, rolesOfJobs } from "@/lib/jobs";

/**
 * 自分のジョブ割り当て (L-10、2026-09-09)。
 *
 * 2026-09-09 実機報告「ロールは複数変わることもあるので、コンテンツごとに
 * 変更できたり複数指定できるようにしたい」への対応。L-8 の
 * `native_schedule_members.job` は 1 人 1 ジョブで、層ごとにジョブを変える
 * 実態を表せなかった。
 *
 * ## 返すもの
 *
 * - `defaults` … `category_id IS NULL` の行。どのコンテンツでも使う
 * - `byCategory` … コンテンツ別の上書き。**既定とは合併しない**
 *   (判定は `jobsForCategory`。理由はそちらの docstring)
 *
 * ⚠ **自分の行だけ。** admin でも他人のジョブはここから引けない
 * (他人のジョブを直すのは設定のメンバー一覧側の仕事)。
 *
 * ⚠ **旧 `job` 列への fallback を残す。** schema の 5e-2 節 (移行 INSERT)
 * が当たっていないデプロイでも動くように、割り当て行が 1 つも無いときだけ
 * 列の値を既定として扱う。移行が済めば行が入るので、この経路は通らない。
 */

export type MemberJobs = {
  /** 既定のジョブ (どのコンテンツでも)。 */
  defaults: string[];
  /** コンテンツ別の上書き (categoryId → ジョブ)。 */
  byCategory: Record<string, string[]>;
  displayName: string | null;
  /** 出席突合用のキャラクター名 (`fflogs_character_name`)。 */
  characterName: string | null;
  /**
   * ジョブが 1 つも無いときの手動指定ロール
   * (`native_schedule_members.role`)。ジョブを入れる前の固定を壊さない。
   */
  fallbackRole: MemberRole | null;
  /** メンバー一覧に自分の行があるか (無いとジョブを保存できない)。 */
  registered: boolean;
};

export const EMPTY_MEMBER_JOBS: MemberJobs = {
  defaults: [],
  byCategory: {},
  displayName: null,
  characterName: null,
  fallbackRole: null,
  registered: false,
};

export async function fetchMyJobs(): Promise<MemberJobs> {
  try {
    const user = await requireDiscordMember();
    const db = createSupabaseServiceRoleClient();
    // 1 往復ぶんにまとめる (メンバー行と割り当ては互いに依存しない)。
    const [memberRes, jobsRes] = await Promise.all([
      db
        .from("native_schedule_members")
        .select("display_name, role, job, fflogs_character_name")
        .eq("discord_user_id", user.discordId)
        .maybeSingle(),
      db
        .from("native_schedule_member_jobs")
        .select("category_id, job")
        .eq("discord_user_id", user.discordId),
    ]);
    if (memberRes.error || !memberRes.data) return EMPTY_MEMBER_JOBS;
    const member = memberRes.data as {
      display_name?: string | null;
      role?: string | null;
      job?: string | null;
      fflogs_character_name?: string | null;
    };

    const defaults: string[] = [];
    const byCategory: Record<string, string[]> = {};
    for (const row of (jobsRes.data ?? []) as Array<{
      category_id: string | null;
      job: string;
    }>) {
      // 未知のジョブ (拡張前に入った値など) は落とす — 混ぜると絞り込みが
      // 「ロール不明」で空になる。
      if (!isJobKey(row.job)) continue;
      if (row.category_id) {
        (byCategory[row.category_id] ??= []).push(row.job);
      } else {
        defaults.push(row.job);
      }
    }

    // 移行前のデプロイ向け fallback (上の docstring 参照)。
    if (
      defaults.length === 0 &&
      Object.keys(byCategory).length === 0 &&
      isJobKey(member.job)
    ) {
      defaults.push(member.job as string);
    }

    return {
      defaults,
      byCategory,
      displayName: member.display_name ?? null,
      characterName: member.fflogs_character_name ?? null,
      fallbackRole: isMemberRole(member.role) ? member.role : null,
      registered: true,
    };
  } catch (e) {
    // 表示の劣化でしかないので、呼び出し元のページ描画は止めない。
    console.warn("[my-jobs] fetch failed:", e);
    return EMPTY_MEMBER_JOBS;
  }
}

/**
 * そのコンテンツでの「自分のジョブ」と「自分のロール」。
 *
 * ロールは**ジョブから導出したもの優先**で、ジョブが 1 つも無ければ
 * 手動指定の `role` 1 件に落ちる。
 */
export function resolveMyJobsFor(
  jobs: MemberJobs,
  categoryId: string | null,
): { jobs: string[]; roles: MemberRole[] } {
  const effective = jobsForCategory(jobs, categoryId);
  const roles = rolesOfJobs(effective);
  if (roles.length === 0 && jobs.fallbackRole) {
    return { jobs: effective, roles: [jobs.fallbackRole] };
  }
  return { jobs: effective, roles };
}
