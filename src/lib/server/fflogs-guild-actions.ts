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
  isFflogsAutoRoutes,
  parseFflogsReportSource,
  serializeFflogsReportSource,
  type FflogsAutoRoutes,
} from "@/lib/fflogs-report-source";

/**
 * FFLogs guild ID と「レポートの発見元」の読み書き
 * (W-5、2026-09-07 / L-4、2026-09-08)。
 *
 * 発見元は**経路ごとの ON/OFF** (`src/lib/fflogs-report-source.ts`):
 *   貼られた URL … 常時 ON。設定値に持たない (切ると台帳が空になる)
 *   guild        … guild のレポート一覧も見る (guild ID が必要)
 *   user         … 接続アカウントのレポート一覧も見る (Public のみ)
 *
 * どこを見るのが正しいかは固定の運用で変わる (FFLogs 上に static = guild を
 * 作っているか、計測担当の個人アカウントで上げているか、その両方か) ので、
 * 決め打ちにせず選べる形にしている。2026-09-07 版は排他 3 択だったが、
 * 実機で「guild にも個人にも上がっている」が普通だと分かったので独立
 * トグルにした (保存形は同じキーの CSV で後方互換)。
 */

export async function getFflogsGuildIdAction(): Promise<
  | { ok: true; guildId: string; routes: FflogsAutoRoutes }
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
    routes: parseFflogsReportSource(source),
  };
}

/**
 * 発見元 (自動発見の経路の集合) の保存。
 *
 * client から来る値なので、経路が全部そろった boolean の集合であることを
 * 見てから書く。欠けた経路を false と解釈すると、client 側の書き損じで
 * 設定が黙って OFF になる。保存形は `FFLOGS_AUTO_ROUTES` の順に固定した
 * CSV (空集合は空文字 = 従来の `links` と同じ挙動)。
 */
export async function setFflogsReportSourceAction(
  routes: unknown,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: "ADMIN ロールが必要です" };
  if (!isFflogsAutoRoutes(routes)) {
    return { ok: false, reason: "不正な発見元です" };
  }
  const supabase = createSupabaseServiceRoleClient();
  const { error } = await supabase.from("app_settings").upsert(
    {
      key: FFLOGS_REPORT_SOURCE_KEY,
      value: serializeFflogsReportSource(routes),
    },
    { onConflict: "key" },
  );
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
