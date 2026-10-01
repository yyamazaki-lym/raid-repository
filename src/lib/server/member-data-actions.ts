"use server";

import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { assertAdminResult } from "./auth";
import { dbError } from "./db-error";
import {
  MEMBER_DATA_KEY_RE,
  MEMBER_DATA_TARGETS,
  type MemberDataCounts,
} from "@/lib/member-data";

/**
 * メンバー削除のときに残る関連データの件数と、管理者が選んだときの整理
 * (2026-10-01 監査 F-4)。admin のみ。対象と方針は `@/lib/member-data`。
 *
 * service role で読み書きする (表ごとの RLS は本人 / admin 向けで、
 * 他人の行をまとめて数えたり消したりする経路が無いため)。admin 判定は
 * 先頭で済ませる。
 */

export async function getMemberDataCountsAction(
  discordUserId: string,
): Promise<{ ok: true; counts: MemberDataCounts } | { ok: false; reason: string }> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: "ADMIN ロールが必要です" };
  const id = discordUserId?.trim();
  if (!id || !MEMBER_DATA_KEY_RE.test(id)) {
    return { ok: false, reason: "メンバーキーが不正です" };
  }
  const supabase = createSupabaseServiceRoleClient();
  const results = await Promise.all(
    MEMBER_DATA_TARGETS.map(async (t) => {
      let q = supabase
        .from(t.table)
        .select("*", { count: "exact", head: true })
        .eq(t.column, id);
      if (t.filter) q = q.eq(t.filter.column, t.filter.value);
      const { count, error } = await q;
      return { id: t.id, count: count ?? 0, error };
    }),
  );
  const failed = results.find((r) => r.error);
  if (failed) return { ok: false, reason: dbError("メンバー削除", failed.error) };
  return {
    ok: true,
    counts: Object.fromEntries(results.map((r) => [r.id, r.count])) as MemberDataCounts,
  };
}

/**
 * その人だけの記録を消し、共有している記録からは ID を外す。メンバー行
 * そのものは消さない (呼び出し側が続けて削除 Action を呼ぶ)。途中で失敗
 * したら止める (やり直せば残りから続く — どの操作も冪等)。
 */
export async function purgeMemberPersonalDataAction(
  discordUserId: string,
): Promise<{ ok: true; affected: number } | { ok: false; reason: string }> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: "ADMIN ロールが必要です" };
  const id = discordUserId?.trim();
  if (!id || !MEMBER_DATA_KEY_RE.test(id)) {
    return { ok: false, reason: "メンバーキーが不正です" };
  }
  const supabase = createSupabaseServiceRoleClient();
  let affected = 0;
  for (const t of MEMBER_DATA_TARGETS) {
    let q =
      t.action === "delete"
        ? supabase.from(t.table).delete({ count: "exact" }).eq(t.column, id)
        : supabase
            .from(t.table)
            .update({ [t.column]: null }, { count: "exact" })
            .eq(t.column, id);
    if (t.filter) q = q.eq(t.filter.column, t.filter.value);
    const { count, error } = await q;
    if (error) return { ok: false, reason: dbError("メンバー削除", error) };
    affected += count ?? 0;
  }
  return { ok: true, affected };
}
