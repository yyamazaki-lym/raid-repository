/**
 * Server-side fetch + parse of the character-sheets schedule page.
 *
 * Combined entry point — exposes both the full schedule (users + sessions)
 * for the native list view, and a derived "next confirmed session".
 *
 * Result is cached for 10 minutes via Next.js `fetch` revalidate.
 */

import {
  parseSchedule,
  attachUsersToSessions,
  type ParsedSchedule,
  type ScheduleSession,
} from "./parse";
import { getScheduleSourceUrl } from "./source-url";

export type {
  ScheduleSession,
  ScheduleUser,
  Attendance,
  ScheduleComment,
} from "./parse";

export type ScheduleFetchResult =
  | { ok: true; data: ParsedSchedule }
  | { ok: false; reason: "no-url" | "fetch-failed" | "parse-failed" };

export type NextSessionResult =
  | { ok: true; session: ScheduleSession | null }
  | { ok: false; reason: "no-url" | "fetch-failed" | "parse-failed" };

/** "Still relevant" = up to 6 hours past the start time. */
const STILL_RELEVANT_MS = 6 * 60 * 60 * 1000;

export async function fetchSchedule(): Promise<ScheduleFetchResult> {
  // Resolution order: cookie override (settings dialog) → env var.
  const url = await getScheduleSourceUrl();
  if (!url) return { ok: false, reason: "no-url" };

  let html: string;
  try {
    const res = await fetch(url, {
      next: { revalidate: 600 },
      headers: {
        "User-Agent": "RaidRepository/0.1",
      },
    });
    if (!res.ok) {
      console.warn("[schedule] non-OK response:", res.status);
      return { ok: false, reason: "fetch-failed" };
    }
    html = await res.text();
  } catch (err) {
    console.warn("[schedule] fetch error:", err);
    return { ok: false, reason: "fetch-failed" };
  }

  try {
    const data = attachUsersToSessions(parseSchedule(html));
    return { ok: true, data };
  } catch (err) {
    console.warn("[schedule] parse error:", err);
    return { ok: false, reason: "parse-failed" };
  }
}

export async function fetchNextConfirmedSession(): Promise<NextSessionResult> {
  const result = await fetchSchedule();
  if (!result.ok) return result;
  return { ok: true, session: pickNextDecision(result.data.sessions) };
}

export function pickNextDecision(
  sessions: ScheduleSession[],
): ScheduleSession | null {
  const cutoff = Date.now() - STILL_RELEVANT_MS;
  let earliest: ScheduleSession | null = null;
  for (const s of sessions) {
    if (s.status !== "DECISION") continue;
    if (s.date.getTime() < cutoff) continue;
    if (!earliest || s.date < earliest.date) earliest = s;
  }
  return earliest;
}
