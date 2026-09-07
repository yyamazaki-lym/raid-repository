"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { fetchAppSetting } from "@/lib/supabase/app-settings";
import { assertAdminResult } from "./auth";
import { dbError } from "./db-error";
import {
  LOOT_WINDOW_WEEKS_KEY,
  LOOT_WINDOW_WEEKS_MAX,
  parseLootWindowWeeks,
} from "@/lib/loot-window-keys";

/**
 * 週制限の消化ウィンドウ設定 (W-33 ②、2026-09-07)。
 *
 * 8.0「白銀のワンダラー」(2027-01) でアラガントームストーンが 2 週管理に
 * なり、前週分を遡って取得できるようになる (調査ノート第 4 回 5-2)。
 * 「今週だけ開いている」前提だった消化チェックを 2 週に広げられるように、
 * 週数を `app_settings` の設定値にする。
 *
 * コードに「8.0 以降なら 2」と焼き込まないのは、8.0 の実装が 2027-01 で、
 * 仕様が実機で確認できるのがそれ以降になるため。既定は 1 (7.x の挙動)。
 */

/** 現在の設定値を読む (設定ダイアログの初期表示用)。 */
export async function getLootWindowWeeksAction(): Promise<
  { ok: true; weeks: number } | { ok: false; reason: string }
> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: "ADMIN ロールが必要です" };
  const raw = await fetchAppSetting(LOOT_WINDOW_WEEKS_KEY);
  return { ok: true, weeks: parseLootWindowWeeks(raw) };
}

/** 週数を保存する。1 (今週だけ) か 2 (今週 + 前週) のみ。 */
export async function setLootWindowWeeksAction(
  weeks: number,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: "ADMIN ロールが必要です" };
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > LOOT_WINDOW_WEEKS_MAX) {
    return {
      ok: false,
      reason: `消化ウィンドウは 1〜${LOOT_WINDOW_WEEKS_MAX} 週で指定してください`,
    };
  }
  // app_settings の書き込みは RLS の is_admin ポリシーで守られているが、
  // 読み取りを service role に寄せてある (app-settings.ts の H-2 対応) ので
  // 書き込みも同じ client で通す。admin gate は上で済んでいる。
  const supabase = createSupabaseServiceRoleClient();
  const { error } = await supabase
    .from("app_settings")
    .upsert(
      { key: LOOT_WINDOW_WEEKS_KEY, value: String(weeks) },
      { onConflict: "key" },
    );
  if (error) return { ok: false, reason: dbError("消化ウィンドウ保存", error) };
  try {
    // 消化チェックはカテゴリ配下の loot タブに出るので layout ごと落とす。
    revalidatePath("/category", "layout");
  } catch {
    // best-effort
  }
  return { ok: true };
}
