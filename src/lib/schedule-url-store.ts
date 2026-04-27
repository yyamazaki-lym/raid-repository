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
 * FFLogs display name (v1 path) — restored in 1.8.5.
 * Required by FFLogs API v1 endpoint `/v1/reports/user/{userName}`.
 *
 * Numeric IDs (e.g. `70734` from profile URLs) are NOT accepted by the
 * API; only the display name string works. URL pastes that contain
 * `/user/{name}/...` extract the name; `/user/reports-list/{id}` form
 * is rejected with an actionable error.
 */
const FFLOGS_USERNAME_KEY = "fflogs_username";

export async function setFflogsUsername(
  raw: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const trimmed = raw.trim();
  if (!trimmed) {
    const supabase = createClient();
    const { error } = await supabase
      .from("app_settings")
      .delete()
      .eq("key", FFLOGS_USERNAME_KEY);
    if (error) return { ok: false, reason: error.message };
    return { ok: true };
  }
  const parsed = parseFflogsDisplayName(trimmed);
  if (!parsed.ok) return parsed;
  const supabase = createClient();
  const { error } = await supabase
    .from("app_settings")
    .upsert(
      { key: FFLOGS_USERNAME_KEY, value: parsed.value },
      { onConflict: "key" },
    );
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

function parseFflogsDisplayName(
  raw: string,
):
  | { ok: true; value: string }
  | { ok: false; reason: string } {
  if (/fflogs\.com/i.test(raw)) {
    try {
      const u = new URL(raw);
      const segs = u.pathname.split("/").filter(Boolean);
      const userIdx = segs.indexOf("user");
      if (userIdx >= 0 && userIdx + 1 < segs.length) {
        const next = segs[userIdx + 1]!;
        if (next === "reports-list") {
          return {
            ok: false,
            reason:
              "URL 末尾の数字 ID は API で使えません — fflogs.com/profile で表示名を確認してください",
          };
        }
        const name = decodeURIComponent(next);
        if (/^\d+$/.test(name)) {
          return {
            ok: false,
            reason:
              "数値 ID ではなく表示名（display name）を入力してください",
          };
        }
        return { ok: true, value: name };
      }
      return { ok: false, reason: "URL から表示名を抽出できませんでした" };
    } catch {
      return { ok: false, reason: "URL 形式不正" };
    }
  }
  const cleaned = raw.replace(/^[\s"']+|[\s"']+$/g, "");
  if (!cleaned) return { ok: false, reason: "空文字は受け付けません" };
  if (/^\d+$/.test(cleaned)) {
    return {
      ok: false,
      reason:
        "数値 ID ではなく表示名を入力してください（fflogs.com/profile の見出しに記載）",
    };
  }
  return { ok: true, value: cleaned };
}
