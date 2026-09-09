"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { requireDiscordMember } from "./auth";
import { isJobKey } from "@/lib/jobs";
import {
  memberRowExists,
  replaceMemberJobs,
  MAX_JOBS_PER_SCOPE,
} from "./member-jobs-write";

/**
 * 本人が自分のジョブを設定する (L-8 2026-09-08 / L-10 2026-09-09)。
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
 * (`lib/jobs.ts` の `roleOfJob` / `rolesOfJobs`)。
 *
 * ## L-10: 複数 + コンテンツ別
 *
 * 実機報告「ロールは複数変わることもあるので、コンテンツごとに変更できたり
 * 複数指定できるようにしたい」。保存先は `native_schedule_member_jobs`
 * (schema 5e-2 節) で、`categoryId = null` が既定、コンテンツ ID を渡すと
 * そのコンテンツの上書きになる。
 *
 * ## 書けるのは自分の行だけ
 *
 * ⚠ `discord_user_id = 自分` で固定する。admin であってもこの Server
 * Action から他人の行は触れない (他人のジョブを直すのは設定のメンバー
 * 一覧側の仕事)。
 *
 * ## なぜ service role か
 *
 * `native_schedule_member_jobs` は RLS 有効 + policy 0 本 (schema 7 章) で、
 * ユーザースコープのクライアントからは読み書きできない。ここは
 * 「自分の行だけ」を条件に固定した上で service role を使い、**絞り込み
 * 条件をサーバー側から動かせないようにする**。
 */

export type SetMyJobsResult =
  | { ok: true; jobs: string[] }
  | { ok: false; reason: string };

const UUID_RE = /^[0-9a-f-]{36}$/i;

export async function setMyJobsAction(input: {
  /** null = 既定 (どのコンテンツでも)。 */
  categoryId: string | null;
  /** この範囲のジョブ (空配列 = 未設定に戻す)。 */
  jobs: string[];
}): Promise<SetMyJobsResult> {
  const user = await requireDiscordMember();
  // 公開デモの匿名ゲストは共有 ID を持つので、service role 経路で
  // 書けてしまわないよう弾く (他の service role Server Action と同じ扱い)。
  if (user.isDemoGuest) {
    return { ok: false, reason: "デモ表示中は変更できません" };
  }

  const categoryId = input.categoryId ?? null;
  if (categoryId !== null && !UUID_RE.test(categoryId)) {
    return { ok: false, reason: "コンテンツの指定が不正です" };
  }

  // 重複を畳み、未知のジョブは弾く (schema は長さと文字種しか見ない)。
  const jobs = [...new Set(input.jobs ?? [])];
  if (jobs.some((j) => !isJobKey(j))) {
    return { ok: false, reason: "知らないジョブです" };
  }
  if (jobs.length > MAX_JOBS_PER_SCOPE) {
    return {
      ok: false,
      reason: `ジョブは ${MAX_JOBS_PER_SCOPE} 件までにしてください`,
    };
  }

  const db = createSupabaseServiceRoleClient();
  // メンバー一覧に行が無いと FK 違反になるので、先に見て理由を分ける
  // (「保存できませんでした」では何をすればいいか分からない)。
  if (!(await memberRowExists(db, user.discordId))) {
    return {
      ok: false,
      reason:
        "メンバー一覧にあなたの行がありません (幹部に追加を依頼してください)",
    };
  }
  const r = await replaceMemberJobs(db, {
    discordUserId: user.discordId,
    categoryId,
    jobs,
  });
  if (!r.ok) return r;

  // ⚠ **`revalidatePath("/category", "layout")` は呼ばない。**
  // 2026-09-09 のパフォーマンス調査で分かったこと:
  //   * portal の全ルートは動的 (`cookies()` 経由の認証があるため
  //     プリレンダーが 1 枚も無い) ので、ページ HTML のキャッシュは
  //     そもそも無く、無効化する対象が無い
  //   * 一方でこの呼び出しは `_N_T_/category/layout` の softTag を
  //     expire させるため、**軽減表 / ロットが使う Google Sheets の
  //     Data Cache (`sheet-table.ts` の `unstable_cache`、TTL 60 秒) を
  //     全カテゴリぶん捨てる**。ジョブを保存するたびに、次に軽減表を
  //     開いた人が Sheets への往復 (最大 6 秒) を待つことになる
  // 画面側は保存した値を draft として持つので、表示は即座に追いつく。
  revalidatePath("/me");
  return { ok: true, jobs };
}
