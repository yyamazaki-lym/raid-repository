import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * 1.9 (2026-04-28) — TODO #11: スケジュールページの初期 paint 高速化。
 *
 * 旧: `<DateChip>` / `<SessionRow>` が各々 `useRealtimeScheduleMemos`
 * を呼び、`mount` 時に SELECT クエリを発行 + Postgres realtime
 * subscription を張る。30+ 行ある場合 30+ 並列クエリ + 30+ websocket
 * になり、メモバッジが「遅れて表示」される体感の主因になっていた。
 *
 * 新: ページの server component (`page.tsx`) で全メモを一括 fetch して
 * Map<rawDate, memos[]> を子コンポーネントに props として降す。
 * 初期 paint 時にメモバッジが既に表示される。クライアント側は単一
 * subscription で live 更新のみ受け取る。
 */
import type { ScheduleSessionMemo } from "@/lib/schedule-memos-client";

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

/**
 * 全 schedule session memo を rawDate でバケット化した Map を返す。
 * 引数の rawDates が指定された場合は `.in()` で絞り込み、未指定なら
 * 全件取得 (運用上 memo 行数は十分小さい)。
 */
export async function fetchScheduleMemosByDateBulk(
  rawDates?: string[],
): Promise<Record<string, ScheduleSessionMemo[]>> {
  try {
    const supabase = await createClient();
    let query = supabase
      .from("schedule_session_memos")
      .select("*")
      .order("created_at", { ascending: true });
    if (rawDates && rawDates.length > 0) {
      query = query.in("raw_date", rawDates);
    }
    const { data, error } = await query;
    if (error) {
      console.warn("[schedule-memos-fetch] bulk fetch error:", error.message);
      return {};
    }
    const out: Record<string, ScheduleSessionMemo[]> = {};
    for (const row of (data ?? []) as ScheduleSessionMemoRow[]) {
      const memo = rowToMemo(row);
      const list = out[memo.rawDate];
      if (list) list.push(memo);
      else out[memo.rawDate] = [memo];
    }
    return out;
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "digest" in err &&
      typeof (err as { digest?: unknown }).digest === "string"
    ) {
      const digest = (err as { digest: string }).digest;
      if (digest === "DYNAMIC_SERVER_USAGE" || digest.startsWith("NEXT_")) {
        throw err;
      }
    }
    console.warn("[schedule-memos-fetch] unexpected error:", err);
    return {};
  }
}
