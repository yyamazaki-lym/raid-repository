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
// 2.1 (2026-05-12) PR3-A: 通知 message template (placeholder 置換式)。
const NOTIFY_TEMPLATE_KEY = "native_schedule_discord_notify_template";

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

  const nowIso = new Date().toISOString();

  // A-5.2 (2026-06-13): respectDedup=true (cron) は「先取り条件付き UPDATE →
  // 成功時のみ POST」に反転する。旧来は POST 成功 *後* に last_notified_at を
  // UPDATE していたため、毎時 cron の候補 SELECT (`is last_notified_at null`) と
  // この UPDATE の間に別 cron 実行が割り込むと、両方が null を見て二重通知し得た。
  // `is("last_notified_at", null)` 付き UPDATE を先に走らせ、行を claim できた
  // 実行だけが POST する (Postgres の行ロックで排他)。claim できなければ既に
  // 他実行が通知済み → skip。POST 失敗時は claim を null に戻して次回 cron で
  // 再試行可能にする (at-most-once claim + best-effort 再送)。
  if (input.respectDedup) {
    const { data: claimed, error: claimErr } = await supabase
      .from("native_schedule_sessions")
      .update({ last_notified_at: nowIso })
      .eq("id", session.id)
      .is("last_notified_at", null)
      .select("id")
      .maybeSingle();
    if (claimErr) {
      return { ok: false, reason: `claim: ${claimErr.message}` };
    }
    if (!claimed) {
      // 既に他実行が claim 済 (= 通知済み)。二重通知を防ぐため skip。
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
      const { error: rbErr } = await supabase
        .from("native_schedule_sessions")
        .update({ last_notified_at: null })
        .eq("id", session.id);
      if (rbErr) {
        console.warn(
          "[native-discord] rollback of last_notified_at failed:",
          rbErr.message,
        );
      }
      return { ok: false, reason: postResult.reason };
    }
    return { ok: true, posted: 1, skipped: 0 };
  }

  // respectDedup=false (手動 Bell の再通知): 意図的に毎回送るため、従来どおり
  // POST → タイムスタンプ更新の順序。
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
    .update({ last_notified_at: nowIso })
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
  // `app_settings.native_schedule_discord_notify_hour` (default '12') を目標時とする。
  //
  // 監査バッチC #1 (2026-06-24): 旧実装は `nowJstHour !== targetHour` で「目標時
  // ちょうど」の 1 回だけに発火を限定していたため、その単発が失敗 (Discord API
  // エラー / cold start timeout / pg_net 一過性失敗) すると、parsed_date ベースの
  // 当日窓が翌日には前進し、last_notified_at を rollback しても二度と拾われず当日
  // 通知が恒久ミスしていた。`< targetHour` に緩め「目標時以降・当日内」の毎時 cron
  // で未通知 DECISION を再試行する。dedup (`last_notified_at` の claim、
  // notifyNativeScheduleSession 内) が二重送信を抑止するため、成功した最初の 1 回
  // だけ送られる (目標時より遅れて届く可能性は許容)。notify を日中 OFF→ON した
  // 場合も次の毎時 cron で当日分を送れる。
  const hourRaw = await fetchAppSetting(NOTIFY_HOUR_KEY);
  const targetHour = parseHour(hourRaw);
  const nowJstHour = getJstHour();
  if (nowJstHour < targetHour) {
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
export function computeJstTodayUtcRange(): {
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

/**
 * Discord mention の発火トリガーを無害化する二次防御 (2.8 follow-up)。
 * 通知本文に入るユーザー/admin 入力 (note / display_name / symbol) に適用する。
 * postToDiscord の `allowed_mentions` で ping 自体は既に抑止しているが、その
 * 単一防御が将来緩められた場合の退行に備え、`@everyone`/`@here` とユーザー/
 * ロール/チャンネル mention 構文をゼロ幅スペースで崩す (表示はほぼ不変)。
 */
function neutralizeMentions(s: string): string {
  // U+200B (ゼロ幅スペース) を mention トリガー直後に挿入して構文を崩す。
  // ソースに不可視文字を埋め込まないよう codePoint から組み立てる。
  const zwsp = String.fromCharCode(0x200b);
  return s
    .replace(/@(everyone|here)/g, "@" + zwsp + "$1")
    .replace(/<(@[!&]?|#)/g, "<" + zwsp + "$1");
}

/**
 * 2.9 follow-up (2026-06-12): symbol の read 時サニタイズ。
 * write 側 (upsertNativeScheduleAttendanceAction の制御文字除去 + 32 字制限,
 * #177) と DB の CHECK 制約 (schema.sql §5e, NOT VALID = 既存行は未検証) を
 * 迂回した legacy/直叩き行が混ざっていても、通知本文には複数行・長文が
 * 流入しないよう mention 無害化と同じ「読み出し時防御」を重ねる。
 * write 側と同一の正規化 (制御文字→空白 / 連続空白圧縮 / trim / 32 字)。
 */
function sanitizeSymbol(s: string): string {
  return neutralizeMentions(
    s
      .replace(/\p{Cc}/gu, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 32),
  );
}

async function buildMessage(
  supabase: SupabaseClient,
  session: SessionRow,
  roleId: string | null,
): Promise<string> {
  const [membersRes, attendancesRes, timeDefaults, templateRaw] =
    await Promise.all([
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
      fetchAppSetting(NOTIFY_TEMPLATE_KEY),
    ]);

  const members = (membersRes.data ?? []) as MemberRow[];
  const attendances = (attendancesRes.data ?? []) as AttendanceRow[];

  const symbolBy: Record<string, string> = {};
  for (const a of attendances) {
    if (a.symbol && a.symbol.trim()) {
      const sym = sanitizeSymbol(a.symbol);
      // sanitize 後に空になる行 (制御文字のみ等) は未回答扱いに落とす
      if (sym) symbolBy[a.discord_user_id] = sym;
    }
  }

  const buckets = new Map<string, string[]>();
  const unanswered: string[] = [];
  for (const m of members) {
    const displayName = neutralizeMentions(m.display_name);
    const sym = symbolBy[m.discord_user_id];
    if (sym) {
      const list = buckets.get(sym) ?? [];
      list.push(displayName);
      buckets.set(sym, list);
    } else {
      unanswered.push(displayName);
    }
  }
  const answered = members.length - unanswered.length;

  const mentionPrefix = roleId ? `<@&${roleId}> ` : "";
  // 2.1 (2026-05-12): NULL の row は default 時刻に追従させる。
  const startTime = session.start_time ?? timeDefaults.startTime;
  const endTime = session.end_time ?? timeDefaults.endTime;
  const note =
    session.note && session.note.trim()
      ? neutralizeMentions(session.note.trim())
      : "";
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim() ?? "";

  // 出欠ブロック (template / hardcode 共通)。
  const attendanceLines: string[] = [];
  attendanceLines.push(`出欠 (回答済 ${answered}/${members.length}):`);
  for (const [sym, names] of buckets) {
    attendanceLines.push(`　${sym}: ${names.join(", ")}`);
  }
  if (unanswered.length > 0) {
    attendanceLines.push(`　未回答: ${unanswered.join(", ")}`);
  }
  const attendance = attendanceLines.join("\n");

  // 2.1 (2026-05-12) PR3-A: app_settings に template があれば placeholder 置換、
  // 未設定 (空) なら現行 hardcode default を使う (既定 = 現行レイアウト)。
  const template = templateRaw?.trim() ? templateRaw : null;
  if (template) {
    const noteBlock = note ? `📝 ${note}\n` : "";
    const replacements: Record<string, string> = {
      "{mention}": mentionPrefix,
      "{date}": session.raw_date,
      "{day}": session.day_of_week,
      "{time_start}": startTime,
      "{time_end}": endTime,
      "{note}": note,
      "{note_block}": noteBlock,
      "{attendance}": attendance,
      "{site_url}": siteUrl,
    };
    return template.replace(
      /\{(mention|date|day|time_start|time_end|note|note_block|attendance|site_url)\}/g,
      (m) => replacements[m] ?? "",
    );
  }

  // 既定 (現行) hardcode フォーマット。
  const lines: string[] = [];
  lines.push(`${mentionPrefix}本日の固定活動予定日です`);
  lines.push("");
  lines.push(`📅 ${session.raw_date} (${session.day_of_week})`);
  lines.push(`🕘 ${startTime} 〜 ${endTime}`);
  if (note) {
    lines.push(`📝 ${note}`);
  }
  lines.push("");
  lines.push(attendance);
  if (siteUrl) {
    lines.push("");
    lines.push(siteUrl);
  }

  return lines.join("\n");
}

// 2.1 (2026-05-12) PR3-A: 既定 template の文字列定義は client-safe な共有
// module に分離 (admin UI と server で再利用)。
export { NATIVE_DISCORD_DEFAULT_TEMPLATE } from "@/lib/schedule/native-discord-template";

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
