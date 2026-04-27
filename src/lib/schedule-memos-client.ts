"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * CRUD + Realtime hook for `schedule_session_memos` — per-date shared
 * notes that any viewer can leave. Same auth scope as the rest of the
 * app (no per-user identity), so anyone can edit anyone's note. The
 * `author_name` field is informational only.
 *
 * Author name is persisted to localStorage so a returning user
 * doesn't have to re-type their name every memo session.
 */

export type ScheduleSessionMemo = {
  id: string;
  rawDate: string;
  body: string;
  authorName: string;
  createdAt: string;
  updatedAt: string;
};

type ScheduleSessionMemoRow = {
  id: string;
  raw_date: string;
  body: string;
  author_name: string;
  created_at: string;
  updated_at: string;
};

function rowToMemo(row: ScheduleSessionMemoRow): ScheduleSessionMemo {
  return {
    id: row.id,
    rawDate: row.raw_date,
    body: row.body,
    authorName: row.author_name ?? "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const AUTHOR_NAME_KEY = "raid-repo:memo-author-name";

export function getStoredAuthorName(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(AUTHOR_NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

export function persistAuthorName(name: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(AUTHOR_NAME_KEY, name);
  } catch {
    // ignore
  }
}

export async function createScheduleMemo(input: {
  rawDate: string;
  body: string;
  authorName: string;
}): Promise<
  { ok: true; memo: ScheduleSessionMemo } | { ok: false; reason: string }
> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("schedule_session_memos")
    .insert({
      raw_date: input.rawDate,
      body: input.body,
      author_name: input.authorName,
    })
    .select("*")
    .single();
  if (error || !data) return { ok: false, reason: error?.message ?? "unknown" };
  return { ok: true, memo: rowToMemo(data as ScheduleSessionMemoRow) };
}

export async function updateScheduleMemo(
  id: string,
  patch: Partial<{ body: string; authorName: string }>,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const supabase = createClient();
  const dbPatch: Record<string, unknown> = {};
  if (patch.body !== undefined) dbPatch.body = patch.body;
  if (patch.authorName !== undefined) dbPatch.author_name = patch.authorName;
  const { error } = await supabase
    .from("schedule_session_memos")
    .update(dbPatch)
    .eq("id", id);
  if (error) return { ok: false, reason: error.message };
  return { ok: true };
}

export async function deleteScheduleMemo(
  id: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const supabase = createClient();
  const { error } = await supabase
    .from("schedule_session_memos")
    .delete()
    .eq("id", id);
  if (error) return { ok: false, reason: error.message };
  return { ok: true };
}

/**
 * Live memo list scoped to a single rawDate. Mirrors other realtime
 * hooks in the codebase. Filter is server-side via the postgres
 * filter so we don't refetch the whole table on unrelated changes.
 */
export function useRealtimeScheduleMemos(
  rawDate: string,
  initial: ScheduleSessionMemo[],
): { memos: ScheduleSessionMemo[]; refetch: () => Promise<void> } {
  const [memos, setMemos] = useState<ScheduleSessionMemo[]>(initial);
  const id = useId();

  const initialRef = useRef(initial);
  useEffect(() => {
    if (initial !== initialRef.current) {
      initialRef.current = initial;
      setMemos(initial);
    }
  }, [initial]);

  // Stable refetch — exposed to callers so they can force-refresh
  // immediately after a CUD operation (defense against realtime
  // delivery failures or REPLICA IDENTITY misconfiguration).
  const refetch = useCallback(async () => {
    const supabase = createClient();
    try {
      const { data, error } = await supabase
        .from("schedule_session_memos")
        .select("*")
        .eq("raw_date", rawDate)
        .order("created_at", { ascending: true });
      if (error) {
        console.warn("[schedule-memos] refetch error:", error.message);
        return;
      }
      setMemos(((data ?? []) as ScheduleSessionMemoRow[]).map(rowToMemo));
    } catch (e) {
      console.warn("[schedule-memos] refetch exception:", e);
    }
  }, [rawDate]);

  useEffect(() => {
    const supabase = createClient();

    // Subscribe without a server-side filter on raw_date — that field
    // contains parens / slashes / spaces / tildes (e.g.
    // "2026/04/23(木) 22:00~0:00") which Supabase Realtime's filter
    // parser doesn't reliably handle. Cheaper to listen to all memo
    // changes and match in the callback. Volume is tiny (one row per
    // memo create / edit / delete).
    const channel = supabase
      .channel(`schedule-memos-${id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "schedule_session_memos",
        },
        (payload) => {
          const newRow = payload.new as { raw_date?: string } | null;
          const oldRow = payload.old as { raw_date?: string } | null;
          // INSERT / UPDATE always carry `new`. UPDATE / DELETE carry
          // `old` IF the table has REPLICA IDENTITY FULL — without it,
          // `old` is just `{ id }` on DELETE and we can't tell whether
          // the deleted row was ours. So: always refetch on DELETE
          // (volume is tiny) as a defensive fallback in case the
          // production DB hasn't received the FULL replica migration.
          if (newRow?.raw_date === rawDate) {
            void refetch();
            return;
          }
          if (oldRow?.raw_date === rawDate) {
            void refetch();
            return;
          }
          if (payload.eventType === "DELETE") {
            // We can't tell which date this DELETE was for. One refetch
            // per delete event (per row instance) is a fine cost vs.
            // the alternative of stale UI.
            void refetch();
          }
        },
      )
      .subscribe();

    // Initial fetch — without this the hook only ever populates via
    // postgres_changes events, so existing memos never appeared.
    void refetch();

    return () => {
      try {
        void supabase.removeChannel(channel);
      } catch (e) {
        console.warn("[schedule-memos] removeChannel error:", e);
      }
    };
  }, [id, rawDate, refetch]);

  return { memos, refetch };
}

/** Browser-side initial fetch for a single date. */
export async function fetchScheduleMemosByDate(
  rawDate: string,
): Promise<ScheduleSessionMemo[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("schedule_session_memos")
    .select("*")
    .eq("raw_date", rawDate)
    .order("created_at", { ascending: true });
  if (error || !data) return [];
  return (data as ScheduleSessionMemoRow[]).map(rowToMemo);
}
