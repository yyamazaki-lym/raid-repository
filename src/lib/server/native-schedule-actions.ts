"use server";

import { revalidatePath } from "next/cache";

import {
  createClient,
  createSupabaseServiceRoleClient,
} from "@/lib/supabase/server";

import { assertAdminResult, requireDiscordMember } from "./auth";
import {
  maybeAutoConfirmSession,
  AUTO_CONFIRM_ENABLED_KEY,
  AUTO_CONFIRM_MIN_AVAILABLE_KEY,
} from "./native-schedule-auto-confirm";
import { dbError } from "./db-error";
import {
  computeJstTodayUtcRange,
  notifyNativeScheduleSession,
} from "./native-schedule-discord";
import { NATIVE_CHOICE_VALUES_KEY } from "@/lib/schedule/settings-keys";
import {
  normalizeAttendanceTime,
  symbolAllowsTimes,
} from "@/lib/schedule/attendance-times";
import {
  expandRecurringDates,
  NATIVE_RECURRING_DOWS_KEY,
  serializeRecurringDows,
} from "@/lib/schedule/recurring-frames";

/**
 * TODO #2 phase 2-A (2026-05-07): native スケジュール用 Server Actions。
 *
 * - sessions / members / choice_values は admin gate (`assertAdminResult`)
 * - attendances upsert は本人 only (`requireDiscordMember` で discord_id 確定 →
 *   RLS の self-row policy が WITH CHECK で本人 row のみ通す)
 *
 * 戻り値は既存 setter (setScheduleUrlAction 等) と統一して
 * `{ ok: true } | { ok: false; reason: string }`。reason は toast にそのまま
 * 出すユーザー向けメッセージ。生 PG エラーは `dbError()` で server log のみ。
 *
 * UI からの呼び出しは Phase 2-B / 2-C で実装予定 (本 phase は server-side 基盤
 * のみ — popover / dialog / settings section は別セッション)。
 */

const SESSION_STATUSES = ["CANDIDATE", "DECISION", "CANCELLED"] as const;
type NativeSessionStatus = (typeof SESSION_STATUSES)[number];

// NATIVE_CHOICE_VALUES_KEY は settings-keys.ts へ集約 (A-2、読み書き両側で単一ソース)。
const NATIVE_DISCORD_NOTIFY_ENABLED_KEY =
  "native_schedule_discord_notify_enabled";
const NATIVE_DISCORD_NOTIFY_CHANNEL_KEY =
  "native_schedule_discord_notify_channel_id";
const NATIVE_DISCORD_NOTIFY_ROLE_KEY =
  "native_schedule_discord_notify_role_id";
const NATIVE_DISCORD_NOTIFY_HOUR_KEY =
  "native_schedule_discord_notify_hour";
// 2.1 (2026-05-12) PR3-A: 通知メッセージ template (placeholder 置換式)。
const NATIVE_DISCORD_NOTIFY_TEMPLATE_KEY =
  "native_schedule_discord_notify_template";
// 2.1 (2026-05-12) PR3-B: 確定 (DECISION 切替 / 新規 DECISION INSERT) 時の auto-notify ON/OFF。
const NATIVE_DISCORD_NOTIFY_ON_DECISION_KEY =
  "native_schedule_discord_notify_on_decision";

// ---- sessions (admin gate) ------------------------------------------------

export type CreateNativeScheduleSessionInput = {
  rawDate: string;
  parsedDate: string;
  startTime: string;
  endTime: string;
  dayOfWeek: string;
  note?: string;
};

export async function createNativeScheduleSessionAction(
  input: CreateNativeScheduleSessionInput,
): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: "ADMIN ロールが必要です" };

  const rawDate = input.rawDate?.trim();
  const parsedDate = input.parsedDate?.trim();
  const startTime = input.startTime?.trim();
  const endTime = input.endTime?.trim();
  const dayOfWeek = input.dayOfWeek?.trim();
  if (!rawDate || !parsedDate || !startTime || !endTime || !dayOfWeek) {
    return { ok: false, reason: "日時情報が不足しています" };
  }
  const noteRaw = input.note?.trim() ?? "";
  // 2026-07-12 監査 follow-up: update 側 (updateNativeScheduleSessionNoteAction)
  // と対称に 200 字を検証。DB の native_schedule_sessions_note_sane CHECK で
  // 生エラーになる前に友好メッセージを返す。
  if (noteRaw.length > 200) {
    return { ok: false, reason: "備考は 200 文字以内で入力してください" };
  }
  const note = noteRaw || null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("native_schedule_sessions")
    .insert({
      raw_date: rawDate,
      parsed_date: parsedDate,
      start_time: startTime,
      end_time: endTime,
      day_of_week: dayOfWeek,
      note,
      created_by_id: auth.user.discordId,
    })
    .select("id")
    .single();
  if (error) {
    if ((error as { code?: string }).code === "23505") {
      return { ok: false, reason: "同じ日時の候補日がすでにあります" };
    }
    return { ok: false, reason: dbError("候補日追加", error) };
  }
  try {
    revalidatePath("/");
  } catch {
    // best-effort
  }
  return { ok: true, id: data.id as string };
}

/**
 * 2.1 (2026-05-12) PR3-B: 確定 (DECISION) 切替 / 新規 DECISION INSERT 時の
 * auto-notify hook 共通 helper。`native_schedule_discord_notify_on_decision`
 * が "true" のとき、`notifyNativeScheduleSession({ respectToggle: true,
 * respectDedup: true })` で 1 件発火する。respectDedup: true で
 * `last_notified_at` が既に入っている row は skip され、同一 session の二重
 * 投稿が起きない (status を CANDIDATE←→DECISION で連打しても通知は 1 回)。
 *
 * 失敗時は warn log のみで握りつぶす (status 更新自体は成功している)。
 *
 * P3-q (2026-06-19 監査): 通知本文は「本日の固定活動予定日です」が固定文言の
 * ため、開催日が JST の今日でないセッション (= 数日先の候補を事前確定した場合)
 * に発火すると先頭文と日付が食い違う。当日リマインドは cron 経路
 * (`dispatchNoonNotifyForToday`) に一本化し、on-decision 自動通知は **開催日が
 * JST 今日のセッションのみ**に限定する。日付判定は cron と同じ timestamptz 範囲
 * クエリ (`computeJstTodayUtcRange`) を Postgres 側で評価して ISO 表記揺れを避ける。
 * 手動 Bell ボタン (`notifyNativeScheduleSessionAction`) は日付を問わず従来どおり。
 */
async function maybeAutoNotifyOnDecision(sessionId: string): Promise<void> {
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", NATIVE_DISCORD_NOTIFY_ON_DECISION_KEY)
      .maybeSingle();
    const enabled = (data as { value?: string } | null)?.value === "true";
    if (!enabled) return;
    // 開催日が JST 今日でなければ当日通知しない (cron と同じ範囲判定を Postgres 側で)。
    const { todayStartUtc, tomorrowStartUtc } = computeJstTodayUtcRange();
    const { data: todaySession } = await supabase
      .from("native_schedule_sessions")
      .select("id")
      .eq("id", sessionId)
      .gte("parsed_date", todayStartUtc)
      .lt("parsed_date", tomorrowStartUtc)
      .maybeSingle();
    if (!todaySession) return;
    const r = await notifyNativeScheduleSession({
      sessionId,
      respectToggle: true,
      respectDedup: true,
    });
    if (!r.ok) {
      console.warn(
        "[native-schedule] auto-notify on DECISION failed:",
        r.reason,
      );
    }
  } catch (err) {
    console.warn("[native-schedule] auto-notify hook error:", err);
  }
}

export async function deleteNativeScheduleSessionAction(
  id: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: "ADMIN ロールが必要です" };
  const trimmed = id?.trim();
  if (!trimmed) return { ok: false, reason: "id が空です" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("native_schedule_sessions")
    .delete()
    .eq("id", trimmed);
  if (error) return { ok: false, reason: dbError("候補日削除", error) };
  try {
    revalidatePath("/");
  } catch {
    // best-effort
  }
  return { ok: true };
}

export async function setNativeScheduleSessionStatusAction(
  id: string,
  status: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: "ADMIN ロールが必要です" };
  const trimmed = id?.trim();
  if (!trimmed) return { ok: false, reason: "id が空です" };
  if (!SESSION_STATUSES.includes(status as NativeSessionStatus)) {
    return {
      ok: false,
      reason: "status は CANDIDATE / DECISION / CANCELLED のいずれかです",
    };
  }

  const supabase = await createClient();
  // P3-f (2026-06-19 監査): `.select("id").maybeSingle()` で実更新行を確認する。
  // 付けないと存在しない / 既に削除済みの id でも error=null → ok:true を返し、
  // しかも DECISION なら下の maybeAutoNotifyOnDecision まで走って「成功」表示に
  // なる (実際は no-op)。0 行なら失敗扱いにし、通知も行ヒット時のみ発火させる。
  const { data: updated, error } = await supabase
    .from("native_schedule_sessions")
    .update({ status })
    .eq("id", trimmed)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, reason: dbError("status 更新", error) };
  if (!updated) {
    return { ok: false, reason: "対象の候補日が見つかりませんでした" };
  }
  try {
    revalidatePath("/");
  } catch {
    // best-effort
  }
  // 2.1 (2026-05-12) PR3-B: DECISION 切替時に auto-notify (flag 確認 + dedup あり)。
  // P3-f: 実際に更新できた (行ヒット) 場合のみ発火し、stale id での誤通知を防ぐ。
  if ((status as NativeSessionStatus) === "DECISION") {
    await maybeAutoNotifyOnDecision(trimmed);
  }
  return { ok: true };
}

/**
 * 2.1 (2026-05-12): 日個別の raid time を override / default 戻しするための
 * admin only action。`startTime` / `endTime` のいずれかが null なら DB を NULL
 * に UPDATE = default 追従に戻す。両方 string なら override 値を書き込む。
 * HH:MM regex で validate。
 */
const HHMM_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

export type UpdateNativeScheduleSessionTimeInput = {
  sessionId: string;
  startTime: string | null;
  endTime: string | null;
};

export async function updateNativeScheduleSessionTimeAction(
  input: UpdateNativeScheduleSessionTimeInput,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: "ADMIN ロールが必要です" };
  const trimmed = input.sessionId?.trim();
  if (!trimmed) return { ok: false, reason: "sessionId が空です" };

  // 「両方 null = default に戻す」「両方 string = override」のいずれかのみ許容。
  // 片方だけ null の半 override は、通知/表示側 (native-schedule-discord.ts) が
  // start/end を各々独立に COALESCE するため「開始=個別 override / 終了=default」
  // の混在時刻を生む。UI は常に両方送るが、Server Action 直叩き等で半 null が
  // 永続化されるのを防ぐため明示的に弾く。
  const startTime = input.startTime?.trim() || null;
  const endTime = input.endTime?.trim() || null;
  if (startTime !== null && !HHMM_RE.test(startTime)) {
    return { ok: false, reason: "開始時刻は HH:MM 形式で入力してください" };
  }
  if (endTime !== null && !HHMM_RE.test(endTime)) {
    return { ok: false, reason: "終了時刻は HH:MM 形式で入力してください" };
  }
  if ((startTime === null) !== (endTime === null)) {
    return {
      ok: false,
      reason: "開始・終了時刻は両方指定するか、両方 default に戻してください",
    };
  }
  if (startTime !== null && endTime !== null && startTime === endTime) {
    return { ok: false, reason: "開始時刻と終了時刻が同じです" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("native_schedule_sessions")
    .update({ start_time: startTime, end_time: endTime })
    .eq("id", trimmed);
  if (error) return { ok: false, reason: dbError("時刻更新", error) };
  try {
    revalidatePath("/");
  } catch {
    // best-effort
  }
  return { ok: true };
}

/**
 * 2.8 (2026-06-10) TODO #81 follow-up: native session の note を admin が
 * 編集する action。空文字列は NULL に正規化 (= note 削除扱い)。200 文字超は
 * reject (CandidateDateDialog の Textarea maxLength={200} と揃える)。
 */
export type UpdateNativeScheduleSessionNoteInput = {
  sessionId: string;
  note: string | null;
};

export async function updateNativeScheduleSessionNoteAction(
  input: UpdateNativeScheduleSessionNoteInput,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: "ADMIN ロールが必要です" };
  const trimmed = input.sessionId?.trim();
  if (!trimmed) return { ok: false, reason: "sessionId が空です" };

  const raw = (input.note ?? "").trim();
  if (raw.length > 200) {
    return { ok: false, reason: "備考は 200 文字以内で入力してください" };
  }
  const normalized = raw || null;

  const supabase = await createClient();
  const { error } = await supabase
    .from("native_schedule_sessions")
    .update({ note: normalized })
    .eq("id", trimmed);
  if (error) return { ok: false, reason: dbError("備考更新", error) };
  try {
    revalidatePath("/");
  } catch {
    // best-effort
  }
  return { ok: true };
}

/**
 * W-18 (2026-09-08): 有志練習 (任意参加) フラグの切り替え。
 *
 * 調査ノート第 4 回 7-B W-18 の趣旨は「参加できる人だけ」を公式化すること。
 * フラグを立てた日は自動確定・未回答の催促・出席統計から外れる (判定は
 * それぞれ `native-schedule-auto-confirm.ts` / `attendance-reminder.ts` /
 * 出席サマリー側が同じ列を見る)。
 *
 * 入口は時刻編集 popover のチェックボックス 1 つだけにしている — 種別を
 * 増やす (session_type enum 等) と status との組み合わせが増えて確定判定が
 * 複雑になるため、**boolean 1 列で足りる範囲に留める**。
 */
export type UpdateNativeScheduleSessionOptionalInput = {
  sessionId: string;
  isOptional: boolean;
};

export async function updateNativeScheduleSessionOptionalAction(
  input: UpdateNativeScheduleSessionOptionalInput,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: "ADMIN ロールが必要です" };
  const trimmed = input.sessionId?.trim();
  if (!trimmed) return { ok: false, reason: "sessionId が空です" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("native_schedule_sessions")
    .update({ is_optional: input.isOptional === true })
    .eq("id", trimmed);
  if (error) return { ok: false, reason: dbError("有志練習の切替", error) };
  try {
    revalidatePath("/");
  } catch {
    // best-effort
  }
  return { ok: true };
}

// ---- members (admin gate) -------------------------------------------------

const DISCORD_ID_RE = /^\d{17,20}$/;
/**
 * member の主キー (`native_schedule_members.discord_user_id`) として許容するキー。
 * - 17〜20 桁数字: 通常の Discord ID (本人 popover / 個別通知の対象)
 * - `local_<英数字_->{3,32}`: Discord アカウント未取得メンバー用ローカルキー。
 *   本人として popover を開けないため admin が代理入力する運用想定。
 */
const MEMBER_KEY_RE = /^(?:\d{17,20}|local_[A-Za-z0-9_-]{3,32})$/;
const MEMBER_KEY_REASON =
  "Discord ID (17〜20 桁の数字) またはローカルキー (local_<英数字>, 3〜32 文字) を入力してください";

export type AddNativeScheduleMemberInput = {
  discordUserId: string;
  displayName: string;
  sortOrder?: number;
};

export async function addNativeScheduleMemberAction(
  input: AddNativeScheduleMemberInput,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: "ADMIN ロールが必要です" };

  const discordUserId = input.discordUserId?.trim();
  const displayName = input.displayName?.trim();
  if (!discordUserId || !MEMBER_KEY_RE.test(discordUserId)) {
    return { ok: false, reason: MEMBER_KEY_REASON };
  }
  if (!displayName) return { ok: false, reason: "表示名を入力してください" };
  const sortOrder = Number.isFinite(input.sortOrder) ? Number(input.sortOrder) : 0;

  const supabase = await createClient();
  const { error } = await supabase.from("native_schedule_members").insert({
    discord_user_id: discordUserId,
    display_name: displayName,
    sort_order: sortOrder,
    is_active: true,
  });
  if (error) {
    if ((error as { code?: string }).code === "23505") {
      return { ok: false, reason: "この Discord ID はすでに登録済みです" };
    }
    return { ok: false, reason: dbError("メンバー追加", error) };
  }
  try {
    revalidatePath("/");
  } catch {
    // best-effort
  }
  return { ok: true };
}

export type UpdateNativeScheduleMemberPatch = {
  displayName?: string;
  sortOrder?: number;
  isActive?: boolean;
  /**
   * W-33 ③ (2026-09-07): データセンター名 (自由記述、20 文字)。空文字列は
   * NULL に正規化 (= 未設定)。DC 名は運営の再編で増減するので enum にしない。
   */
  dataCenter?: string | null;
  /**
   * W-6 (2026-09-08): 出席の自動突合に使う FFLogs のキャラクター名
   * (64 文字)。空文字列は NULL に正規化 (= 未設定 → 表示名で一致を試す)。
   */
  fflogsCharacterName?: string | null;
};

export async function updateNativeScheduleMemberAction(
  discordUserId: string,
  patch: UpdateNativeScheduleMemberPatch,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: "ADMIN ロールが必要です" };
  const id = discordUserId?.trim();
  if (!id || !MEMBER_KEY_RE.test(id)) {
    return { ok: false, reason: "メンバーキーが不正です" };
  }

  const update: Record<string, unknown> = {};
  if (patch.displayName !== undefined) {
    const v = patch.displayName.trim();
    if (!v) return { ok: false, reason: "表示名を入力してください" };
    update.display_name = v;
  }
  if (patch.sortOrder !== undefined) {
    if (!Number.isFinite(patch.sortOrder)) {
      return { ok: false, reason: "並び順は数値で指定してください" };
    }
    update.sort_order = patch.sortOrder;
  }
  if (patch.isActive !== undefined) {
    update.is_active = !!patch.isActive;
  }
  if (patch.dataCenter !== undefined) {
    const v = (patch.dataCenter ?? "").trim();
    if (v.length > 20) {
      return { ok: false, reason: "データセンター名は 20 文字以内です" };
    }
    update.data_center = v || null;
  }
  if (patch.fflogsCharacterName !== undefined) {
    const v = (patch.fflogsCharacterName ?? "").trim();
    if (v.length > 64) {
      return { ok: false, reason: "キャラクター名は 64 文字以内です" };
    }
    update.fflogs_character_name = v || null;
  }
  if (Object.keys(update).length === 0) {
    return { ok: false, reason: "更新項目がありません" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("native_schedule_members")
    .update(update)
    .eq("discord_user_id", id);
  if (error) return { ok: false, reason: dbError("メンバー更新", error) };
  try {
    revalidatePath("/");
  } catch {
    // best-effort
  }
  return { ok: true };
}

/**
 * 2.1 (2026-05-12) PR3-D: メンバー全体コメント (同期式準拠で 1 メンバー = 1 行)
 * を本人だけが更新できる action。RLS は admin only のまま (display_name や
 * is_active を client から弄れないよう保護)、本 action は service role で
 * RLS を bypass しつつ「自分の discord_id == row.discord_user_id」のみ書ける。
 *
 * 空文字列は NULL に正規化 (= コメント削除)。500 文字制限。
 */
export async function updateNativeScheduleMemberCommentAction(input: {
  comment: string | null;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const member = await requireDiscordMember();

  // PUBLIC_DEMO_MODE の匿名ゲスト (実セッションなし) はこの action 唯一の
  // service role 経由書き込みで RLS を bypass できてしまうため明示的に弾く。
  // demo は read-only 公開が前提で、ゲストの discord_id は固定値
  // ("public-demo-mode-guest") なので該当 row を改竄させない。実セッションを
  // 持つ guild member (owner 等) は isDemoGuest が undefined なので通過する。
  if (member.isDemoGuest) {
    return { ok: false, reason: "デモ表示中はコメントを編集できません" };
  }

  const raw = (input.comment ?? "").trim();
  if (raw.length > 500) {
    return { ok: false, reason: "コメントは 500 文字以内で入力してください" };
  }
  const normalized = raw || null;

  // RLS は admin only。service role で bypass しつつ本人 row のみ UPDATE。
  const supabase = createSupabaseServiceRoleClient();
  const { error } = await supabase
    .from("native_schedule_members")
    .update({ comment: normalized })
    .eq("discord_user_id", member.discordId);
  if (error) return { ok: false, reason: dbError("コメント更新", error) };
  try {
    revalidatePath("/");
  } catch {
    // best-effort
  }
  return { ok: true };
}

export async function deleteNativeScheduleMemberAction(
  discordUserId: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: "ADMIN ロールが必要です" };
  const id = discordUserId?.trim();
  if (!id || !MEMBER_KEY_RE.test(id)) {
    return { ok: false, reason: "メンバーキーが不正です" };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("native_schedule_members")
    .delete()
    .eq("discord_user_id", id);
  if (error) return { ok: false, reason: dbError("メンバー削除", error) };
  try {
    revalidatePath("/");
  } catch {
    // best-effort
  }
  return { ok: true };
}

// ---- choice values (admin gate, app_settings key) ------------------------

/**
 * 凡例マスター。CSV 形式で `app_settings.native_schedule_choice_values` に
 * 保存。空文字列で削除 (= fallback の既定値 ["○","×","△","⏰","－"] に戻る)。
 */
export async function setNativeScheduleChoiceValuesAction(
  csv: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: "ADMIN ロールが必要です" };

  const trimmed = csv.trim();
  const supabase = await createClient();

  if (!trimmed) {
    const { error } = await supabase
      .from("app_settings")
      .delete()
      .eq("key", NATIVE_CHOICE_VALUES_KEY);
    if (error) return { ok: false, reason: dbError("凡例削除", error) };
    try {
      revalidatePath("/");
    } catch {
      // best-effort
    }
    return { ok: true };
  }

  const items = trimmed
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (items.length === 0) {
    return { ok: false, reason: "凡例を 1 つ以上指定してください" };
  }
  const value = items.join(",");

  const { error } = await supabase
    .from("app_settings")
    .upsert(
      { key: NATIVE_CHOICE_VALUES_KEY, value },
      { onConflict: "key" },
    );
  if (error) return { ok: false, reason: dbError("凡例保存", error) };
  try {
    revalidatePath("/");
  } catch {
    // best-effort
  }
  return { ok: true };
}

// ---- discord notify settings (admin gate, app_settings keys) -----------

/**
 * TODO #2 phase 4 (2026-05-08): cron 自動通知の ON/OFF を `app_settings` に保存。
 * 手動 button (notifyNativeScheduleSessionAction) は本トグルを参照しない。
 */
export async function setNativeScheduleDiscordNotifyEnabledAction(
  enabled: boolean,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: "ADMIN ロールが必要です" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("app_settings")
    .upsert(
      { key: NATIVE_DISCORD_NOTIFY_ENABLED_KEY, value: enabled ? "true" : "false" },
      { onConflict: "key" },
    );
  if (error) return { ok: false, reason: dbError("通知 ON/OFF 保存", error) };
  try {
    revalidatePath("/");
  } catch {
    // best-effort
  }
  return { ok: true };
}

export async function setNativeScheduleDiscordNotifyChannelIdAction(
  channelId: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: "ADMIN ロールが必要です" };

  const trimmed = channelId.trim();
  const supabase = await createClient();

  if (!trimmed) {
    const { error } = await supabase
      .from("app_settings")
      .delete()
      .eq("key", NATIVE_DISCORD_NOTIFY_CHANNEL_KEY);
    if (error) return { ok: false, reason: dbError("Channel ID 削除", error) };
    try {
      revalidatePath("/");
    } catch {
      // best-effort
    }
    return { ok: true };
  }

  if (!DISCORD_ID_RE.test(trimmed)) {
    return { ok: false, reason: "Channel ID は 17〜20 桁の数字です" };
  }

  const { error } = await supabase
    .from("app_settings")
    .upsert(
      { key: NATIVE_DISCORD_NOTIFY_CHANNEL_KEY, value: trimmed },
      { onConflict: "key" },
    );
  if (error) return { ok: false, reason: dbError("Channel ID 保存", error) };
  try {
    revalidatePath("/");
  } catch {
    // best-effort
  }
  return { ok: true };
}

export async function setNativeScheduleDiscordNotifyRoleIdAction(
  roleId: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: "ADMIN ロールが必要です" };

  const trimmed = roleId.trim();
  const supabase = await createClient();

  if (!trimmed) {
    const { error } = await supabase
      .from("app_settings")
      .delete()
      .eq("key", NATIVE_DISCORD_NOTIFY_ROLE_KEY);
    if (error) return { ok: false, reason: dbError("Role ID 削除", error) };
    try {
      revalidatePath("/");
    } catch {
      // best-effort
    }
    return { ok: true };
  }

  if (!DISCORD_ID_RE.test(trimmed)) {
    return { ok: false, reason: "Role ID は 17〜20 桁の数字です" };
  }

  const { error } = await supabase
    .from("app_settings")
    .upsert(
      { key: NATIVE_DISCORD_NOTIFY_ROLE_KEY, value: trimmed },
      { onConflict: "key" },
    );
  if (error) return { ok: false, reason: dbError("Role ID 保存", error) };
  try {
    revalidatePath("/");
  } catch {
    // best-effort
  }
  return { ok: true };
}

/**
 * TODO #2 候補 B (2026-05-08): 通知時刻 (HH 0-23, JST) を `app_settings` に保存。
 * cron は毎時発火し、`dispatchNoonNotifyForToday()` が現在 JST hour と本値を
 * 比較して一致時のみ実通知。空文字列で DELETE → default '12' に戻る。
 */
export async function setNativeScheduleDiscordNotifyHourAction(
  hour: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: "ADMIN ロールが必要です" };

  const trimmed = hour.trim();
  const supabase = await createClient();

  if (!trimmed) {
    const { error } = await supabase
      .from("app_settings")
      .delete()
      .eq("key", NATIVE_DISCORD_NOTIFY_HOUR_KEY);
    if (error) return { ok: false, reason: dbError("通知時刻削除", error) };
    try {
      revalidatePath("/");
    } catch {
      // best-effort
    }
    return { ok: true };
  }

  const n = Number.parseInt(trimmed, 10);
  if (!Number.isInteger(n) || String(n) !== trimmed || n < 0 || n > 23) {
    return { ok: false, reason: "通知時刻は 0〜23 の整数です" };
  }

  const { error } = await supabase
    .from("app_settings")
    .upsert(
      { key: NATIVE_DISCORD_NOTIFY_HOUR_KEY, value: String(n) },
      { onConflict: "key" },
    );
  if (error) return { ok: false, reason: dbError("通知時刻保存", error) };
  try {
    revalidatePath("/");
  } catch {
    // best-effort
  }
  return { ok: true };
}

/**
 * 2.1 (2026-05-12) PR3-A: 通知メッセージ template 文字列を `app_settings` に保存。
 * placeholder: `{mention}` `{date}` `{day}` `{time_start}` `{time_end}` `{note}`
 *              `{attendance}` `{site_url}`。空文字列で DELETE → buildMessage の
 * hardcode default に戻る。
 */
export async function setNativeScheduleDiscordNotifyTemplateAction(
  template: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: "ADMIN ロールが必要です" };

  const trimmed = template ?? "";
  const supabase = await createClient();

  if (!trimmed.trim()) {
    const { error } = await supabase
      .from("app_settings")
      .delete()
      .eq("key", NATIVE_DISCORD_NOTIFY_TEMPLATE_KEY);
    if (error) {
      return { ok: false, reason: dbError("通知 template 削除", error) };
    }
    try {
      revalidatePath("/");
    } catch {
      // best-effort
    }
    return { ok: true };
  }

  if (trimmed.length > 4000) {
    return { ok: false, reason: "テンプレートは 4000 文字以内で入力してください" };
  }

  const { error } = await supabase
    .from("app_settings")
    .upsert(
      { key: NATIVE_DISCORD_NOTIFY_TEMPLATE_KEY, value: trimmed },
      { onConflict: "key" },
    );
  if (error) {
    return { ok: false, reason: dbError("通知 template 保存", error) };
  }
  try {
    revalidatePath("/");
  } catch {
    // best-effort
  }
  return { ok: true };
}

/**
 * 2.1 (2026-05-12) PR3-B: 確定時自動通知 ON/OFF を `app_settings` に保存。
 * default は OFF (キー未存在時)。
 */
export async function setNativeScheduleDiscordNotifyOnDecisionAction(
  enabled: boolean,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: "ADMIN ロールが必要です" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("app_settings")
    .upsert(
      {
        key: NATIVE_DISCORD_NOTIFY_ON_DECISION_KEY,
        value: enabled ? "true" : "false",
      },
      { onConflict: "key" },
    );
  if (error) {
    return { ok: false, reason: dbError("確定時自動通知 ON/OFF 保存", error) };
  }
  try {
    revalidatePath("/");
  } catch {
    // best-effort
  }
  return { ok: true };
}

/**
 * 手動「Discord 通知」button から呼ばれる。admin gate + ON/OFF と dedup
 * 両方を bypass で dispatch。再送可能。
 */
export async function notifyNativeScheduleSessionAction(
  sessionId: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: "ADMIN ロールが必要です" };
  const trimmed = sessionId?.trim();
  if (!trimmed) return { ok: false, reason: "sessionId が空です" };

  const r = await notifyNativeScheduleSession({
    sessionId: trimmed,
    respectToggle: false,
    respectDedup: false,
  });
  if (!r.ok) return { ok: false, reason: r.reason };
  return { ok: true };
}

// ---- attendances (本人 only via RLS) ------------------------------------

export type UpsertNativeScheduleAttendanceInput = {
  sessionId: string;
  symbol: string;
  comment?: string;
  /**
   * 2026-09-06 (W-13): 遅刻の到着予定 / 早退の予定時刻 (HH:MM)。null / 空 =
   * なし。× (不参加) や未回答のときは保存しない (常に null に落とす)。
   */
  arriveAt?: string | null;
  leaveAt?: string | null;
};

/**
 * 本人 (= 認証済 Discord メンバー) が自分の attendance row を upsert する。
 * admin gate ではなく `requireDiscordMember()` で auth user 確定 → RLS の
 * self-row policy (WITH CHECK) が `discord_id = discord_user_id` 比較で
 * 通すか拒否する。client から他人の row を改竄しても DB が拒否する設計。
 *
 * symbol は事前 validate しない (凡例マスターは admin が動的編集できるため、
 * server 側で許容セットを固定すると新しい記号を追加した瞬間に弾かれる)。
 * 空文字列のときは row 削除扱い (= 「未回答」に戻す)。
 */
export async function upsertNativeScheduleAttendanceAction(
  input: UpsertNativeScheduleAttendanceInput,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const member = await requireDiscordMember();
  const sessionId = input.sessionId?.trim();
  if (!sessionId) return { ok: false, reason: "sessionId が空です" };

  const supabase = await createClient();
  // symbol は出欠記号 (凡例マスター由来の短い記号/ラベル)。本人 (非 admin) が
  // 書ける唯一の通知本文 (native-schedule-discord の cron 通知) 流入経路なので、
  // 制御文字 (改行/タブ含む) を空白化し長さを制限して、複数行フィッシング文や
  // 長文の注入を防ぐ。凡例は短い記号前提なので 32 文字制限は実運用に影響しない。
  const symbol = (input.symbol ?? "")
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 32);
  // P3-g (2026-06-19 監査): comment も symbol と同じ脅威モデル (本人=非 admin が
  // anon key + 自分の JWT で書ける唯一の経路、将来 UI/通知に露出した際の注入面)。
  // symbol と対称に制御文字を空白化し 200 字に制限する (現状 UI 未露出だが予防的に)。
  const commentRaw = input.comment
    ? input.comment.replace(/\p{Cc}/gu, " ").replace(/\s+/g, " ").trim().slice(0, 200)
    : "";
  const comment = commentRaw ? commentRaw : null;
  // W-13: 予定時刻は HH:MM に正規化。形式外は保存せずエラーにする (UI は
  // <input type="time"> なので通常到達しない — 直接 API を叩いた場合の防御)。
  const arriveRaw = input.arriveAt?.trim() ?? "";
  const leaveRaw = input.leaveAt?.trim() ?? "";
  const arriveAt = arriveRaw ? normalizeAttendanceTime(arriveRaw) : null;
  const leaveAt = leaveRaw ? normalizeAttendanceTime(leaveRaw) : null;
  if ((arriveRaw && !arriveAt) || (leaveRaw && !leaveAt)) {
    return { ok: false, reason: "予定時刻は HH:MM で入力してください" };
  }
  const timesAllowed = symbolAllowsTimes(symbol);

  if (!symbol) {
    const { error } = await supabase
      .from("native_schedule_attendances")
      .delete()
      .eq("session_id", sessionId)
      .eq("discord_user_id", member.discordId);
    if (error) return { ok: false, reason: dbError("出欠削除", error) };
    try {
      revalidatePath("/");
    } catch {
      // best-effort
    }
    return { ok: true };
  }

  const { error } = await supabase
    .from("native_schedule_attendances")
    .upsert(
      {
        session_id: sessionId,
        discord_user_id: member.discordId,
        symbol,
        comment,
        arrive_at: timesAllowed ? arriveAt : null,
        leave_at: timesAllowed ? leaveAt : null,
      },
      { onConflict: "session_id,discord_user_id" },
    );
  if (error) return { ok: false, reason: dbError("出欠保存", error) };
  // 2026-08-30 (Tier2-8): 全員入力で開催を自動確定するオプション。
  // 既定 OFF で、ON のときだけ条件 (全員回答 + 参加可能人数) を見て
  // CANDIDATE → DECISION に上げる。失敗しても出欠保存は成功済みなので
  // 結果は無視する (モジュール側で warn 済み)。
  await maybeAutoConfirmSession(sessionId);
  try {
    revalidatePath("/");
  } catch {
    // best-effort
  }
  return { ok: true };
}

// ---- 全員入力で自動確定 (Tier2-8, 2026-08-30) ----------------------------
// 既定 OFF。詳細な確定条件は native-schedule-auto-confirm.ts を参照。

export async function setNativeScheduleAutoConfirmEnabledAction(
  enabled: boolean,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: "ADMIN ロールが必要です" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("app_settings")
    .upsert(
      { key: AUTO_CONFIRM_ENABLED_KEY, value: enabled ? "true" : "false" },
      { onConflict: "key" },
    );
  if (error) return { ok: false, reason: dbError("自動確定 ON/OFF 保存", error) };
  try {
    revalidatePath("/");
  } catch {
    // best-effort
  }
  return { ok: true };
}

export async function setNativeScheduleAutoConfirmMinAvailableAction(
  minAvailable: number,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: "ADMIN ロールが必要です" };
  if (!Number.isInteger(minAvailable) || minAvailable < 1 || minAvailable > 24) {
    return { ok: false, reason: "必要人数は 1〜24 で指定してください" };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("app_settings")
    .upsert(
      { key: AUTO_CONFIRM_MIN_AVAILABLE_KEY, value: String(minAvailable) },
      { onConflict: "key" },
    );
  if (error) return { ok: false, reason: dbError("必要人数の保存", error) };
  try {
    revalidatePath("/");
  } catch {
    // best-effort
  }
  return { ok: true };
}

// ---- W-15 定期枠 (2026-09-08) --------------------------------------------

/**
 * 定期枠の曜日を保存する (W-15)。
 *
 * 保存後は `ensureNativeMonthlyPlaceholders` が**その曜日だけ**候補日を
 * 敷設する。既に敷設済みの他曜日の行は消さない — 消すと、その日に入っていた
 * 出欠やメモまで巻き添えになる。要らない行は従来どおり status を CANCELLED
 * にする (取り消した日の一覧は設定画面にある)。
 */
export async function setNativeScheduleRecurringDowsAction(
  dows: number[],
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: "ADMIN ロールが必要です" };
  if (!Array.isArray(dows)) {
    return { ok: false, reason: "曜日の指定が不正です" };
  }
  // 0-6 以外は `serializeRecurringDows` が落とす。全部落ちたら空文字 =
  // 「定期枠なし」= 従来どおり全日。
  const value = serializeRecurringDows(dows);
  const supabase = await createClient();
  const { error } = await supabase
    .from("app_settings")
    .upsert({ key: NATIVE_RECURRING_DOWS_KEY, value }, { onConflict: "key" });
  if (error) return { ok: false, reason: dbError("定期枠の保存", error) };
  try {
    revalidatePath("/");
  } catch {
    // best-effort
  }
  return { ok: true };
}

export type BulkCandidateInput = {
  /** `YYYY-MM-DD` (両端含む)。 */
  from: string;
  to: string;
  /** 曜日 (0 = 日 .. 6 = 土)。 */
  dows: number[];
  startTime: string;
  endTime: string;
  note?: string;
};

/**
 * 期間 + 曜日で候補日を一括生成する (W-15)。
 *
 * 「毎週 X 曜 21:00 を期間 + 曜日で一括生成」そのもの。1 件ずつの
 * `createNativeScheduleSessionAction` と同じ形の行を作り、
 * **既にある日付は飛ばす** (上書きしない)。同じ日に手で入れた候補日や、
 * 出欠が入っている行を一括操作で潰さないため。
 *
 * 時刻は日個別の値として保存する (`start_time` / `end_time` に NOT NULL)。
 * placeholder の「default 追従」とは別扱いにするのは、一括生成が
 * **人が時刻を明示して作る操作**だから — あとで default を変えても、
 * 意図して作った枠が勝手に動かない。
 */
export async function createNativeScheduleSessionsBulkAction(
  input: BulkCandidateInput,
): Promise<
  | { ok: true; created: number; skipped: number; truncated: boolean }
  | { ok: false; reason: string }
> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: "ADMIN ロールが必要です" };

  const startTime = input.startTime?.trim() ?? "";
  const endTime = input.endTime?.trim() ?? "";
  const TIME = /^([01]?\d|2[0-3]):([0-5]\d)$/;
  if (!TIME.test(startTime) || !TIME.test(endTime)) {
    return { ok: false, reason: "時刻は HH:MM 形式で入力してください" };
  }
  if (startTime === endTime) {
    return { ok: false, reason: "開始と終了が同じ時刻です" };
  }
  const noteRaw = input.note?.trim() ?? "";
  if (noteRaw.length > 200) {
    return { ok: false, reason: "備考は 200 文字以内で入力してください" };
  }
  const note = noteRaw || null;

  const { dates, truncated } = expandRecurringDates(
    input.from,
    input.to,
    input.dows ?? [],
  );
  if (dates.length === 0) {
    return {
      ok: false,
      reason: "その期間に該当する曜日がありません (期間と曜日を確認してください)",
    };
  }

  const DOW_LABELS = ["日", "月", "火", "水", "木", "金", "土"] as const;
  const pad = (n: number) => String(n).padStart(2, "0");
  const [sh, sm] = startTime.split(":").map(Number);
  const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
  const rows = dates.map((c) => {
    const dow = DOW_LABELS[c.dow] ?? "日";
    return {
      raw_date: `${c.y}/${pad(c.m)}/${pad(c.d)}(${dow}) ${startTime}~${endTime}`,
      parsed_date: new Date(
        Date.UTC(c.y, c.m - 1, c.d, sh ?? 0, sm ?? 0, 0, 0) - JST_OFFSET_MS,
      ).toISOString(),
      start_time: startTime,
      end_time: endTime,
      day_of_week: dow,
      note,
      created_by_id: auth.user.discordId,
      datePrefix: `${c.y}/${pad(c.m)}/${pad(c.d)}(${dow})`,
    };
  });

  const supabase = await createClient();
  // 既存日付の除外。`raw_date` は時刻を含むので、時刻が違うだけの二重登録を
  // 防ぐには **日付 prefix** で突き合わせる必要がある
  // (`native-schedule-placeholders.ts` と同じ判断)。CANCELLED も既存として
  // 扱う — 取り消した日を一括生成で勝手に復活させない。
  //
  // ⚠ 突き合わせの範囲は **暦日の全体** (最初の日の 0:00 JST 〜 最後の日の
  // 翌 0:00 JST) にする。生成する時刻 (`parsed_date`) の範囲で引くと、
  // 同じ日に **より早い時刻**で登録済みの候補日が範囲の外に落ちて検出できず、
  // 同じ日付の行が二重にできる (21:00 で作るとき、その日の 20:00 の行が
  // 見えない)。
  const firstDate = dates[0]!;
  const lastDate = dates[dates.length - 1]!;
  const rangeStart = new Date(
    Date.UTC(firstDate.y, firstDate.m - 1, firstDate.d) - JST_OFFSET_MS,
  ).toISOString();
  const rangeEnd = new Date(
    Date.UTC(lastDate.y, lastDate.m - 1, lastDate.d + 1) - JST_OFFSET_MS,
  ).toISOString();
  const { data: existing, error: existErr } = await supabase
    .from("native_schedule_sessions")
    .select("raw_date")
    .gte("parsed_date", rangeStart)
    .lt("parsed_date", rangeEnd);
  if (existErr) {
    return { ok: false, reason: dbError("既存候補日の確認", existErr) };
  }
  const prefixRe = /^(\d{4}\/\d{2}\/\d{2}\([日月火水木金土]\))/;
  const taken = new Set<string>();
  for (const r of (existing ?? []) as Array<{ raw_date: string }>) {
    const mt = prefixRe.exec(r.raw_date);
    if (mt) taken.add(mt[1]!);
  }
  const fresh = rows.filter((r) => !taken.has(r.datePrefix));
  const skipped = rows.length - fresh.length;
  if (fresh.length === 0) {
    return { ok: true, created: 0, skipped, truncated };
  }

  const { error } = await supabase.from("native_schedule_sessions").insert(
    // `datePrefix` は既存判定にしか使わない作業用フィールドなので落とす。
    fresh.map((r) => ({
      raw_date: r.raw_date,
      parsed_date: r.parsed_date,
      start_time: r.start_time,
      end_time: r.end_time,
      day_of_week: r.day_of_week,
      note: r.note,
      created_by_id: r.created_by_id,
    })),
  );
  if (error) {
    // 上の日付 prefix 判定を抜けた同 raw_date は、別の誰かが同時に足した
    // 場合しか起きない。生の PG エラーではなく状況を返す。
    if ((error as { code?: string }).code === "23505") {
      return {
        ok: false,
        reason: "同じ日時の候補日が追加されたところです。もう一度お試しください",
      };
    }
    return { ok: false, reason: dbError("候補日の一括追加", error) };
  }
  try {
    revalidatePath("/");
  } catch {
    // best-effort
  }
  return { ok: true, created: fresh.length, skipped, truncated };
}

