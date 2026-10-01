import "server-only";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import {
  CRON_ALERT_ENABLED_KEY,
  cronStatusKey,
  nextCronStatus,
  parseCronStatus,
  shouldAlertCron,
  type CronJob,
  type CronOutcome,
} from "@/lib/cron-status";

/**
 * 自動処理の実行結果を記録する (2026-10-01 監査 F-2)。cron の route が
 * 応答を返す直前に呼ぶ。
 *
 * **記録の失敗で cron 本体を失敗させない** (best-effort)。DB に書けなくても
 * route の応答はそのまま返す。失敗に変わった最初の 1 回だけ、設定で ON に
 * なっていれば Discord 通知と同じチャンネルへ 1 行流す。
 */

/** Discord に流す名前 (日本語。Discord 投稿は日本語固定の運用)。 */
const JOB_LABEL_JA: Record<CronJob, string> = {
  "import-discord": "Discord 取り込み",
  "fflogs-sync": "FFLogs 同期",
  "snapshot-schedule": "スケジュールのスナップショット",
  "attendance-reminder": "出欠の催促",
  "notify-native-schedule": "開催確定の通知",
};

const NOTIFY_CHANNEL_KEY = "native_schedule_discord_notify_channel_id";

export async function recordCronRun(
  job: CronJob,
  outcome: CronOutcome,
  reason?: string | null,
): Promise<void> {
  try {
    const supabase = createSupabaseServiceRoleClient();
    const key = cronStatusKey(job);
    const { data: rows } = await supabase
      .from("app_settings")
      .select("key, value")
      .in("key", [key, CRON_ALERT_ENABLED_KEY, NOTIFY_CHANNEL_KEY]);
    const byKey = new Map(
      ((rows ?? []) as Array<{ key: string; value: string | null }>).map((r) => [
        r.key,
        r.value,
      ]),
    );
    const prev = parseCronStatus(byKey.get(key) ?? null);
    const next = nextCronStatus(prev, { outcome, reason }, new Date().toISOString());
    const { error } = await supabase
      .from("app_settings")
      .upsert({ key, value: JSON.stringify(next) }, { onConflict: "key" });
    if (error) {
      console.warn("[cron-status] write failed", job, error.message);
    }

    if (!shouldAlertCron(next)) return;
    if ((byKey.get(CRON_ALERT_ENABLED_KEY) ?? "") !== "true") return;
    const botToken = process.env.DISCORD_BOT_TOKEN?.trim();
    const channelId = (byKey.get(NOTIFY_CHANNEL_KEY) ?? "").trim();
    if (!botToken || !channelId) return;
    const content =
      `⚠ 自動処理「${JOB_LABEL_JA[job]}」が失敗しました` +
      (next.reason ? `: ${next.reason}` : "") +
      "\n設定 → 自動処理 で最終実行を確認できます (同じ失敗が続く間は再通知しません)";
    const res = await fetch(
      `https://discord.com/api/v10/channels/${channelId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bot ${botToken}`,
          "Content-Type": "application/json",
          "User-Agent": "RaidRepositoryBot/0.1",
        },
        body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!res.ok) {
      console.warn("[cron-status] alert post failed", job, res.status);
    }
  } catch (err) {
    console.warn("[cron-status] record failed", job, String(err));
  }
}
