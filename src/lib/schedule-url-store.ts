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
