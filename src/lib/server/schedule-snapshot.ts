import "server-only";
import { createClient } from "@/lib/supabase/server";
import { dbError } from "@/lib/server/db-error";
import { fetchScheduleRaw } from "@/lib/schedule/next-session";

/**
 * Snapshot the current character-sheets schedule into
 * `schedule_past_sessions`, including attendance data. Idempotent
 * via UPSERT on rawDate.
 *
 * Why: character-sheets ages out old dates. Without an explicit
 * snapshot, attendance for those sessions is lost forever once they
 * disappear from the source page. Run this regularly (cron at 21:50
 * JST = right before raid time, when the latest answers are in) to
 * maintain a complete historical record.
 *
 * Storage format:
 *   - `attendances` jsonb: { "ParticipantName": "◯", ... }
 *     Name-keyed (not userId-keyed) for stability — character-sheets
 *     userIds are session-scoped strings; names are the human-readable
 *     identifier and survive user re-keying.
 *   - `user_names` jsonb: ["Alice","Bob",...] in document order so
 *     the column ordering can be reconstructed.
 */
export async function runScheduleSnapshot(): Promise<{
  ok: boolean;
  reason?: string;
  /** Sessions found in character-sheets. */
  scanned: number;
  /** Of `scanned`, how many were inserted (new). */
  inserted: number;
  /** Of `scanned`, how many were updated (existing rawDate, refreshed attendances). */
  updated: number;
}> {
  const result = await fetchScheduleRaw();
  if (!result.ok) {
    return {
      ok: false,
      reason: result.reason,
      scanned: 0,
      inserted: 0,
      updated: 0,
    };
  }

  const { users, sessions } = result.data;
  if (sessions.length === 0) {
    return { ok: true, scanned: 0, inserted: 0, updated: 0 };
  }

  const userNames = users.map((u) => u.name);

  // Build name-keyed attendance maps for each session.
  type Row = {
    raw_date: string;
    parsed_date: string;
    start_time: string;
    end_time: string;
    day_of_week: string;
    source: "snapshot";
    attendances: Record<string, string>;
    user_names: string[];
  };
  const rows: Row[] = sessions.map((s) => {
    const byName: Record<string, string> = {};
    for (const u of users) {
      const sym = s.attendances[u.userId];
      if (sym) byName[u.name] = sym;
    }
    return {
      raw_date: s.rawDate,
      parsed_date: s.date.toISOString(),
      start_time: s.startTime,
      end_time: s.endTime,
      day_of_week: s.dayOfWeek,
      source: "snapshot",
      attendances: byName,
      user_names: userNames,
    };
  });

  const supabase = await createClient();

  // Detect existing rows so we can report inserted vs updated.
  const rawDates = rows.map((r) => r.raw_date);
  const { data: existing } = await supabase
    .from("schedule_past_sessions")
    .select("raw_date")
    .in("raw_date", rawDates);
  const existingSet = new Set(
    (existing ?? []).map((r) => r.raw_date as string),
  );

  // UPSERT all rows. For Discord-only rows (source='discord') we
  // overwrite source to 'snapshot' since we now have richer data —
  // but we don't touch the date columns that match anyway.
  const { error } = await supabase
    .from("schedule_past_sessions")
    .upsert(rows, { onConflict: "raw_date" });
  if (error) {
    return {
      ok: false,
      reason: dbError("スナップショット保存", error),
      scanned: rows.length,
      inserted: 0,
      updated: 0,
    };
  }

  const inserted = rows.length - existingSet.size;
  const updated = existingSet.size;
  return {
    ok: true,
    scanned: rows.length,
    inserted,
    updated,
  };
}
