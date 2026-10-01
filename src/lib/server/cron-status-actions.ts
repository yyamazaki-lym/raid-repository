"use server";

import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { fetchAppSettings } from "@/lib/supabase/app-settings";
import { assertAdminResult } from "./auth";
import { dbError } from "./db-error";
import {
  CRON_ALERT_ENABLED_KEY,
  CRON_JOBS,
  cronStatusKey,
  parseCronStatus,
  type CronJob,
  type CronStatus,
} from "@/lib/cron-status";

/**
 * 設定ダイアログの「自動処理」節 (2026-10-01 監査 F-2)。admin のみ。
 *
 * 通知先チャンネルは練習ログ通知と同じく、Discord 通知 (開催確定) の
 * チャンネル設定を使い回す。ここには ON/OFF だけを持つ。
 */

const NOTIFY_CHANNEL_KEY = "native_schedule_discord_notify_channel_id";

export async function getCronStatusAction(): Promise<
  | {
      ok: true;
      jobs: Array<{ job: CronJob; status: CronStatus | null }>;
      alertEnabled: boolean;
      /** 通知先チャンネルが設定されているか (無いと ON にしても届かない)。 */
      alertChannelSet: boolean;
      /** 判定に使う「今」(server 時刻、ISO)。 */
      now: string;
    }
  | { ok: false; reason: string }
> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: "ADMIN ロールが必要です" };
  const settings = await fetchAppSettings([
    ...CRON_JOBS.map(cronStatusKey),
    CRON_ALERT_ENABLED_KEY,
    NOTIFY_CHANNEL_KEY,
  ]);
  return {
    ok: true,
    jobs: CRON_JOBS.map((job) => ({
      job,
      status: parseCronStatus(settings[cronStatusKey(job)]),
    })),
    alertEnabled: settings[CRON_ALERT_ENABLED_KEY] === "true",
    alertChannelSet: Boolean((settings[NOTIFY_CHANNEL_KEY] ?? "").trim()),
    now: new Date().toISOString(),
  };
}

export async function setCronAlertEnabledAction(
  enabled: boolean,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: "ADMIN ロールが必要です" };
  const supabase = createSupabaseServiceRoleClient();
  const { error } = await supabase
    .from("app_settings")
    .upsert(
      { key: CRON_ALERT_ENABLED_KEY, value: enabled ? "true" : "false" },
      { onConflict: "key" },
    );
  if (error) return { ok: false, reason: dbError("通知設定保存", error) };
  return { ok: true };
}
