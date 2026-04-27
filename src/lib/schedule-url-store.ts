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
 * FFLogs user display name — required by API v1 endpoint
 * `/v1/reports/user/{userName}`.
 *
 * IMPORTANT: the API requires the **display name string**, NOT the
 * numeric user ID seen in URLs like
 * `https://www.fflogs.com/user/reports-list/70734`. Passing a numeric
 * ID returns `400 Invalid user name specified.`
 *
 * We accept either:
 *   - a bare display name (`TaroYamada`)
 *   - a URL containing the display name (`/user/{name}` or
 *     `/user/{name}/reports-list/...`)
 *
 * If the user pastes the numeric-ID URL form (`/reports-list/{id}`),
 * we reject it with an actionable error directing them to look up
 * their display name on `fflogs.com/profile`.
 *
 * Empty string clears the setting.
 */
export async function setFflogsUsername(
  raw: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const trimmed = raw.trim();
  // Empty input clears the setting.
  if (!trimmed) {
    const supabase = createClient();
    const { error } = await supabase
      .from("app_settings")
      .delete()
      .eq("key", FFLOGS_USERNAME_KEY);
    if (error) return { ok: false, reason: error.message };
    return { ok: true };
  }
  const result = parseFflogsDisplayName(trimmed);
  if (!result.ok) return result;
  const supabase = createClient();
  const { error } = await supabase
    .from("app_settings")
    .upsert(
      { key: FFLOGS_USERNAME_KEY, value: result.value },
      { onConflict: "key" },
    );
  if (error) return { ok: false, reason: error.message };
  return { ok: true };
}

/**
 * Try to derive an FFLogs display name from arbitrary user input.
 *
 * Returns:
 *   - `{ ok: true, value }` — usable display name
 *   - `{ ok: false, reason }` — pure-numeric ID detected, or unparseable
 */
function parseFflogsDisplayName(
  raw: string,
):
  | { ok: true; value: string }
  | { ok: false; reason: string } {
  // URL form: extract a name segment, but reject `/reports-list/{id}`
  // since the trailing `{id}` is the NUMERIC profile id and the API
  // rejects it with 400.
  if (/fflogs\.com/i.test(raw)) {
    try {
      const u = new URL(raw);
      const segs = u.pathname.split("/").filter(Boolean);
      // Pattern A: /user/{name}/...  → take {name}
      // Pattern B: /user/reports-list/{id}  → reject (id-only form)
      const userIdx = segs.indexOf("user");
      if (userIdx >= 0 && userIdx + 1 < segs.length) {
        const next = segs[userIdx + 1]!;
        if (next === "reports-list") {
          // The piece after `reports-list` is the numeric id.
          return {
            ok: false,
            reason:
              "URL 末尾の数字 ID は API で使えません — fflogs.com/profile で表示名（heading に表示されている名前）を確認して、その名前を直接入力してください",
          };
        }
        const name = decodeURIComponent(next);
        if (/^\d+$/.test(name)) {
          return {
            ok: false,
            reason:
              "数値 ID ではなく表示名を入力してください（fflogs.com/profile に記載）",
          };
        }
        return { ok: true, value: name };
      }
      return { ok: false, reason: "URL から表示名を抽出できませんでした" };
    } catch {
      return { ok: false, reason: "URL の形式が正しくありません" };
    }
  }

  // Bare input — accept unless it's purely numeric (which the API
  // would 400 on anyway).
  const cleaned = raw.replace(/^[\s"']+|[\s"']+$/g, "");
  if (!cleaned) return { ok: false, reason: "空文字は受け付けません" };
  if (/^\d+$/.test(cleaned)) {
    return {
      ok: false,
      reason:
        "数値 ID ではなく表示名（display name）を入力してください — fflogs.com/profile の見出しに表示されている英数字の名前です",
    };
  }
  return { ok: true, value: cleaned };
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
