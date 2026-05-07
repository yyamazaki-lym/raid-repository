"use client";

import { createClient } from "@/lib/supabase/client";

/**
 * Client-side READERS for shared `app_settings` (schedule URL, Discord
 * channel ID, FFLogs username). Used by the settings dialog to prefill
 * the form, and by ScheduleOnboarding to peek at the current value.
 *
 * SETTERS were moved to server actions (`setScheduleUrlAction` /
 * `setDiscordScheduleChannelIdAction` / `setFflogsUsernameAction`) in
 * `src/lib/server/categories-actions.ts` to gate writes by ADMIN role
 * (TODO #21 follow-up). The old client-side anon-key writes bypassed
 * the admin check entirely (RLS is open in this repo per HANDOFF).
 */

const SETTING_KEY = "schedule_url";
const SCHEDULE_CHANNEL_KEY = "discord_schedule_channel_id";
const FFLOGS_USERNAME_KEY = "fflogs_username";
const SCHEDULE_SOURCE_MODE_KEY = "schedule_source_mode";

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

export async function getDiscordScheduleChannelId(): Promise<string | null> {
  const supabase = createClient();
  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", SCHEDULE_CHANNEL_KEY)
    .maybeSingle();
  return (data?.value as string | null | undefined) ?? null;
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
 * TODO #2 phase 1 (2026-05-07): browser から `schedule_source_mode` を読む。
 * Server 側の `getScheduleSourceMode()` (`src/lib/schedule/source-mode.ts`)
 * は server-only なので settings dialog の useEffect では使えず、こちら
 * を使う。値の妥当性検証は呼び出し側で行う。
 */
export async function getScheduleSourceModeFromDb(): Promise<string | null> {
  const supabase = createClient();
  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", SCHEDULE_SOURCE_MODE_KEY)
    .maybeSingle();
  return (data?.value as string | null | undefined) ?? null;
}
