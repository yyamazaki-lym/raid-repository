"use server";

import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { fetchAppSettings } from "@/lib/supabase/app-settings";
import { assertAdminResult } from "./auth";
import { dbError } from "./db-error";
import {
  LOGS_NOTIFY_KINDS,
  isLogsNotifyKind,
  logsNotifyKey,
  parseLogsNotifyEnabled,
  type LogsNotifyKind,
} from "@/lib/logs-notify";

/**
 * 練習ログのイベント通知の ON/OFF (W-35、2026-09-07)。
 *
 * 通知は **全部既定 OFF**。通知過多が調査ノート第 4 回 W-35 のデメリット欄
 * そのものなので、必要なものだけ管理者が ON にする形にしてある。
 *
 * 通知先チャンネルは native スケジュール通知の設定を使い回すので、ここには
 * チャンネル設定を持たない (設定を 2 つに分けても実運用では同じ ch に流す)。
 */

/** 種類ごとの ON/OFF。未設定は false。 */
export async function getLogsNotifySettingsAction(): Promise<
  | { ok: true; enabled: Record<LogsNotifyKind, boolean> }
  | { ok: false; reason: string }
> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: "ADMIN ロールが必要です" };
  const settings = await fetchAppSettings(LOGS_NOTIFY_KINDS.map(logsNotifyKey));
  const enabled = Object.fromEntries(
    LOGS_NOTIFY_KINDS.map((k) => [
      k,
      parseLogsNotifyEnabled(settings[logsNotifyKey(k)]),
    ]),
  ) as Record<LogsNotifyKind, boolean>;
  return { ok: true, enabled };
}

export async function setLogsNotifyEnabledAction(
  kind: string,
  enabled: boolean,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: "ADMIN ロールが必要です" };
  if (!isLogsNotifyKind(kind)) {
    return { ok: false, reason: "通知の種類が不正です" };
  }
  // 読み取りを service role に寄せてある (app-settings.ts の H-2 対応) ので
  // 書き込みも同じ client で通す。admin gate は上で済んでいる。
  const supabase = createSupabaseServiceRoleClient();
  const { error } = await supabase
    .from("app_settings")
    .upsert(
      { key: logsNotifyKey(kind), value: enabled ? "true" : "false" },
      { onConflict: "key" },
    );
  if (error) return { ok: false, reason: dbError("通知設定保存", error) };
  return { ok: true };
}
