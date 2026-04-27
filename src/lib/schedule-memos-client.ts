"use client";

import { useEffect, useId, useRef, useState } from "react";
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
): ScheduleSessionMemo[] {
  const [memos, setMemos] = useState<ScheduleSessionMemo[]>(initial);
  const id = useId();

  const initialRef = useRef(initial);
  useEffect(() => {
    if (initial !== initialRef.current) {
      initialRef.current = initial;
      setMemos(initial);
    }
  }, [initial]);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();

    const refetch = async () => {
      if (cancelled) return;
      try {
        const { data, error } = await supabase
          .from("schedule_session_memos")
          .select("*")
          .eq("raw_date", rawDate)
          .order("created_at", { ascending: true });
        if (cancelled) return;
        if (error) {
          console.warn("[schedule-memos] refetch error:", error.message);
          return;
        }
        setMemos(((data ?? []) as ScheduleSessionMemoRow[]).map(rowToMemo));
      } catch (e) {
        console.warn("[schedule-memos] refetch exception:", e);
      }
    };

    const channel = supabase
      .channel(`schedule-memos-${id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "schedule_session_memos",
          filter: `raw_date=eq.${rawDate}`,
        },
        () => {
          void refetch();
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      try {
        void supabase.removeChannel(channel);
      } catch (e) {
        console.warn("[schedule-memos] removeChannel error:", e);
      }
    };
  }, [id, rawDate]);

  return memos;
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
