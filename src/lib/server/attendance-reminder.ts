import "server-only";
import { sessionStartUnixSeconds } from "@/lib/schedule/attendance-times";

import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { fetchAppSetting } from "@/lib/supabase/app-settings";
import { getScheduleSourceMode } from "@/lib/schedule/source-mode";
import { fetchScheduleRaw } from "@/lib/schedule/next-session";
import {
  DISCORD_ID_RE,
  getJstHour,
  isUnanswered,
  jstDayKey,
  parseIntSetting,
  parseJsonRecord,
  parseJsonStringArray,
  renderReminderTemplate,
  selectReminderAudience,
  type CollectedMember,
  type ReminderTarget,
} from "@/lib/schedule/attendance-reminder-core";
import {
  REMINDER_CHANNEL_KEY,
  REMINDER_DEFAULT_HOUR,
  REMINDER_DEFAULT_LEAD_DAYS,
  REMINDER_DEFAULT_TEMPLATE,
  REMINDER_ENABLED_KEY,
  REMINDER_EXCLUDED_KEY,
  REMINDER_HOUR_KEY,
  REMINDER_LAST_SENT_KEY,
  REMINDER_LEAD_DAYS_KEY,
  REMINDER_MEMBER_MAP_KEY,
  REMINDER_TEMPLATE_KEY,
} from "@/lib/schedule/attendance-reminder-keys";

/**
 * 出欠未入力者への催促メンション (2026-08-30、調査 第3回 D-3)。
 *
 * デイコード (= portal が同期取り込みしている character-sheets) の核心価値
 * のうち唯一 portal に無かった「締切リマインド」を埋める。開催予定日の
 * `lead_days` 日前の指定時刻に、まだ出欠を入れていないメンバーだけを
 * まとめてメンションする。
 *
 * 設計:
 * - **既定 OFF**。メンションは人に直接飛ぶので、明示的に ON にするまで
 *   1 通も送らない。
 * - sync / native の両モード対応。未入力の定義は共通で
 *   「記号が無い or 空 or `－` (未回答)」。
 * - メンション先は表示名 → Discord ユーザー ID の対応表
 *   (`attendance_reminder_member_map`)。sync モードは character-sheets の
 *   表示名しか持たないため対応表が要る。native モードは
 *   `native_schedule_members.discord_user_id` を優先し、対応表で上書き可能。
 * - 除外リスト (`attendance_reminder_excluded`) の表示名は集計にも出さない
 *   (「常に未入力のメンバー」を静かに落とす、ユーザー指定)。
 * - dedup は `app_settings.attendance_reminder_last_sent_date` に対象日の
 *   rawDate を書く方式。native の `last_notified_at` と違い sync にも効く。
 *
 * Discord POST は `native-schedule-discord.ts` と同じ Bot token + v10。
 */

const NATIVE_NOTIFY_CHANNEL_KEY = "native_schedule_discord_notify_channel_id";

export type { ReminderTarget } from "@/lib/schedule/attendance-reminder-core";

export type ReminderPreview = {
  /** 対象セッションの rawDate ("2026/09/02(火) 22:00~0:00" 等)。 */
  rawDate: string;
  dayOfWeek: string;
  startTime: string;
  endTime: string;
  /** 未入力かつ除外されていないメンバー。 */
  targets: ReminderTarget[];
  /** 除外設定で落とした表示名 (UI 表示用)。 */
  excluded: string[];
  /** 回答済み人数 / 対象人数 (除外を除く)。 */
  answered: number;
  total: number;
};

export type ReminderResult =
  | { ok: true; posted: number; skipped: number; reason?: string }
  | { ok: false; reason: string };


/**
 * 設定 UI 用に現在値をまとめて読む。既定値の解決 (未設定 → default) は
 * cron 側と同じ関数を通すので、画面表示と実挙動がずれない。
 */
export async function fetchAttendanceReminderSettings(): Promise<{
  enabled: boolean;
  channelId: string;
  hour: number;
  leadDays: number;
  memberMap: Record<string, string>;
  excluded: string[];
  template: string;
  memberNames: string[];
}> {
  const [enabledRaw, channelRaw, hourRaw, leadRaw, mapRaw, excludedRaw, templateRaw] =
    await Promise.all([
      fetchAppSetting(REMINDER_ENABLED_KEY),
      fetchAppSetting(REMINDER_CHANNEL_KEY),
      fetchAppSetting(REMINDER_HOUR_KEY),
      fetchAppSetting(REMINDER_LEAD_DAYS_KEY),
      fetchAppSetting(REMINDER_MEMBER_MAP_KEY),
      fetchAppSetting(REMINDER_EXCLUDED_KEY),
      fetchAppSetting(REMINDER_TEMPLATE_KEY),
    ]);
  return {
    enabled: enabledRaw === "true",
    channelId: channelRaw?.trim() ?? "",
    hour: parseIntSetting(hourRaw, REMINDER_DEFAULT_HOUR, 0, 23),
    leadDays: parseIntSetting(leadRaw, REMINDER_DEFAULT_LEAD_DAYS, 0, 14),
    memberMap: parseJsonRecord(mapRaw),
    excluded: parseJsonStringArray(excludedRaw),
    template: templateRaw ?? "",
    memberNames: await fetchMemberNames(),
  };
}

/** 現在のスケジュールソースからメンバー表示名を取る (失敗時は空配列)。 */
async function fetchMemberNames(): Promise<string[]> {
  try {
    const mode = await getScheduleSourceMode();
    if (mode === "native") {
      const supabase = createSupabaseServiceRoleClient();
      const { data } = await supabase
        .from("native_schedule_members")
        .select("display_name, is_active")
        .eq("is_active", true)
        .order("sort_order", { ascending: true });
      return ((data ?? []) as Array<{ display_name: string }>).map(
        (m) => m.display_name,
      );
    }
    if (mode === "sync") {
      const result = await fetchScheduleRaw();
      if (result.ok) return result.data.users.map((u) => u.name);
    }
  } catch (e) {
    console.warn("[attendance-reminder] member names fetch failed:", e);
  }
  return [];
}

/**
 * 催促対象を算出する (送信はしない)。設定 UI のプレビューと cron の
 * 両方から使う。`null` = 対象セッションが無い (催促する理由が無い)。
 */
export async function buildReminderPreview(opts?: {
  /** 何日前を見るか。省略時は設定値。 */
  leadDays?: number;
}): Promise<ReminderPreview | null> {
  const [leadRaw, mapRaw, excludedRaw] = await Promise.all([
    fetchAppSetting(REMINDER_LEAD_DAYS_KEY),
    fetchAppSetting(REMINDER_MEMBER_MAP_KEY),
    fetchAppSetting(REMINDER_EXCLUDED_KEY),
  ]);
  const leadDays =
    opts?.leadDays ??
    parseIntSetting(leadRaw, REMINDER_DEFAULT_LEAD_DAYS, 0, 14);
  const memberMap = parseJsonRecord(mapRaw);
  const excludedNames = parseJsonStringArray(excludedRaw);

  const targetDayKey = jstDayKey(Date.now() + leadDays * 24 * 60 * 60 * 1000);
  const mode = await getScheduleSourceMode();

  const collected =
    mode === "native"
      ? await collectFromNative(targetDayKey)
      : mode === "sync"
        ? await collectFromSync(targetDayKey)
        : null;
  if (!collected) return null;

  // 誰に飛ぶかの決定は純粋関数 (attendance-reminder-core) に委譲する。
  // メンションは取り消せないので、この判定だけは単体で検証できる形に保つ。
  const audience = selectReminderAudience({
    members: collected.members,
    memberMap,
    excluded: excludedNames,
  });

  return {
    rawDate: collected.rawDate,
    dayOfWeek: collected.dayOfWeek,
    startTime: collected.startTime,
    endTime: collected.endTime,
    ...audience,
  };
}

type Collected = {
  rawDate: string;
  dayOfWeek: string;
  startTime: string;
  endTime: string;
  members: CollectedMember[];
};


/** sync モード (character-sheets) から対象日の出欠を集める。 */
async function collectFromSync(targetDayKey: string): Promise<Collected | null> {
  const result = await fetchScheduleRaw();
  if (!result.ok) return null;
  const { users, sessions } = result.data;
  // 対象日 (JST 暦日) の候補行。確定 (DECISION) / 候補 (CANDIDATE) の
  // どちらも催促対象にする — 候補日こそ入力が要るため。
  const session = sessions.find(
    (s) => jstDayKey(s.date.getTime()) === targetDayKey,
  );
  if (!session) return null;
  return {
    rawDate: session.rawDate,
    dayOfWeek: session.dayOfWeek,
    startTime: session.startTime,
    endTime: session.endTime,
    members: users.map((u) => ({
      name: u.name,
      answered: !isUnanswered(session.attendances[u.userId]),
      // sync には Discord ID が無い。対応表だけが頼り。
      discordUserId: null,
    })),
  };
}

/** native モードから対象日の出欠を集める。 */
async function collectFromNative(
  targetDayKey: string,
): Promise<Collected | null> {
  const supabase = createSupabaseServiceRoleClient();
  const { data: sessions, error } = await supabase
    .from("native_schedule_sessions")
    .select("id, raw_date, parsed_date, start_time, end_time, day_of_week, status")
    .neq("status", "CANCELLED");
  if (error || !sessions) return null;
  const session = (
    sessions as Array<{
      id: string;
      raw_date: string;
      parsed_date: string;
      start_time: string | null;
      end_time: string | null;
      day_of_week: string;
    }>
  ).find((s) => {
    const ms = new Date(s.parsed_date).getTime();
    return Number.isFinite(ms) && jstDayKey(ms) === targetDayKey;
  });
  if (!session) return null;

  const [membersRes, attendancesRes] = await Promise.all([
    supabase
      .from("native_schedule_members")
      .select("discord_user_id, display_name, is_active")
      .eq("is_active", true)
      .order("sort_order", { ascending: true }),
    supabase
      .from("native_schedule_attendances")
      .select("discord_user_id, symbol")
      .eq("session_id", session.id),
  ]);
  const symbolBy = new Map<string, string>();
  for (const a of (attendancesRes.data ?? []) as Array<{
    discord_user_id: string;
    symbol: string;
  }>) {
    symbolBy.set(a.discord_user_id, a.symbol);
  }
  const members = (
    (membersRes.data ?? []) as Array<{
      discord_user_id: string;
      display_name: string;
    }>
  ).map((m) => ({
    name: m.display_name,
    answered: !isUnanswered(symbolBy.get(m.discord_user_id)),
    discordUserId: DISCORD_ID_RE.test(m.discord_user_id)
      ? m.discord_user_id
      : null,
  }));

  return {
    rawDate: session.raw_date,
    dayOfWeek: session.day_of_week,
    startTime: session.start_time ?? "",
    endTime: session.end_time ?? "",
    members,
  };
}

/** プレビューから Discord 本文を組み立てる。 */
export async function buildReminderMessage(
  preview: ReminderPreview,
): Promise<string> {
  const templateRaw = await fetchAppSetting(REMINDER_TEMPLATE_KEY);
  const template = templateRaw?.trim() ? templateRaw : REMINDER_DEFAULT_TEMPLATE;
  return renderReminderTemplate(template, {
    targets: preview.targets,
    rawDate: preview.rawDate,
    dayOfWeek: preview.dayOfWeek,
    startTime: preview.startTime,
    endTime: preview.endTime,
    answered: preview.answered,
    total: preview.total,
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL?.trim() ?? "",
    startUnix: sessionStartUnixSeconds(preview.rawDate, preview.startTime),
  });
}

/**
 * 催促を 1 回送る。
 *
 * @param respectToggle cron = true (OFF なら送らない)。手動テスト = false。
 * @param respectDedup  cron = true (同じ開催日には 1 回だけ)。手動 = false。
 * @param respectHour   cron = true (目標時刻より前なら送らない)。手動 = false。
 */
export async function dispatchAttendanceReminder(input: {
  respectToggle: boolean;
  respectDedup: boolean;
  respectHour: boolean;
}): Promise<ReminderResult> {
  const botToken = process.env.DISCORD_BOT_TOKEN?.trim();
  if (!botToken) return { ok: false, reason: "DISCORD_BOT_TOKEN 未設定" };

  if (input.respectToggle) {
    const enabled = await fetchAppSetting(REMINDER_ENABLED_KEY);
    // 既定 OFF: 明示的に 'true' のときだけ送る。
    if (enabled !== "true") {
      return { ok: true, posted: 0, skipped: 1, reason: "無効 (OFF)" };
    }
  }

  if (input.respectHour) {
    const hour = parseIntSetting(
      await fetchAppSetting(REMINDER_HOUR_KEY),
      REMINDER_DEFAULT_HOUR,
      0,
      23,
    );
    // notify-native-schedule と同じ「目標時以降なら再試行」方式
    // (単発失敗で当日分が恒久ミスするのを防ぐ)。dedup が二重送信を止める。
    if (getJstHour() < hour) {
      return { ok: true, posted: 0, skipped: 1, reason: "目標時刻前" };
    }
  }

  const preview = await buildReminderPreview();
  if (!preview) {
    return { ok: true, posted: 0, skipped: 1, reason: "対象の開催予定なし" };
  }
  if (preview.targets.length === 0) {
    return { ok: true, posted: 0, skipped: 1, reason: "未入力者なし" };
  }

  if (input.respectDedup) {
    const last = await fetchAppSetting(REMINDER_LAST_SENT_KEY);
    if (last && last === preview.rawDate) {
      return { ok: true, posted: 0, skipped: 1, reason: "送信済み" };
    }
  }

  const channelId =
    (await fetchAppSetting(REMINDER_CHANNEL_KEY))?.trim() ||
    (await fetchAppSetting(NATIVE_NOTIFY_CHANNEL_KEY))?.trim() ||
    "";
  if (!channelId) return { ok: false, reason: "投稿先チャンネル ID 未設定" };

  const content = await buildReminderMessage(preview);
  const mentionIds = preview.targets
    .map((t) => t.discordUserId)
    .filter((id): id is string => id !== null);

  const posted = await postToDiscord({
    botToken,
    channelId,
    content,
    userIds: mentionIds,
  });
  if (!posted.ok) return { ok: false, reason: posted.reason };

  // 送信できた後に dedup マーカーを更新 (失敗しても次回 cron が再送する
  // 方が「催促が飛ばない」より軽微、という判断)。
  try {
    const supabase = createSupabaseServiceRoleClient();
    await supabase
      .from("app_settings")
      .upsert(
        { key: REMINDER_LAST_SENT_KEY, value: preview.rawDate },
        { onConflict: "key" },
      );
  } catch (e) {
    console.warn("[attendance-reminder] dedup marker update failed:", e);
  }

  return { ok: true, posted: 1, skipped: 0 };
}

async function postToDiscord(input: {
  botToken: string;
  channelId: string;
  content: string;
  userIds: string[];
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
          // 催促の本体はメンションなので users だけ明示的に許可する
          // (@everyone / role は絶対に飛ばさない)。
          allowed_mentions: { parse: [], users: input.userIds.slice(0, 50) },
        }),
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        ok: false,
        reason: `discord ${res.status}: ${body.slice(0, 200)}`,
      };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: `discord fetch error: ${String(err)}` };
  }
}
