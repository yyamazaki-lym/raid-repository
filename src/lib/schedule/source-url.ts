import { fetchAppSetting } from "@/lib/supabase/app-settings";

/**
 * Resolve the schedule source URL.
 *
 * Resolution order:
 *   1. `app_settings` row with key='schedule_url' (shared across all viewers)
 *   2. `NEXT_PUBLIC_SCHEDULE_URL` build-time fallback (left in for fork
 *      deployments that prefer baking the URL into env)
 *
 * Returns `null` if neither is configured — the schedule page renders the
 * onboarding card in that case.
 */
export async function getScheduleSourceUrl(): Promise<string | null> {
  const fromDb = await fetchAppSetting("schedule_url");
  if (fromDb && /^https?:\/\//i.test(fromDb)) return fromDb;
  const env = process.env.NEXT_PUBLIC_SCHEDULE_URL?.trim();
  return env && env.length > 0 ? env : null;
}

/** Default URL from build-time env, exposed so the settings UI can show it. */
export function getDefaultScheduleSourceUrl(): string | null {
  const env = process.env.NEXT_PUBLIC_SCHEDULE_URL?.trim();
  return env && env.length > 0 ? env : null;
}
