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
 * 全 memo 行を「リクエスト一発 / 単一 channel」で監視するフック (TODO #11
 * phase 7, 2.1)。
 *
 * 旧 `useRealtimeScheduleMemos(rawDate, initial)` は各 SessionMemoPopover が
 * 個別に subscribe していたため、スケジュール表で 30+ セッション行が同時に
 * 30+ 個の Realtime channel を張り、1 INSERT/UPDATE/DELETE で全リスナーが
 * 「自分宛か?」を判定 → マッチした 1 つが per-rawDate refetch という設計
 * だった。さらに DELETE は raw_date が分からないため全 listener が refetch
 * → 30 倍の SELECT 発生。これを親 component (ScheduleList /
 * SchedulePastSimple) で 1 回だけ subscribe + payload delta で in-memory
 * map を更新する方式に置き換えた。子は `memosByDate[rawDate]` を props で
 * 受け取るだけで Realtime 知識を持たない。
 *
 * payload delta のセマンティクス:
 *   - INSERT: `payload.new` を rowToMemo してバケットに append + createdAt 昇順 sort
 *   - UPDATE: 全バケットから id で除去 (raw_date 変更の可能性があるため) →
 *     新バケットに append + sort
 *   - DELETE: REPLICA IDENTITY FULL があれば `old.raw_date` で対象バケットを
 *     特定できる。無い環境では `old.id` のみが届くので全バケットから id で
 *     除去 (1 度の sweep で済むので O(total memos) を許容)。万一 id すら
 *     無い payload (e.g. broken policy) は refetchAll に fallback。
 */
export function useRealtimeAllScheduleMemos(
  initialByDate: Record<string, ScheduleSessionMemo[]>,
): {
  memosByDate: Record<string, ScheduleSessionMemo[]>;
  refetchAll: () => Promise<void>;
} {
  const [memosByDate, setMemosByDate] =
    useState<Record<string, ScheduleSessionMemo[]>>(initialByDate);
  const id = useId();

  // server prefetch の initial が SSR 後に差し替わったら state を追従させる
  // (ScheduleList の initialMemosByDate prop が new reference で来るケース)。
  const initialRef = useRef(initialByDate);
  useEffect(() => {
    if (initialByDate !== initialRef.current) {
      initialRef.current = initialByDate;
      setMemosByDate(initialByDate);
    }
  }, [initialByDate]);

  const refetchAll = useCallback(async () => {
    const supabase = createClient();
    try {
      const { data, error } = await supabase
        .from("schedule_session_memos")
        .select("*")
        .order("created_at", { ascending: true });
      if (error) {
        console.warn("[schedule-memos:all] refetch error:", error.message);
        return;
      }
      const next: Record<string, ScheduleSessionMemo[]> = {};
      for (const row of (data ?? []) as ScheduleSessionMemoRow[]) {
        const m = rowToMemo(row);
        const list = next[m.rawDate];
        if (list) list.push(m);
        else next[m.rawDate] = [m];
      }
      setMemosByDate(next);
    } catch (e) {
      console.warn("[schedule-memos:all] refetch exception:", e);
    }
  }, []);

  useEffect(() => {
    const supabase = createClient();

    const channel = supabase
      .channel(`schedule-memos-all-${id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "schedule_session_memos",
        },
        (payload) => {
          if (payload.eventType === "INSERT") {
            const row = payload.new as ScheduleSessionMemoRow | null;
            if (!row) return;
            const m = rowToMemo(row);
            setMemosByDate((prev) => {
              const list = prev[m.rawDate] ?? [];
              const merged = [...list, m].sort((a, b) =>
                a.createdAt.localeCompare(b.createdAt),
              );
              return { ...prev, [m.rawDate]: merged };
            });
            return;
          }
          if (payload.eventType === "UPDATE") {
            const row = payload.new as ScheduleSessionMemoRow | null;
            if (!row) return;
            const m = rowToMemo(row);
            setMemosByDate((prev) => {
              const next: Record<string, ScheduleSessionMemo[]> = {};
              for (const [k, v] of Object.entries(prev)) {
                next[k] = v.filter((x) => x.id !== m.id);
              }
              const list = next[m.rawDate] ?? [];
              next[m.rawDate] = [...list, m].sort((a, b) =>
                a.createdAt.localeCompare(b.createdAt),
              );
              return next;
            });
            return;
          }
          if (payload.eventType === "DELETE") {
            const oldRow = payload.old as
              | { id?: string; raw_date?: string }
              | null;
            const targetId = oldRow?.id;
            if (!targetId) {
              void refetchAll();
              return;
            }
            setMemosByDate((prev) => {
              const next: Record<string, ScheduleSessionMemo[]> = {};
              for (const [k, v] of Object.entries(prev)) {
                next[k] = v.filter((x) => x.id !== targetId);
              }
              return next;
            });
          }
        },
      )
      .subscribe();

    return () => {
      try {
        void supabase.removeChannel(channel);
      } catch (e) {
        console.warn("[schedule-memos:all] removeChannel error:", e);
      }
    };
  }, [id, refetchAll]);

  return { memosByDate, refetchAll };
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
