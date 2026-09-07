"use server";

import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { fetchAppSetting } from "@/lib/supabase/app-settings";
import { assertAdminResult } from "./auth";
import { dbError } from "./db-error";
import {
  FFLOGS_GUILD_ID_KEY,
  fflogsGuildIdError,
} from "@/lib/fflogs-guild-keys";

/**
 * FFLogs guild ID の読み書き (W-5 の前段、2026-09-07)。
 *
 * この値は **まだ取り込みに使われない**。W-5 (guild からのレポート自動
 * 発見) は固定内で「レポートを guild に上げる」運用に揃えてから実装する
 * 前提なので、先に記録場所だけを用意している。
 */

export async function getFflogsGuildIdAction(): Promise<
  { ok: true; guildId: string } | { ok: false; reason: string }
> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: "ADMIN ロールが必要です" };
  const raw = await fetchAppSetting(FFLOGS_GUILD_ID_KEY);
  return { ok: true, guildId: (raw ?? "").trim() };
}

export async function setFflogsGuildIdAction(
  guildId: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: "ADMIN ロールが必要です" };
  const v = (guildId ?? "").trim();
  if (fflogsGuildIdError(v)) {
    return {
      ok: false,
      reason: "guild ID は数字のみで入力してください (URL ではありません)",
    };
  }
  const supabase = createSupabaseServiceRoleClient();
  const { error } = await supabase
    .from("app_settings")
    .upsert({ key: FFLOGS_GUILD_ID_KEY, value: v }, { onConflict: "key" });
  if (error) return { ok: false, reason: dbError("guild ID 保存", error) };
  return { ok: true };
}
