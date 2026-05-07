import "server-only";

import { fetchAppSetting } from "@/lib/supabase/app-settings";

import { postDiscordMessage, type DiscordEmbed } from "./discord-post";

/**
 * TODO #2 phase 3 (2026-05-08): native スケジュールの 4 イベント
 * (候補日追加 / 確定 / 中止 / 削除) を Discord channel に embed 投稿する dispatcher。
 *
 * channel ID は `app_settings.discord_schedule_channel_id` (sync mode で取り込み
 * チャンネルとして既登録) を流用。bot token は `DISCORD_BOT_TOKEN` を流用。
 *
 * 候補日追加時のみ `DISCORD_NOTIFY_MENTION_ROLE_ID` env が設定されていれば
 * ロール mention を発火する。確定 / 中止 / 削除は mention なし。
 *
 * いずれの関数も throw しない。失敗は内部で console.warn にとどめ、caller の
 * server action は ok 返却を維持する (fire-and-forget)。
 */

export type NativeSessionLike = {
  id: string;
  rawDate: string;
  parsedDate: string;
  startTime: string;
  endTime: string;
  dayOfWeek: string;
  note: string | null;
  status: "CANDIDATE" | "DECISION" | "CANCELLED";
};

const COLOR_CANDIDATE = 0x3498db; // 青
const COLOR_DECISION = 0x2ecc71; // 緑
const COLOR_CANCELLED = 0xe74c3c; // 赤
const COLOR_DELETED = 0x95a5a6; // 灰

const FOOTER_TEXT = "Raid Repository";

export async function notifyNativeSessionCreated(
  s: NativeSessionLike,
): Promise<void> {
  const fields: DiscordEmbed["fields"] = [
    { name: "日時", value: s.rawDate, inline: false },
  ];
  if (s.note) {
    fields.push({ name: "備考", value: s.note, inline: false });
  }
  const embed: DiscordEmbed = {
    title: "📅 新しい候補日が追加されました",
    color: COLOR_CANDIDATE,
    fields,
    footer: { text: FOOTER_TEXT },
    timestamp: new Date().toISOString(),
  };

  const roleId = process.env.DISCORD_NOTIFY_MENTION_ROLE_ID?.trim();
  await dispatch({
    embed,
    content: roleId ? `<@&${roleId}>` : undefined,
    allowedMentions: roleId ? { roles: [roleId] } : undefined,
    eventLabel: "create",
  });
}

export async function notifyNativeSessionDecided(
  s: NativeSessionLike,
): Promise<void> {
  await dispatch({
    embed: {
      title: "✅ 活動日が確定しました",
      color: COLOR_DECISION,
      fields: [{ name: "日時", value: s.rawDate, inline: false }],
      footer: { text: FOOTER_TEXT },
      timestamp: new Date().toISOString(),
    },
    eventLabel: "decision",
  });
}

export async function notifyNativeSessionCancelled(
  s: NativeSessionLike,
): Promise<void> {
  await dispatch({
    embed: {
      title: "❌ 活動が中止されました",
      color: COLOR_CANCELLED,
      fields: [{ name: "日時", value: s.rawDate, inline: false }],
      footer: { text: FOOTER_TEXT },
      timestamp: new Date().toISOString(),
    },
    eventLabel: "cancel",
  });
}

export async function notifyNativeSessionDeleted(
  s: NativeSessionLike,
): Promise<void> {
  await dispatch({
    embed: {
      title: "🗑️ 候補日が削除されました",
      color: COLOR_DELETED,
      fields: [{ name: "日時", value: s.rawDate, inline: false }],
      footer: { text: FOOTER_TEXT },
      timestamp: new Date().toISOString(),
    },
    eventLabel: "delete",
  });
}

async function dispatch(args: {
  embed: DiscordEmbed;
  content?: string;
  allowedMentions?: Parameters<typeof postDiscordMessage>[0]["allowedMentions"];
  eventLabel: string;
}): Promise<void> {
  const { embed, content, allowedMentions, eventLabel } = args;
  let channelId: string | null = null;
  try {
    channelId = await fetchAppSetting("discord_schedule_channel_id");
  } catch (e) {
    console.warn(
      `[native-schedule-notify] channel resolve failed (${eventLabel})`,
      String(e),
    );
    return;
  }
  if (!channelId) return;

  const result = await postDiscordMessage({
    channelId,
    embed,
    content,
    allowedMentions,
  });
  if (!result.ok) {
    if (
      result.reason === "no_token" ||
      result.reason === "no_channel" ||
      result.reason === "dry_run"
    ) {
      return;
    }
    console.warn(
      `[native-schedule-notify] ${eventLabel} failed:`,
      result.reason,
      result.detail ?? "",
    );
  }
}
