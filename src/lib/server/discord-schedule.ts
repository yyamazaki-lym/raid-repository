import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchAppSetting } from "@/lib/supabase/app-settings";

/**
 * Imports past raid-session dates from a Discord notification channel.
 *
 * The user's Discord setup posts a daily reminder for each scheduled
 * session, e.g.:
 *
 *   @零式メンバー デイコードに登録されたイベント通知です。
 *   本日2026/04/23(木) 22:00~0:00は固定活動予定日です。
 *   参加不可であればこの投稿に返信してください。
 *
 * We scan the configured channel's recent messages, regex out the
 * `本日YYYY/MM/DD(曜) HH:MM~HH:MM` line, and upsert each as a row in
 * `schedule_past_sessions`. The schedule page later merges these with
 * the live character-sheets data so dates that have aged out of the
 * source still appear in the past list.
 *
 * Setting key: `discord_schedule_channel_id` in `app_settings`.
 * Channel must be readable by the same DISCORD_BOT_TOKEN used for the
 * link import (View Channels + Read Message History per channel).
 */

type DiscordMessage = {
  id: string;
  content: string;
  timestamp: string;
};

const SCHEDULE_LINE_RE =
  /本日\s*(\d{4})\/(\d{1,2})\/(\d{1,2})\(([日月火水木金土])\)\s*(\d{1,2}):(\d{2})\s*[~〜]\s*(\d{1,2}):(\d{2})/;

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

export type ScheduleHistoryImportResult = {
  ok: boolean;
  reason?: string;
  /** Number of Discord messages fetched. */
  scanned: number;
  /** Of `scanned`, how many parsed cleanly into a date. */
  parsed: number;
  /** Of `parsed`, how many were INSERTs (new dates). */
  inserted: number;
  /** Of `parsed`, how many were already in the DB. */
  duplicates: number;
  /** Of `parsed`, how many had a future parsed_date and were skipped. */
  skippedFuture?: number;
  /** Pre-existing future-dated rows deleted as cleanup. */
  cleanedFuture?: number;
};

export async function importDiscordScheduleHistory(): Promise<ScheduleHistoryImportResult> {
  const botToken = process.env.DISCORD_BOT_TOKEN?.trim();
  if (!botToken) {
    return {
      ok: false,
      reason: "DISCORD_BOT_TOKEN 未設定",
      scanned: 0,
      parsed: 0,
      inserted: 0,
      duplicates: 0,
    };
  }

  const channelId = await fetchAppSetting("discord_schedule_channel_id");
  if (!channelId) {
    return {
      ok: false,
      reason:
        "discord_schedule_channel_id 未設定 — 設定 dialog でチャンネル ID を登録してください",
      scanned: 0,
      parsed: 0,
      inserted: 0,
      duplicates: 0,
    };
  }

  // Fetch the last 100 messages — Discord's max per call. For a daily
  // notification cadence this covers the past ~3 months; if the group
  // wants more they can re-run after some time has passed (older
  // messages will still be in their channel; the scanned-window scrolls
  // forward as new ones get posted).
  let messages: DiscordMessage[];
  try {
    const res = await fetch(
      `https://discord.com/api/v10/channels/${channelId.trim()}/messages?limit=100`,
      {
        headers: {
          Authorization: `Bot ${botToken}`,
          "User-Agent": "RaidRepositoryBot/0.1",
        },
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        ok: false,
        reason: `discord ${res.status}: ${body.slice(0, 200)}`,
        scanned: 0,
        parsed: 0,
        inserted: 0,
        duplicates: 0,
      };
    }
    messages = (await res.json()) as DiscordMessage[];
  } catch (e) {
    return {
      ok: false,
      reason: "discord fetch error: " + String(e),
      scanned: 0,
      parsed: 0,
      inserted: 0,
      duplicates: 0,
    };
  }

  type Parsed = {
    rawDate: string;
    parsedDate: string; // ISO
    startTime: string;
    endTime: string;
    dayOfWeek: string;
  };
  const parsedRows: Parsed[] = [];
  const seen = new Set<string>();
  // 未来日時メッセージは「過去開催の確定通知」ではないので
  // schedule_past_sessions に入れない (TODO #24 フォロー)。bot が
  // Discord scheduled events を未来日時で先行通知してしまったケースや、
  // 本文に翌日の日時を書いて投稿されたメッセージが該当する。
  let skippedFuture = 0;
  const nowMs = Date.now();
  for (const m of messages) {
    const match = SCHEDULE_LINE_RE.exec(m.content);
    if (!match) continue;
    const [, y, mo, d, dow, sh, sm, eh, em] = match;
    const rawDate = `${y}/${mo.padStart(2, "0")}/${d.padStart(2, "0")}(${dow}) ${sh}:${sm}~${eh}:${em}`;
    if (seen.has(rawDate)) continue;
    seen.add(rawDate);
    // JST clock time → UTC instant.
    const dt = new Date(
      Date.UTC(
        Number(y),
        Number(mo) - 1,
        Number(d),
        Number(sh),
        Number(sm),
        0,
        0,
      ) - JST_OFFSET_MS,
    );
    if (dt.getTime() > nowMs) {
      skippedFuture++;
      continue;
    }
    parsedRows.push({
      rawDate,
      parsedDate: dt.toISOString(),
      startTime: `${sh}:${sm}`,
      endTime: `${eh}:${em}`,
      dayOfWeek: dow,
    });
  }

  // 既存 DB の未来日時行をクリーンアップ。importer の旧版や手動投入で
  // 未来 parsed_date が混入している場合があり、past 化すると「未開催の
  // ノイズ日」として表に出てしまうため、import 実行ごとに削除する。
  const supabaseEarly = await createClient();
  const { count: cleanedFuture } = await supabaseEarly
    .from("schedule_past_sessions")
    .delete({ count: "exact" })
    .gt("parsed_date", new Date(nowMs).toISOString());

  if (parsedRows.length === 0) {
    return {
      ok: true,
      scanned: messages.length,
      parsed: 0,
      inserted: 0,
      duplicates: 0,
      skippedFuture,
      cleanedFuture: cleanedFuture ?? 0,
    };
  }

  const supabase = supabaseEarly;
  // Look up which raw_dates already exist so we can report duplicates
  // accurately (an upsert wouldn't differentiate insert vs update).
  const rawDates = parsedRows.map((p) => p.rawDate);
  const { data: existing } = await supabase
    .from("schedule_past_sessions")
    .select("raw_date")
    .in("raw_date", rawDates);
  const existingSet = new Set(
    (existing ?? []).map((r) => r.raw_date as string),
  );
  const fresh = parsedRows.filter((p) => !existingSet.has(p.rawDate));

  let inserted = 0;
  if (fresh.length > 0) {
    const { error } = await supabase
      .from("schedule_past_sessions")
      .insert(
        fresh.map((p) => ({
          raw_date: p.rawDate,
          parsed_date: p.parsedDate,
          start_time: p.startTime,
          end_time: p.endTime,
          day_of_week: p.dayOfWeek,
          source: "discord",
        })),
      );
    if (error) {
      return {
        ok: false,
        reason: "insert failed: " + error.message,
        scanned: messages.length,
        parsed: parsedRows.length,
        inserted: 0,
        duplicates: existingSet.size,
        skippedFuture,
        cleanedFuture: cleanedFuture ?? 0,
      };
    }
    inserted = fresh.length;
  }

  return {
    ok: true,
    scanned: messages.length,
    parsed: parsedRows.length,
    inserted,
    duplicates: existingSet.size,
    skippedFuture,
    cleanedFuture: cleanedFuture ?? 0,
  };
}

/**
 * Read all stored past sessions ordered newest-first. Used by the
 * schedule page to merge with the live character-sheets feed.
 *
 * The optional `attendances` + `userNames` fields come from the
 * snapshot mechanism — for date-only Discord rows they're null.
 */
export async function fetchStoredPastSessions(): Promise<
  Array<{
    rawDate: string;
    parsedDate: string;
    startTime: string;
    endTime: string;
    dayOfWeek: string;
    /** Map of participant-name → attendance symbol. Null for date-only rows. */
    attendances: Record<string, string> | null;
    /** Ordered list of participant names from when the snapshot was taken. */
    userNames: string[] | null;
  }>
> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("schedule_past_sessions")
    .select(
      "raw_date, parsed_date, start_time, end_time, day_of_week, attendances, user_names",
    )
    .order("parsed_date", { ascending: false });
  if (error || !data) return [];
  return data.map((r) => ({
    rawDate: r.raw_date as string,
    parsedDate: r.parsed_date as string,
    startTime: r.start_time as string,
    endTime: r.end_time as string,
    dayOfWeek: r.day_of_week as string,
    attendances: (r.attendances as Record<string, string> | null) ?? null,
    userNames: (r.user_names as string[] | null) ?? null,
  }));
}
