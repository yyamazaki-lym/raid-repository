"use server";

import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { fetchAppSetting } from "@/lib/supabase/app-settings";
import { assertAdminResult } from "./auth";
import { dbError } from "./db-error";
import {
  FFLOGS_GUILD_ID_KEY,
  fflogsGuildIdError,
} from "@/lib/fflogs-guild-keys";
import {
  FFLOGS_REPORT_SOURCE_KEY,
  isFflogsReportSource,
  parseFflogsReportSource,
  type FflogsReportSource,
} from "@/lib/fflogs-report-source";

/**
 * FFLogs guild ID と「レポートの発見元」の読み書き (W-5、2026-09-07)。
 *
 * 発見元は 3 択 (`src/lib/fflogs-report-source.ts`):
 *   links … 従来どおり、貼られた URL からのみ (既定)
 *   guild … guild のレポート一覧も見る (guild ID が必要)
 *   user  … 接続アカウントのレポート一覧も見る (Public のみ)
 *
 * どこを見るのが正しいかは固定の運用で変わる (FFLogs 上に static = guild を
 * 作っているか、計測担当の個人アカウントで上げているか) ので、決め打ちに
 * せず選べる形にしている。
 */

export async function getFflogsGuildIdAction(): Promise<
  | { ok: true; guildId: string; source: FflogsReportSource }
  | { ok: false; reason: string }
> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: "ADMIN ロールが必要です" };
  const [raw, source] = await Promise.all([
    fetchAppSetting(FFLOGS_GUILD_ID_KEY),
    fetchAppSetting(FFLOGS_REPORT_SOURCE_KEY),
  ]);
  return {
    ok: true,
    guildId: (raw ?? "").trim(),
    source: parseFflogsReportSource(source),
  };
}

/** 発見元の保存。未知の値は受け付けない (設定を壊さない)。 */
export async function setFflogsReportSourceAction(
  source: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: "ADMIN ロールが必要です" };
  if (!isFflogsReportSource(source)) {
    return { ok: false, reason: "不正な発見元です" };
  }
  const supabase = createSupabaseServiceRoleClient();
  const { error } = await supabase
    .from("app_settings")
    .upsert({ key: FFLOGS_REPORT_SOURCE_KEY, value: source }, { onConflict: "key" });
  if (error) return { ok: false, reason: dbError("発見元 保存", error) };
  return { ok: true };
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
