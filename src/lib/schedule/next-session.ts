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
import { fetchStoredPastSessions } from "@/lib/server/discord-schedule";

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
    // Merge in past sessions stored from Discord notifications. These
    // appear at the bottom of the list (sorted into past) and have no
    // attendance data — they're just date placeholders for history.
    const merged = await mergeStoredPastSessions(data);
    return { ok: true, data: merged };
  } catch (err) {
    console.warn("[schedule] parse error:", err);
    return { ok: false, reason: "parse-failed" };
  }
}

/**
 * Merge `schedule_past_sessions` rows into the parsed schedule. Dedupes
 * by `rawDate` — character-sheets data wins when the same session
 * appears in both (it has full attendance info). DB-only entries get
 * empty attendance maps.
 */
async function mergeStoredPastSessions(
  parsed: ParsedSchedule,
): Promise<ParsedSchedule> {
  let stored: Awaited<ReturnType<typeof fetchStoredPastSessions>>;
  try {
    stored = await fetchStoredPastSessions();
  } catch {
    return parsed; // best-effort merge
  }
  if (stored.length === 0) return parsed;
  const existingRawDates = new Set(parsed.sessions.map((s) => s.rawDate));
  const additions: ScheduleSession[] = [];
  for (const s of stored) {
    if (existingRawDates.has(s.rawDate)) continue;
    additions.push({
      rawDate: s.rawDate,
      date: new Date(s.parsedDate),
      dayOfWeek: s.dayOfWeek,
      startTime: s.startTime,
      endTime: s.endTime,
      // We don't know whether these were decided sessions; mark as
      // CANDIDATE so we don't accidentally pick them as "next confirmed"
      // (they're all in the past anyway, but be defensive).
      status: "CANDIDATE",
      attendances: {},
    });
  }
  return {
    ...parsed,
    sessions: [...parsed.sessions, ...additions],
  };
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
