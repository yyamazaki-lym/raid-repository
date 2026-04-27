"use client";

import { createClient } from "@/lib/supabase/client";

/**
 * Client-side mutator for the shared schedule source URL.
 *
 * Writes to the Supabase `app_settings` table so every viewer of the固定
 * sees the same URL on their next page load (no per-browser cookie). The
 * server-side reader is in `lib/supabase/app-settings.ts`.
 *
 * Migration note: the previous version of this file persisted the URL in
 * a cookie + localStorage. Those values are now ignored — once a固定
 * member runs Save in the settings dialog, the DB takes over for everyone.
 */

const SETTING_KEY = "schedule_url";
const SCHEDULE_CHANNEL_KEY = "discord_schedule_channel_id";
const FFLOGS_USERNAME_KEY = "fflogs_username";

export async function setScheduleUrl(
  rawUrl: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const url = rawUrl.trim();
  if (!url) return { ok: false, reason: "URLを入力してください" };
  if (!/^https?:\/\//i.test(url)) {
    return { ok: false, reason: "http:// または https:// で始めてください" };
  }
  try {
    new URL(url);
  } catch {
    return { ok: false, reason: "URLの形式が正しくありません" };
  }

  const supabase = createClient();
  const { error } = await supabase
    .from("app_settings")
    .upsert({ key: SETTING_KEY, value: url }, { onConflict: "key" });
  if (error) return { ok: false, reason: error.message };
  return { ok: true };
}

export async function clearScheduleUrl(): Promise<
  { ok: true } | { ok: false; reason: string }
> {
  const supabase = createClient();
  const { error } = await supabase
    .from("app_settings")
    .delete()
    .eq("key", SETTING_KEY);
  if (error) return { ok: false, reason: error.message };
  return { ok: true };
}

/** Browser-side fetch — used by the settings dialog to prefill the form. */
export async function getScheduleUrlFromDb(): Promise<string | null> {
  const supabase = createClient();
  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", SETTING_KEY)
    .maybeSingle();
  return (data?.value as string | null | undefined) ?? null;
}

const SNOWFLAKE_RE = /^\d{17,20}$/;

/**
 * Channel ID for the Discord notification channel that posts daily
 * raid-session reminders. Used by `importDiscordScheduleHistory()` to
 * back-fill `schedule_past_sessions` from Discord history.
 *
 * Empty string clears the setting (sets value to NULL).
 */
export async function setDiscordScheduleChannelId(
  rawId: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const id = rawId.trim();
  if (!id) {
    // Clear it if blank.
    const supabase = createClient();
    const { error } = await supabase
      .from("app_settings")
      .delete()
      .eq("key", SCHEDULE_CHANNEL_KEY);
    if (error) return { ok: false, reason: error.message };
    return { ok: true };
  }
  if (!SNOWFLAKE_RE.test(id)) {
    return {
      ok: false,
      reason: "チャンネル ID は 17〜20 桁の数字です",
    };
  }
  const supabase = createClient();
  const { error } = await supabase
    .from("app_settings")
    .upsert({ key: SCHEDULE_CHANNEL_KEY, value: id }, { onConflict: "key" });
  if (error) return { ok: false, reason: error.message };
  return { ok: true };
}

export async function getDiscordScheduleChannelId(): Promise<string | null> {
  const supabase = createClient();
  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", SCHEDULE_CHANNEL_KEY)
    .maybeSingle();
  return (data?.value as string | null | undefined) ?? null;
}

/**
 * FFLogs username (the string identifier accepted by FFLogs API v1).
 * Distinct from the numeric profile id seen in URLs like
 * `/user/reports-list/70734` — the API needs the username string.
 *
 * Pasting a profile URL is also accepted; we extract the username
 * from the path. Empty string clears the setting.
 */
export async function setFflogsUsername(
  raw: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const cleaned = parseFflogsUsername(raw);
  if (!cleaned) {
    // Empty input clears the setting.
    if (!raw.trim()) {
      const supabase = createClient();
      const { error } = await supabase
        .from("app_settings")
        .delete()
        .eq("key", FFLOGS_USERNAME_KEY);
      if (error) return { ok: false, reason: error.message };
      return { ok: true };
    }
    return {
      ok: false,
      reason: "ユーザー名を抽出できませんでした",
    };
  }
  const supabase = createClient();
  const { error } = await supabase
    .from("app_settings")
    .upsert({ key: FFLOGS_USERNAME_KEY, value: cleaned }, { onConflict: "key" });
  if (error) return { ok: false, reason: error.message };
  return { ok: true };
}

export async function getFflogsUsername(): Promise<string | null> {
  const supabase = createClient();
  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", FFLOGS_USERNAME_KEY)
    .maybeSingle();
  return (data?.value as string | null | undefined) ?? null;
}

/**
 * Accepts either a bare username or a fflogs.com profile URL and
 * returns the bare username string.
 *
 * URL form: `https://(?:www|ja|en|de|fr).fflogs.com/user/reports-list/{id}/`
 * — note: the "id" in the URL is a numeric profile ID, NOT the API
 * username. We can't programmatically convert numeric → string here,
 * so for URL inputs we currently pass the numeric ID through and the
 * user just gets a clear API error if their ID isn't usable.
 */
function parseFflogsUsername(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!/fflogs\.com/i.test(trimmed)) {
    // Bare string — assume it's a username.
    return trimmed;
  }
  try {
    const u = new URL(trimmed);
    const match = u.pathname.match(/\/user\/reports-list\/([^/?]+)/);
    if (match?.[1]) return decodeURIComponent(match[1]);
    return null;
  } catch {
    return null;
  }
}
