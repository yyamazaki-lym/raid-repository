import "server-only";
import { discordFetch } from "@/lib/server/discord-api";
import { sessionStartUnixSeconds } from "@/lib/schedule/attendance-times";

import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { fetchAppSetting } from "@/lib/supabase/app-settings";
import { getScheduleSourceMode } from "@/lib/schedule/source-mode";
import { fetchScheduleRaw } from "@/lib/schedule/next-session";
import { claimMarker, type MarkerClaimOps } from "@/lib/schedule/marker-claim";
import { parseChoiceValues } from "@/lib/schedule/native-fetch";
import { NATIVE_CHOICE_VALUES_KEY } from "@/lib/schedule/settings-keys";
import {
  attendanceButtonChoices,
  attendanceComponents,
  sessionButtonLabel,
  type ActionRow,
} from "@/lib/discord-interactions";
import {
  DISCORD_ID_RE,
  getJstHour,
  isUnanswered,
  jstDayKey,
  parseIntSetting,
  parseJsonRecord,
  parseJsonStringArray,
  clampDiscordContent,
  renderReminderTemplate,
  selectReminderAudience,
  type CollectedMember,
  type ReminderTarget,
} from "@/lib/schedule/attendance-reminder-core";
import {
  REMINDER_BUTTONS_KEY,
  REMINDER_CHANNEL_KEY,
  REMINDER_DEFAULT_HOUR,
  REMINDER_DEFAULT_LEAD_DAYS,
  REMINDER_DEFAULT_TEMPLATE,
  REMINDER_ENABLED_KEY,
  REMINDER_EXCLUDED_KEY,
  REMINDER_HOUR_KEY,
  REMINDER_LAST_SENT_KEY,
  REMINDER_LEAD_DAYS_KEY,
  REMINDER_CADENCE_KEY,
  parseReminderCadence,
  parseReminderMarkers,
  pickReminderBatch,
  reminderDedupMarker,
  reminderSessionKey,
  reminderLeadDaysToTry,
  type ReminderCadence,
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
  /**
   * 予定のスケジュール (2026-10-02、複数スケジュールの段階 2)。スケジュールが
   * 2 つ以上あるときだけ入る。1 つのとき・同期式では null (表示も送信の印も
   * 従来どおり)。
   */
  scheduleId: string | null;
  scheduleName: string | null;
  /**
   * 自前作成式の予定の ID (W-21、2026-10-05)。回答ボタンの宛先に使う。
   * 同期式では null (外部シートの出欠はポータルから書けないのでボタンを付けない)。
   */
  sessionId: string | null;
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
  /** W-20 (2026-09-07): 催促の頻度。既定 `once` = 現行挙動。 */
  cadence: ReminderCadence;
  memberMap: Record<string, string>;
  excluded: string[];
  template: string;
  memberNames: string[];
  /** W-21 (2026-10-05): 回答ボタンを付けるか。既定 false。 */
  buttonsEnabled: boolean;
  /** サーバーに DISCORD_PUBLIC_KEY があるか (無ければ ON でもボタンは付かない)。 */
  buttonsReady: boolean;
}> {
  const [
    enabledRaw,
    channelRaw,
    hourRaw,
    leadRaw,
    mapRaw,
    excludedRaw,
    templateRaw,
    cadenceRaw,
    buttonsRaw,
  ] = await Promise.all([
    fetchAppSetting(REMINDER_ENABLED_KEY),
    fetchAppSetting(REMINDER_CHANNEL_KEY),
    fetchAppSetting(REMINDER_HOUR_KEY),
    fetchAppSetting(REMINDER_LEAD_DAYS_KEY),
    fetchAppSetting(REMINDER_MEMBER_MAP_KEY),
    fetchAppSetting(REMINDER_EXCLUDED_KEY),
    fetchAppSetting(REMINDER_TEMPLATE_KEY),
    fetchAppSetting(REMINDER_CADENCE_KEY),
    fetchAppSetting(REMINDER_BUTTONS_KEY),
  ]);
  return {
    enabled: enabledRaw === "true",
    channelId: channelRaw?.trim() ?? "",
    hour: parseIntSetting(hourRaw, REMINDER_DEFAULT_HOUR, 0, 23),
    leadDays: parseIntSetting(leadRaw, REMINDER_DEFAULT_LEAD_DAYS, 0, 14),
    cadence: parseReminderCadence(cadenceRaw),
    memberMap: parseJsonRecord(mapRaw),
    excluded: parseJsonStringArray(excludedRaw),
    template: templateRaw ?? "",
    memberNames: await fetchMemberNames(),
    buttonsEnabled: buttonsRaw === "true",
    buttonsReady: Boolean(process.env.DISCORD_PUBLIC_KEY?.trim()),
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
 * 両方から使う。空配列 = 対象の予定が無い (催促する理由が無い)。
 *
 * 2026-10-02 (複数スケジュールの段階 2): 自前作成式では **全スケジュールの**
 * 対象日の予定を集めるので、1 日に複数件になり得る (零式と絶を同じ日に
 * 回すなど)。同期式は従来どおり 0〜1 件。
 */
export async function buildReminderPreviews(opts?: {
  /** 何日前を見るか。省略時は設定値。 */
  leadDays?: number;
}): Promise<ReminderPreview[]> {
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
        : [];

  // 誰に飛ぶかの決定は純粋関数 (attendance-reminder-core) に委譲する。
  // メンションは取り消せないので、この判定だけは単体で検証できる形に保つ。
  return collected.map((c) => ({
    rawDate: c.rawDate,
    dayOfWeek: c.dayOfWeek,
    startTime: c.startTime,
    endTime: c.endTime,
    scheduleId: c.scheduleId,
    scheduleName: c.scheduleName,
    sessionId: c.sessionId,
    ...selectReminderAudience({
      members: c.members,
      memberMap,
      excluded: excludedNames,
    }),
  }));
}

type Collected = {
  rawDate: string;
  dayOfWeek: string;
  startTime: string;
  endTime: string;
  members: CollectedMember[];
  /** スケジュールが 2 つ以上あるときだけ入る (`ReminderPreview` と同じ)。 */
  scheduleId: string | null;
  scheduleName: string | null;
  /** 自前作成式の予定の ID (`ReminderPreview` と同じ)。 */
  sessionId: string | null;
};


/** sync モード (character-sheets) から対象日の出欠を集める。 */
async function collectFromSync(targetDayKey: string): Promise<Collected[]> {
  const result = await fetchScheduleRaw();
  if (!result.ok) return [];
  const { users, sessions } = result.data;
  // 対象日 (JST 暦日) の候補行。確定 (DECISION) / 候補 (CANDIDATE) の
  // どちらも催促対象にする — 候補日こそ入力が要るため。
  const session = sessions.find(
    (s) => jstDayKey(s.date.getTime()) === targetDayKey,
  );
  if (!session) return [];
  return [
    {
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
      // 同期式はスケジュールが 1 つ (表示中のシート) だけ。
      scheduleId: null,
      scheduleName: null,
      sessionId: null,
    },
  ];
}

/**
 * native モードから対象日の出欠を集める。
 *
 * 2026-10-02 (複数スケジュールの段階 2): 段階 1 は表示中のスケジュールだけを
 * 見ていたが、**全スケジュール** の対象日の予定を集める (零式を表示中の間も
 * 絶の日に催促が飛ぶように)。メンバーは全スケジュール共通のまま (ADR-002 の
 * 前提)。スケジュールが 2 つ以上あるときだけ、予定にスケジュールの ID と名前を
 * 付ける (本文の見出しと送信の印に使う)。
 */
async function collectFromNative(targetDayKey: string): Promise<Collected[]> {
  const supabase = createSupabaseServiceRoleClient();
  const [sessionsRes, schedulesRes] = await Promise.all([
    supabase
      .from("native_schedule_sessions")
      // W-18 (2026-09-08): is_optional を追加 (有志練習は催促しない)。
      .select(
        "id, schedule_id, raw_date, parsed_date, start_time, end_time, day_of_week, status, is_optional",
      )
      .neq("status", "CANCELLED"),
    supabase
      .from("native_schedules")
      .select("id, name, sort_order")
      .order("sort_order", { ascending: true }),
  ]);
  if (sessionsRes.error || !sessionsRes.data) return [];
  const schedules = (schedulesRes.data ?? []) as Array<{ id: string; name: string }>;
  const multi = schedules.length > 1;
  const scheduleOrder = new Map(schedules.map((sc, i) => [sc.id, i]));
  const scheduleName = new Map(schedules.map((sc) => [sc.id, sc.name]));

  const sessions = (
    sessionsRes.data as Array<{
      id: string;
      schedule_id: string | null;
      raw_date: string;
      parsed_date: string;
      start_time: string | null;
      end_time: string | null;
      day_of_week: string;
      is_optional?: boolean;
    }>
  )
    .filter((s) => {
      const ms = new Date(s.parsed_date).getTime();
      return Number.isFinite(ms) && jstDayKey(ms) === targetDayKey;
    })
    // W-18 (2026-09-08): 有志練習 (任意参加) の日は催促しない。「参加できる人
    // だけ」の日に未回答メンションを飛ばすのは矛盾していて、催促圧だけが残る。
    .filter((s) => s.is_optional !== true)
    // 並びはスケジュールの並び順 → 開始時刻 (本文に並べる順)。
    .sort(
      (a, b) =>
        (scheduleOrder.get(a.schedule_id ?? "") ?? 0) -
          (scheduleOrder.get(b.schedule_id ?? "") ?? 0) ||
        a.parsed_date.localeCompare(b.parsed_date),
    );
  if (sessions.length === 0) return [];

  const [membersRes, attendancesRes] = await Promise.all([
    supabase
      .from("native_schedule_members")
      .select("discord_user_id, display_name, is_active")
      .eq("is_active", true)
      .order("sort_order", { ascending: true }),
    supabase
      .from("native_schedule_attendances")
      .select("session_id, discord_user_id, symbol")
      .in(
        "session_id",
        sessions.map((s) => s.id),
      ),
  ]);
  const symbolBy = new Map<string, Map<string, string>>();
  for (const a of (attendancesRes.data ?? []) as Array<{
    session_id: string;
    discord_user_id: string;
    symbol: string;
  }>) {
    const bySession = symbolBy.get(a.session_id) ?? new Map<string, string>();
    bySession.set(a.discord_user_id, a.symbol);
    symbolBy.set(a.session_id, bySession);
  }
  const members = (membersRes.data ?? []) as Array<{
    discord_user_id: string;
    display_name: string;
  }>;

  return sessions.map((session) => {
    const symbols = symbolBy.get(session.id) ?? new Map<string, string>();
    const id = multi ? session.schedule_id : null;
    return {
      rawDate: session.raw_date,
      dayOfWeek: session.day_of_week,
      startTime: session.start_time ?? "",
      endTime: session.end_time ?? "",
      members: members.map((m) => ({
        name: m.display_name,
        answered: !isUnanswered(symbols.get(m.discord_user_id)),
        discordUserId: DISCORD_ID_RE.test(m.discord_user_id)
          ? m.discord_user_id
          : null,
      })),
      scheduleId: id,
      scheduleName: id ? (scheduleName.get(id) ?? null) : null,
      sessionId: session.id,
    };
  });
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
    scheduleName: preview.scheduleName,
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

  // W-20 (2026-09-07): 頻度の設定。`once` (既定) は現行どおり期限の日だけ、
  // `once_plus_day_of` は期限 + 当日、`daily` は期限から当日まで毎日。
  // 未入力者がいる最初の (= 期限が最も遠い) 日を対象にする。
  const cadence = parseReminderCadence(await fetchAppSetting(REMINDER_CADENCE_KEY));
  const leadDays = parseIntSetting(
    await fetchAppSetting(REMINDER_LEAD_DAYS_KEY),
    REMINDER_DEFAULT_LEAD_DAYS,
    0,
    14,
  );
  const todayKey = jstDayKey(Date.now());
  // 送信済みの印は手動送信でも読む (印を書き換えるときに、範囲内の送信済みの
  // 予定を落とさないため)。送らない判定に使うのは cron (respectDedup) だけ。
  const lastSent = (await fetchAppSetting(REMINDER_LAST_SENT_KEY)) ?? "";
  const sentMarkers = new Set(parseReminderMarkers(lastSent));

  // 2026-10-02 (複数スケジュールの段階 2): 1 つの日に複数のスケジュールの
  // 予定があり得るので、試す日ごとに予定を全部集める。
  type Candidate = { lead: number; preview: ReminderPreview; marker: string };
  const candidates: Candidate[] = [];
  let lastReason = "対象の開催予定なし";
  for (const lead of reminderLeadDaysToTry(cadence, leadDays)) {
    for (const p of await buildReminderPreviews({ leadDays: lead })) {
      if (p.targets.length === 0) {
        lastReason = "未入力者なし";
        continue;
      }
      candidates.push({
        lead,
        preview: p,
        marker: reminderDedupMarker(
          cadence,
          reminderSessionKey(p.rawDate, p.scheduleId),
          todayKey,
        ),
      });
    }
  }
  // 期限が遠い日から順に、まだ送っていない予定がある最初の日の予定をまとめて
  // 1 通にする。印は「今の範囲の送信済み + 今回送るもの」(`pickReminderBatch`)。
  const { picked, marker } = pickReminderBatch(
    candidates,
    reminderLeadDaysToTry(cadence, leadDays),
    sentMarkers,
    input.respectDedup,
  );
  if (picked.length === 0) {
    if (candidates.length > 0) lastReason = "送信済み";
    return { ok: true, posted: 0, skipped: 1, reason: lastReason };
  }

  const channelId =
    (await fetchAppSetting(REMINDER_CHANNEL_KEY))?.trim() ||
    (await fetchAppSetting(NATIVE_NOTIFY_CHANNEL_KEY))?.trim() ||
    "";
  if (!channelId) return { ok: false, reason: "投稿先チャンネル ID 未設定" };

  const content = clampDiscordContent(
    (await Promise.all(picked.map((c) => buildReminderMessage(c.preview)))).join(
      "\n\n",
    ),
  );
  const mentionIds = [
    ...new Set(
      picked.flatMap((c) =>
        c.preview.targets
          .map((t) => t.discordUserId)
          .filter((id): id is string => id !== null),
      ),
    ),
  ];

  const components = await reminderButtons(picked.map((c) => c.preview));

  const supabase = createSupabaseServiceRoleClient();

  // C-4 (2026-10-01 監査): cron (respectDedup) は**印を先に取れた実行だけが
  // 送る**。以前は「印を読む → 送る → 印を書く」の順で、同じ分に 2 回起動
  // されると両方が古い印を読んで二重にメンションした。開催確定の通知
  // (native-schedule-discord.ts の A-5.2) と同じ先取り方式。
  if (input.respectDedup) {
    let claimed: boolean;
    try {
      claimed = await claimMarker(reminderMarkerOps(supabase, marker));
    } catch (e) {
      // 取れたか分からないまま送ると二重送信に戻るので、送らない。
      // 次の毎時 cron が取り直す。
      console.warn("[attendance-reminder] dedup marker claim failed:", e);
      return { ok: false, reason: "送信済みの印を確認できませんでした" };
    }
    if (!claimed) {
      return { ok: true, posted: 0, skipped: 1, reason: "送信済み" };
    }
  }

  const posted = await postToDiscord({
    botToken,
    channelId,
    content,
    userIds: mentionIds,
    components,
  });
  if (!posted.ok) {
    if (input.respectDedup) {
      // 送れなかったので印を戻し、次の毎時 cron で送り直せるようにする。
      // 戻すのは「自分が書いた印のまま」の場合だけ (別の実行が後から
      // 書いた印は消さない)。
      const { error: rbErr } = await supabase
        .from("app_settings")
        .update({ value: lastSent || null })
        .eq("key", REMINDER_LAST_SENT_KEY)
        .eq("value", marker);
      if (rbErr) {
        console.warn(
          "[attendance-reminder] dedup marker rollback failed:",
          rbErr.message,
        );
      }
    }
    return { ok: false, reason: posted.reason };
  }

  // 手動の「今すぐ送る」(respectDedup=false) は意図的に毎回送るので、
  // 従来どおり送った後に印を書く (次の cron が同じ日に重ねて送らないように)。
  if (!input.respectDedup) {
    const { error: markErr } = await supabase
      .from("app_settings")
      .upsert(
        { key: REMINDER_LAST_SENT_KEY, value: marker },
        { onConflict: "key" },
      );
    if (markErr) {
      console.warn(
        "[attendance-reminder] dedup marker update failed:",
        markErr.message,
      );
    }
  }

  return { ok: true, posted: 1, skipped: 0 };
}

/**
 * 回答ボタン (W-21、2026-10-05)。設定が ON で、サーバーに `DISCORD_PUBLIC_KEY` が
 * あり、自前作成式の予定 (`sessionId` がある) のときだけ付ける。どれかが欠けたら
 * 空 = 従来どおりボタン無しで送る (ボタンが付かないことで催促が止まらないように)。
 */
async function reminderButtons(
  previews: ReadonlyArray<ReminderPreview>,
): Promise<ActionRow[]> {
  if (!process.env.DISCORD_PUBLIC_KEY?.trim()) return [];
  const [enabled, choicesCsv] = await Promise.all([
    fetchAppSetting(REMINDER_BUTTONS_KEY),
    fetchAppSetting(NATIVE_CHOICE_VALUES_KEY),
  ]);
  if (enabled !== "true") return [];
  const sessions = previews.flatMap((p) =>
    p.sessionId
      ? [{ sessionId: p.sessionId, label: sessionButtonLabel(p.rawDate, p.scheduleName) }]
      : [],
  );
  if (sessions.length === 0) return [];
  return attendanceComponents(
    sessions,
    attendanceButtonChoices(parseChoiceValues(choicesCsv).values),
  );
}

/**
 * `claimMarker` に渡す 3 段の条件付き書き込み (`app_settings` の 1 行)。
 * どの段も「条件に合う行を印に書き換え、書き換えた行を返す」1 文。
 */
function reminderMarkerOps(
  supabase: ReturnType<typeof createSupabaseServiceRoleClient>,
  marker: string,
): MarkerClaimOps {
  const touched = (res: { data: unknown[] | null; error: { message: string } | null }) => {
    if (res.error) throw new Error(res.error.message);
    return (res.data?.length ?? 0) > 0;
  };
  return {
    replaceDifferent: async () =>
      touched(
        await supabase
          .from("app_settings")
          .update({ value: marker })
          .eq("key", REMINDER_LAST_SENT_KEY)
          .neq("value", marker)
          .select("key"),
      ),
    replaceNull: async () =>
      touched(
        await supabase
          .from("app_settings")
          .update({ value: marker })
          .eq("key", REMINDER_LAST_SENT_KEY)
          .is("value", null)
          .select("key"),
      ),
    insertIfAbsent: async () =>
      touched(
        await supabase
          .from("app_settings")
          .upsert(
            { key: REMINDER_LAST_SENT_KEY, value: marker },
            { onConflict: "key", ignoreDuplicates: true },
          )
          .select("key"),
      ),
  };
}

async function postToDiscord(input: {
  botToken: string;
  channelId: string;
  content: string;
  userIds: string[];
  /** 回答ボタン (W-21)。空なら付けない。 */
  components: ActionRow[];
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    // 2026-10-01 監査 C-9: 429 は retry_after だけ待って 1 回だけ送り直す
    // (429 は未処理の意味なので二重投稿にはならない)。
    const res = await discordFetch(
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
          ...(input.components.length > 0 ? { components: input.components } : {}),
        }),
        timeoutMs: 15000,
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
