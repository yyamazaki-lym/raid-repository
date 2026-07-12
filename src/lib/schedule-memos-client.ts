"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRealtimeChannel } from "@/lib/use-realtime-table";

/**
 * CRUD + Realtime hook for `schedule_session_memos` — per-date shared
 * notes. **Read は anon 含め全員**、**書込はログイン済みメンバーなら誰でも**
 * (admin 限定ではない: schema 7a-2 で authenticated 全体に INSERT/UPDATE/DELETE
 * を開放。総合レビュー A-4)。所有者カラムを持たない共有メモなので、ログイン
 * メンバーは誰のメモでも編集できる。`author_name` は情報表示用のみ。anon
 * (未ログイン) の書込は RLS で弾かれ `{ok:false}` を返す (本番は proxy で全
 * viewer が認証済みメンバーのため通常は到達しない / demo guest のみ該当)。
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

// schema 側 CHECK (schedule_session_memos_text_sane、2026-07-12 監査 B-5) と
// 同じ上限。DB が弾く前に友好的なエラーを返すための入口検証
// (recruitment-templates-client の validateTemplateText と同方針)。
export const MEMO_BODY_MAX = 4000;
export const MEMO_AUTHOR_NAME_MAX = 100;
function validateMemoText(
  body: string | undefined,
  authorName: string | undefined,
): string | null {
  if (body !== undefined && body.length > MEMO_BODY_MAX)
    return `メモが長すぎます（最大 ${MEMO_BODY_MAX} 文字）`;
  if (authorName !== undefined && authorName.length > MEMO_AUTHOR_NAME_MAX)
    return `名前が長すぎます（最大 ${MEMO_AUTHOR_NAME_MAX} 文字）`;
  return null;
}

export async function createScheduleMemo(input: {
  rawDate: string;
  body: string;
  authorName: string;
}): Promise<
  { ok: true; memo: ScheduleSessionMemo } | { ok: false; reason: string }
> {
  const lenError = validateMemoText(input.body, input.authorName);
  if (lenError) return { ok: false, reason: lenError };
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
  const lenError = validateMemoText(patch.body, patch.authorName);
  if (lenError) return { ok: false, reason: lenError };
  const supabase = createClient();
  const dbPatch: Record<string, unknown> = {};
  if (patch.body !== undefined) dbPatch.body = patch.body;
  if (patch.authorName !== undefined) dbPatch.author_name = patch.authorName;
  // `.select("id")` で返却 0 件 (= RLS USING で弾かれた非 admin) を失敗扱いに。
  const { data, error } = await supabase
    .from("schedule_session_memos")
    .update(dbPatch)
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, reason: error.message };
  if (!data)
    return { ok: false, reason: "更新できませんでした（権限がない可能性があります）" };
  return { ok: true };
}

export async function deleteScheduleMemo(
  id: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("schedule_session_memos")
    .delete()
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, reason: error.message };
  if (!data)
    return { ok: false, reason: "削除できませんでした（権限がない可能性があります）" };
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

  // channel ライフサイクルは共通土台 `useRealtimeChannel` に委譲。grouped-map
  // への delta 適用 (rawDate バケット) はこのフック固有のため onChange に残す。
  useRealtimeChannel({
    channelPrefix: "schedule-memos-all",
    table: "schedule_session_memos",
    // 一時的な subscribe 失敗 (CHANNEL_ERROR / TIMED_OUT / CLOSED) 後に全件
    // 再取得して stale 表示から自己回復する (refetch モードの他フックと同様)。
    onSubscribeError: () => {
      void refetchAll();
    },
    onChange: (payload) => {
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
            const filtered = v.filter((x) => x.id !== m.id);
            // 空になったバケットは残さない (memory 蓄積 + 空/未取得の区別が
            // つかなくなるのを防ぐ。表示は length 0 = 非表示で従来と同じ)。
            if (filtered.length) next[k] = filtered;
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
            const filtered = v.filter((x) => x.id !== targetId);
            // 空バケットは落とす (UPDATE 分岐と同方針)。
            if (filtered.length) next[k] = filtered;
          }
          return next;
        });
      }
    },
  });

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
