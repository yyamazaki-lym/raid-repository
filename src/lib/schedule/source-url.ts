import { cookies } from "next/headers";

/**
 * Cookie name shared between the client setter (settings dialog) and the
 * server-side reader. Synced manually with `schedule-url-store.ts`.
 */
export const SCHEDULE_URL_COOKIE = "raid-repo-schedule-url";

/**
 * Resolve the schedule source URL.
 *
 * Resolution order:
 *   1. Cookie set via the in-app settings dialog (per-browser override)
 *   2. `NEXT_PUBLIC_SCHEDULE_URL` build-time default
 *
 * Returns `null` if neither is configured. Phase 3 will replace this with a
 * Supabase `groups.schedule_url` lookup keyed by the active group.
 */
export async function getScheduleSourceUrl(): Promise<string | null> {
  const store = await cookies();
  const override = store.get(SCHEDULE_URL_COOKIE)?.value?.trim();
  if (override && /^https?:\/\//i.test(override)) {
    return override;
  }
  const env = process.env.NEXT_PUBLIC_SCHEDULE_URL?.trim();
  return env && env.length > 0 ? env : null;
}

/** Default URL from build-time env, exposed so the settings UI can show it. */
export function getDefaultScheduleSourceUrl(): string | null {
  const env = process.env.NEXT_PUBLIC_SCHEDULE_URL?.trim();
  return env && env.length > 0 ? env : null;
}
