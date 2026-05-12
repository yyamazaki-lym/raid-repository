import "server-only";

import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { fetchAppSetting } from "@/lib/supabase/app-settings";
import {
  FALLBACK_DEFAULT_END_TIME,
  FALLBACK_DEFAULT_START_TIME,
  NATIVE_DEFAULT_END_TIME_KEY,
  NATIVE_DEFAULT_START_TIME_KEY,
} from "@/lib/server/native-schedule-placeholders";

/**
 * TODO #2 phase 3 + phase 4 (2026-05-08): native スケジュール用 Discord 通知 dispatch。
 *
 * 設計の根幹: ユーザーが「DECISION 化や session 作成 trigger の自動通知」を却下、
 * 自動通知の唯一のパスは「当日 12:00 JST cron」のみ。手動 button は admin が
 * 任意のタイミングで打てる。詳細は `.claude/plans/todo-2-phase-4-abstract-nygaard.md`。
 *
 * - cron 経路: `dispatchNoonNotifyForToday()` が今日 (JST) の DECISION セッションを
 *   `last_notified_at IS NULL` で絞り、順次 notify。dedup 列で Vercel cron の
 *   at-least-once retry に対応。
 * - 手動 button 経路: `notifyNativeScheduleSession({ respectToggle: false,
 *   respectDedup: false })` で ON/OFF と dedup 両方を bypass、admin が再送可能。
 *
 * Discord POST は既存 `discord-import.ts` と同じ Bot token + v10 endpoint パターン。
 * RLS で UPDATE できない anon 経路を避けるため service role client を使用。
 */

const NOTIFY_ENABLED_KEY = "native_schedule_discord_notify_enabled";
const NOTIFY_CHANNEL_KEY = "native_schedule_discord_notify_channel_id";
const NOTIFY_ROLE_KEY = "native_schedule_discord_notify_role_id";
const NOTIFY_HOUR_KEY = "native_schedule_discord_notify_hour";

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DEFAULT_NOTIFY_HOUR = 12;

export type DispatchResult =
  | { ok: true; posted: number; skipped: number }
  | { ok: false; reason: string };

type NotifySessionInput = {
  sessionId: string;
  /** cron path = true (toggle が false なら early return)。manual = false。 */
  respectToggle: boolean;
  /** cron path = true (`last_notified_at` を見て dedup)。manual = false。 */
  respectDedup: boolean;
};

type SessionRow = {
  id: string;
  raw_date: string;
  parsed_date: string;
  // 2.1 (2026-05-12): NULL 許可化。buildMessage 内で default を COALESCE する。
  start_time: string | null;
  end_time: string | null;
  day_of_week: string;
  status: "CANDIDATE" | "DECISION" | "CANCELLED";
  note: string | null;
  last_notified_at: string | null;
};

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

async function fetchTimeDefaults(): Promise<{
  startTime: string;
  endTime: string;
}> {
  const [startRaw, endRaw] = await Promise.all([
    fetchAppSetting(NATIVE_DEFAULT_START_TIME_KEY),
    fetchAppSetting(NATIVE_DEFAULT_END_TIME_KEY),
  ]);
  return {
    startTime:
      startRaw && TIME_RE.test(startRaw) ? startRaw : FALLBACK_DEFAULT_START_TIME,
    endTime:
      endRaw && TIME_RE.test(endRaw) ? endRaw : FALLBACK_DEFAULT_END_TIME,
  };
}

type MemberRow = {
  discord_user_id: string;
  display_name: string;
  is_active: boolean;
};

type AttendanceRow = {
  session_id: string;
  discord_user_id: string;
  symbol: string;
};

/** 単一セッション通知。cron loop と manual button の共通処理。 */
export async function notifyNativeScheduleSession(
  input: NotifySessionInput,
): Promise<DispatchResult> {
  const botToken = process.env.DISCORD_BOT_TOKEN?.trim();
  if (!botToken) {
    return { ok: false, reason: "DISCORD_BOT_TOKEN 未設定" };
  }

  if (input.respectToggle) {
    const enabled = await fetchAppSetting(NOTIFY_ENABLED_KEY);
    if (enabled === "false") {
      return { ok: true, posted: 0, skipped: 1 };
    }
  }

  const channelId = (await fetchAppSetting(NOTIFY_CHANNEL_KEY))?.trim();
  if (!channelId) {
    return { ok: false, reason: "通知先チャンネル ID 未設定" };
  }
  const roleId = (await fetchAppSetting(NOTIFY_ROLE_KEY))?.trim() ?? null;

  const supabase = createSupabaseServiceRoleClient();

  const { data: sessionData, error: sessionErr } = await supabase
    .from("native_schedule_sessions")
    .select(
      "id, raw_date, parsed_date, start_time, end_time, day_of_week, status, note, last_notified_at",
    )
    .eq("id", input.sessionId)
    .maybeSingle();
  if (sessionErr) {
    return { ok: false, reason: `session fetch: ${sessionErr.message}` };
  }
  if (!sessionData) {
    return { ok: false, reason: "セッションが見つかりません" };
  }
  const session = sessionData as SessionRow;

  if (input.respectDedup && session.last_notified_at !== null) {
    return { ok: true, posted: 0, skipped: 1 };
  }

  const message = await buildMessage(supabase, session, roleId);
  const postResult = await postToDiscord({
    botToken,
    channelId,
    content: message,
    roleId,
  });
  if (!postResult.ok) {
    return { ok: false, reason: postResult.reason };
  }

  const { error: updErr } = await supabase
    .from("native_schedule_sessions")
    .update({ last_notified_at: new Date().toISOString() })
    .eq("id", session.id);
  if (updErr) {
    console.warn(
      "[native-discord] last_notified_at UPDATE failed:",
      updErr.message,
    );
    // Discord post は成功済みなので ok: true で返す (re-notify 二重投稿を許容)。
  }

  return { ok: true, posted: 1, skipped: 0 };
}

/** cron entry。今日 (JST) の DECISION セッションを順次 notify。 */
export async function dispatchNoonNotifyForToday(): Promise<DispatchResult> {
  const botToken = process.env.DISCORD_BOT_TOKEN?.trim();
  if (!botToken) {
    return { ok: false, reason: "DISCORD_BOT_TOKEN 未設定" };
  }

  const enabled = await fetchAppSetting(NOTIFY_ENABLED_KEY);
  if (enabled === "false") {
    return { ok: true, posted: 0, skipped: 0 };
  }

  // TODO #2 候補 B (2026-05-08): cron は毎時発火 (`0 * * * *`)、
  // `app_settings.native_schedule_discord_notify_hour` (default '12') と
  // 現在 JST hour が一致するときのみ実通知。dedup (`last_notified_at`) は
  // 不変なので、同日内の重複発火は notifyNativeScheduleSession 側で抑止。
  const hourRaw = await fetchAppSetting(NOTIFY_HOUR_KEY);
  const targetHour = parseHour(hourRaw);
  const nowJstHour = getJstHour();
  if (nowJstHour !== targetHour) {
    return { ok: true, posted: 0, skipped: 0 };
  }

  const range = computeJstTodayUtcRange();

  const supabase = createSupabaseServiceRoleClient();
  // parsed_date は timestamptz、JST 上の「今日」を UTC 範囲に換算して比較。
  const { data, error } = await supabase
    .from("native_schedule_sessions")
    .select("id")
    .eq("status", "DECISION")
    .gte("parsed_date", range.todayStartUtc)
    .lt("parsed_date", range.tomorrowStartUtc)
    .is("last_notified_at", null);
  if (error) {
    return { ok: false, reason: `cron select: ${error.message}` };
  }

  let posted = 0;
  let skipped = 0;
  for (const row of (data ?? []) as Array<{ id: string }>) {
    const r = await notifyNativeScheduleSession({
      sessionId: row.id,
      respectToggle: false, // 上で gate 済 (loop 内で再 fetch しない)
      respectDedup: true,
    });
    if (!r.ok) {
      console.warn("[native-discord] cron notify failed:", row.id, r.reason);
      continue;
    }
    posted += r.posted;
    skipped += r.skipped;
  }
  return { ok: true, posted, skipped };
}

function getJstHour(now: Date = new Date()): number {
  return new Date(now.getTime() + JST_OFFSET_MS).getUTCHours();
}

function parseHour(raw: string | null): number {
  if (!raw) return DEFAULT_NOTIFY_HOUR;
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 0 || n > 23) return DEFAULT_NOTIFY_HOUR;
  return n;
}

/**
 * JST 上の「今日 0:00 〜 明日 0:00」を UTC ISO 文字列で返す。
 * `parsed_date` (timestamptz) を範囲クエリで比較するため。
 */
function computeJstTodayUtcRange(): {
  todayStartUtc: string;
  tomorrowStartUtc: string;
} {
  const nowJst = new Date(Date.now() + JST_OFFSET_MS);
  // JST 上の今日 0:00 を「UTC エポック値として扱った ms」
  const todayJstMidnightAsUtcMs = Date.UTC(
    nowJst.getUTCFullYear(),
    nowJst.getUTCMonth(),
    nowJst.getUTCDate(),
    0,
    0,
    0,
    0,
  );
  // 真の UTC ms に戻すには JST offset を引く
  const todayStartUtcMs = todayJstMidnightAsUtcMs - JST_OFFSET_MS;
  const tomorrowStartUtcMs = todayStartUtcMs + 24 * 60 * 60 * 1000;
  return {
    todayStartUtc: new Date(todayStartUtcMs).toISOString(),
    tomorrowStartUtc: new Date(tomorrowStartUtcMs).toISOString(),
  };
}

type SupabaseClient = ReturnType<typeof createSupabaseServiceRoleClient>;

async function buildMessage(
  supabase: SupabaseClient,
  session: SessionRow,
  roleId: string | null,
): Promise<string> {
  const [membersRes, attendancesRes, timeDefaults] = await Promise.all([
    supabase
      .from("native_schedule_members")
      .select("discord_user_id, display_name, is_active")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("display_name", { ascending: true }),
    supabase
      .from("native_schedule_attendances")
      .select("session_id, discord_user_id, symbol")
      .eq("session_id", session.id),
    fetchTimeDefaults(),
  ]);

  const members = (membersRes.data ?? []) as MemberRow[];
  const attendances = (attendancesRes.data ?? []) as AttendanceRow[];

  const symbolBy: Record<string, string> = {};
  for (const a of attendances) {
    if (a.symbol && a.symbol.trim()) symbolBy[a.discord_user_id] = a.symbol;
  }

  const buckets = new Map<string, string[]>();
  const unanswered: string[] = [];
  for (const m of members) {
    const sym = symbolBy[m.discord_user_id];
    if (sym) {
      const list = buckets.get(sym) ?? [];
      list.push(m.display_name);
      buckets.set(sym, list);
    } else {
      unanswered.push(m.display_name);
    }
  }
  const answered = members.length - unanswered.length;

  const lines: string[] = [];
  const mentionPrefix = roleId ? `<@&${roleId}> ` : "";
  // 2.1 (2026-05-12): NULL の row は default 時刻に追従させる。
  const startTime = session.start_time ?? timeDefaults.startTime;
  const endTime = session.end_time ?? timeDefaults.endTime;
  lines.push(`${mentionPrefix}本日の固定活動予定日です`);
  lines.push("");
  lines.push(`📅 ${session.raw_date} (${session.day_of_week})`);
  lines.push(`🕘 ${startTime} 〜 ${endTime}`);
  if (session.note && session.note.trim()) {
    lines.push(`📝 ${session.note.trim()}`);
  }
  lines.push("");
  lines.push(`出欠 (回答済 ${answered}/${members.length}):`);
  for (const [sym, names] of buckets) {
    lines.push(`　${sym}: ${names.join(", ")}`);
  }
  if (unanswered.length > 0) {
    lines.push(`　未回答: ${unanswered.join(", ")}`);
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (siteUrl) {
    lines.push("");
    lines.push(siteUrl);
  }

  return lines.join("\n");
}

async function postToDiscord(input: {
  botToken: string;
  channelId: string;
  content: string;
  roleId: string | null;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const res = await fetch(
      `https://discord.com/api/v10/channels/${input.channelId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bot ${input.botToken}`,
          "Content-Type": "application/json",
          "User-Agent": "RaidRepositoryBot/0.1",
        },
        body: JSON.stringify({
          content: input.content,
          allowed_mentions: input.roleId
            ? { roles: [input.roleId] }
            : { parse: [] },
        }),
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, reason: `discord ${res.status}: ${body.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: `discord fetch error: ${String(err)}` };
  }
}
