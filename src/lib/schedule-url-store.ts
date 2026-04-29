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
