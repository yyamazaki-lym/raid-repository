"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

import { assertAdminResult, requireDiscordMember } from "./auth";
import { dbError } from "./db-error";
import {
  notifyNativeSessionCancelled,
  notifyNativeSessionCreated,
  notifyNativeSessionDecided,
  notifyNativeSessionDeleted,
  type NativeSessionLike,
} from "./native-schedule-discord";

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

const NATIVE_CHOICE_VALUES_KEY = "native_schedule_choice_values";

type NativeSessionRow = {
  id: string;
  raw_date: string;
  parsed_date: string;
  start_time: string;
  end_time: string;
  day_of_week: string;
  note: string | null;
  status: NativeSessionStatus;
};

function rowToSessionLike(row: NativeSessionRow): NativeSessionLike {
  return {
    id: row.id,
    rawDate: row.raw_date,
    parsedDate: row.parsed_date,
    startTime: row.start_time,
    endTime: row.end_time,
    dayOfWeek: row.day_of_week,
    note: row.note ?? null,
    status: row.status,
  };
}

function pickStatusNotifier(
  prev: NativeSessionStatus,
  next: NativeSessionStatus,
): ((s: NativeSessionLike) => Promise<void>) | null {
  if (prev === next) return null;
  if (next === "DECISION" && prev === "CANDIDATE") return notifyNativeSessionDecided;
  if (next === "CANCELLED") {
    if (prev === "CANDIDATE" || prev === "DECISION") {
      return notifyNativeSessionCancelled;
    }
  }
  // DECISION → CANDIDATE / CANCELLED → * は通知しない
  return null;
}

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
  const note = input.note?.trim() || null;

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
    .select(
      "id, raw_date, parsed_date, start_time, end_time, day_of_week, note, status",
    )
    .single();
  if (error) {
    if ((error as { code?: string }).code === "23505") {
      return { ok: false, reason: "同じ日時の候補日がすでにあります" };
    }
    return { ok: false, reason: dbError("候補日追加", error) };
  }
  try {
    await notifyNativeSessionCreated(rowToSessionLike(data));
  } catch (e) {
    console.warn("[native-schedule] notifyCreated failed", String(e));
  }
  try {
    revalidatePath("/");
  } catch {
    // best-effort
  }
  return { ok: true, id: data.id as string };
}

export async function deleteNativeScheduleSessionAction(
  id: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: "ADMIN ロールが必要です" };
  const trimmed = id?.trim();
  if (!trimmed) return { ok: false, reason: "id が空です" };

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("native_schedule_sessions")
    .select(
      "id, raw_date, parsed_date, start_time, end_time, day_of_week, note, status",
    )
    .eq("id", trimmed)
    .maybeSingle();

  const { error } = await supabase
    .from("native_schedule_sessions")
    .delete()
    .eq("id", trimmed);
  if (error) return { ok: false, reason: dbError("候補日削除", error) };
  if (existing) {
    try {
      await notifyNativeSessionDeleted(rowToSessionLike(existing));
    } catch (e) {
      console.warn("[native-schedule] notifyDeleted failed", String(e));
    }
  }
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
  const newStatus = status as NativeSessionStatus;

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("native_schedule_sessions")
    .select(
      "id, raw_date, parsed_date, start_time, end_time, day_of_week, note, status",
    )
    .eq("id", trimmed)
    .maybeSingle();

  const { error } = await supabase
    .from("native_schedule_sessions")
    .update({ status: newStatus })
    .eq("id", trimmed);
  if (error) return { ok: false, reason: dbError("status 更新", error) };

  if (existing) {
    const prevStatus = existing.status as NativeSessionStatus;
    const notify = pickStatusNotifier(prevStatus, newStatus);
    if (notify) {
      try {
        await notify({ ...rowToSessionLike(existing), status: newStatus });
      } catch (e) {
        console.warn("[native-schedule] notifyStatus failed", String(e));
      }
    }
  }
  try {
    revalidatePath("/");
  } catch {
    // best-effort
  }
  return { ok: true };
}

// ---- members (admin gate) -------------------------------------------------

const DISCORD_ID_RE = /^\d{17,20}$/;

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
  if (!discordUserId || !DISCORD_ID_RE.test(discordUserId)) {
    return { ok: false, reason: "Discord ID は 17〜20 桁の数字です" };
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
};

export async function updateNativeScheduleMemberAction(
  discordUserId: string,
  patch: UpdateNativeScheduleMemberPatch,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: "ADMIN ロールが必要です" };
  const id = discordUserId?.trim();
  if (!id || !DISCORD_ID_RE.test(id)) {
    return { ok: false, reason: "Discord ID が不正です" };
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

export async function deleteNativeScheduleMemberAction(
  discordUserId: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: "ADMIN ロールが必要です" };
  const id = discordUserId?.trim();
  if (!id || !DISCORD_ID_RE.test(id)) {
    return { ok: false, reason: "Discord ID が不正です" };
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

// ---- attendances (本人 only via RLS) ------------------------------------

export type UpsertNativeScheduleAttendanceInput = {
  sessionId: string;
  symbol: string;
  comment?: string;
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
  const symbol = input.symbol?.trim() ?? "";
  const comment = input.comment?.trim() ?? null;

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
      },
      { onConflict: "session_id,discord_user_id" },
    );
  if (error) return { ok: false, reason: dbError("出欠保存", error) };
  try {
    revalidatePath("/");
  } catch {
    // best-effort
  }
  return { ok: true };
}
