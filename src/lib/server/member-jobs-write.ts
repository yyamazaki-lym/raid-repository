import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * ジョブ割り当ての書き込み (L-10、2026-09-09)。
 *
 * 本人の経路 (`my-profile-actions.ts`) と admin の経路
 * (`native-schedule-actions.ts` のメンバー一覧) の**両方から呼ぶ**ので、
 * `"use server"` ではない素のサーバーモジュールに置く
 * (`"use server"` ファイルは非 async の export を持てない — 定数を
 * 一緒に置けないため。`scripts/check-use-server-exports.mjs` が CI で見る)。
 */

/**
 * 1 つの範囲 (既定 / 1 コンテンツ) に入れられるジョブの上限。
 *
 * ⚠ ゲーム的な上限ではなく**入力の暴走を止めるための上限**。8 人固定で
 * 1 人が担当し得るジョブ数としては十分に広く、DB 側の CHECK では表せない
 * (行数の制約なので) ためアプリ側で見る。
 */
export const MAX_JOBS_PER_SCOPE = 8;

export type ReplaceMemberJobsResult =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * ある範囲のジョブを**置き換える** (差分ではない)。
 *
 * ⚠ **delete → insert の 2 文で、トランザクションは張らない。**
 * PostgREST 経由なので 1 文ずつになる。間で失敗するとその範囲が空
 * (= 未設定) になるが、値は本人がすぐ再保存できる 1 画面の設定でしかなく、
 * 部分的に混ざった状態 (古いジョブと新しいジョブが同居) より空の方が
 * 読み取り側で嘘をつかない。insert が失敗したら失敗として返す。
 *
 * ⚠ `category_id IS NULL` の削除は `.is()` を使う。`.eq("category_id", null)`
 * は PostgREST で `?category_id=eq.null` になり 1 行も消えない (SQL の
 * `= NULL` と同じで常に未知)。
 */
export async function replaceMemberJobs(
  db: SupabaseClient,
  input: { discordUserId: string; categoryId: string | null; jobs: string[] },
): Promise<ReplaceMemberJobsResult> {
  const { discordUserId, categoryId, jobs } = input;
  try {
    let del = db
      .from("native_schedule_member_jobs")
      .delete()
      .eq("discord_user_id", discordUserId);
    del = categoryId === null
      ? del.is("category_id", null)
      : del.eq("category_id", categoryId);
    const { error: delError } = await del;
    if (delError) {
      console.warn("[member-jobs] delete failed:", delError);
      return { ok: false, reason: "保存できませんでした" };
    }

    if (jobs.length > 0) {
      const { error: insError } = await db
        .from("native_schedule_member_jobs")
        .insert(
          jobs.map((job) => ({
            discord_user_id: discordUserId,
            category_id: categoryId,
            job,
          })),
        );
      if (insError) {
        console.warn("[member-jobs] insert failed:", insError);
        return { ok: false, reason: "保存できませんでした" };
      }
    }

    // 既定を変えたときは `native_schedule_members.job` にも先頭 1 件を
    // ミラーする。⚠ **正は割り当て表の側**で、この列は
    //   (a) 設定のメンバー一覧が 1 ジョブの `<select>` で表示する値
    //   (b) schema 5e-2 の移行が当たっていないデプロイでの読み取り fallback
    // のためだけに維持する。両方の書き込み経路 (本人 / admin) がここを
    // 通るので、片方だけ更新されて食い違うことはない。
    if (categoryId === null) {
      const { error: mirrorError } = await db
        .from("native_schedule_members")
        .update({ job: jobs[0] ?? null })
        .eq("discord_user_id", discordUserId);
      if (mirrorError) {
        // ミラーの失敗は表示の劣化でしかないので、保存自体は成功とする。
        console.warn("[member-jobs] mirror to members.job failed:", mirrorError);
      }
    }
    return { ok: true };
  } catch (e) {
    console.warn("[member-jobs] write failed:", e);
    return { ok: false, reason: "保存できませんでした" };
  }
}

/**
 * 本人の行がメンバー一覧に無いと FK 違反で書けないので、事前に見る。
 * 「何をすれば保存できるようになるか」を画面に出すため、理由を分ける。
 */
export async function memberRowExists(
  db: SupabaseClient,
  discordUserId: string,
): Promise<boolean> {
  const { data, error } = await db
    .from("native_schedule_members")
    .select("discord_user_id")
    .eq("discord_user_id", discordUserId)
    .maybeSingle();
  return !error && !!data;
}
