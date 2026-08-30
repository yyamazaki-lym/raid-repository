"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { assertAdminResult } from "./auth";
import { dbError } from "./db-error";
import {
  buildReminderPreview,
  dispatchAttendanceReminder,
  fetchAttendanceReminderSettings,
  type ReminderPreview,
} from "./attendance-reminder";
import {
  REMINDER_CHANNEL_KEY,
  REMINDER_ENABLED_KEY,
  REMINDER_EXCLUDED_KEY,
  REMINDER_HOUR_KEY,
  REMINDER_LEAD_DAYS_KEY,
  REMINDER_MEMBER_MAP_KEY,
  REMINDER_TEMPLATE_KEY,
} from "@/lib/schedule/attendance-reminder-keys";

/**
 * 出欠催促の設定 Server Actions (2026-08-30)。
 * 権限は他の設定系と同じ `assertAdminResult` + RLS の二層。
 */

type WriteResult = { ok: true } | { ok: false; reason: string };

const DISCORD_ID_RE = /^\d{17,20}$/;

async function saveSetting(key: string, value: string): Promise<WriteResult> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: "ADMIN ロールが必要です" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("app_settings")
    .upsert({ key, value }, { onConflict: "key" });
  if (error) return { ok: false, reason: dbError("催促設定の保存", error) };
  try {
    revalidatePath("/");
  } catch {
    // best-effort
  }
  return { ok: true };
}

export async function setAttendanceReminderEnabledAction(
  enabled: boolean,
): Promise<WriteResult> {
  return saveSetting(REMINDER_ENABLED_KEY, enabled ? "true" : "false");
}

export async function setAttendanceReminderChannelAction(
  channelId: string,
): Promise<WriteResult> {
  const t = channelId.trim();
  if (t && !DISCORD_ID_RE.test(t)) {
    return { ok: false, reason: "チャンネル ID は 17〜20 桁の数字です" };
  }
  return saveSetting(REMINDER_CHANNEL_KEY, t);
}

export async function setAttendanceReminderHourAction(
  hour: number,
): Promise<WriteResult> {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    return { ok: false, reason: "時刻は 0〜23 で指定してください" };
  }
  return saveSetting(REMINDER_HOUR_KEY, String(hour));
}

export async function setAttendanceReminderLeadDaysAction(
  days: number,
): Promise<WriteResult> {
  if (!Number.isInteger(days) || days < 0 || days > 14) {
    return { ok: false, reason: "日数は 0〜14 で指定してください" };
  }
  return saveSetting(REMINDER_LEAD_DAYS_KEY, String(days));
}

/**
 * 表示名 → Discord ユーザー ID の対応表。UI からは
 * `[{ name, discordUserId }]` の配列で受け、JSON オブジェクトで保存する。
 */
export async function setAttendanceReminderMemberMapAction(
  entries: Array<{ name: string; discordUserId: string }>,
): Promise<WriteResult> {
  const map: Record<string, string> = {};
  for (const e of entries) {
    const name = e.name.trim();
    const id = e.discordUserId.trim();
    if (!name) continue;
    if (!id) continue; // 空 = 未設定として単に落とす
    if (!DISCORD_ID_RE.test(id)) {
      return {
        ok: false,
        reason: `「${name}」の ID が不正です (17〜20 桁の数字)`,
      };
    }
    map[name] = id;
  }
  return saveSetting(REMINDER_MEMBER_MAP_KEY, JSON.stringify(map));
}

/** 催促対象から常に外す表示名。 */
export async function setAttendanceReminderExcludedAction(
  names: string[],
): Promise<WriteResult> {
  const cleaned = Array.from(
    new Set(names.map((n) => n.trim()).filter((n) => n.length > 0)),
  );
  return saveSetting(REMINDER_EXCLUDED_KEY, JSON.stringify(cleaned));
}

export async function setAttendanceReminderTemplateAction(
  template: string,
): Promise<WriteResult> {
  if (template.length > 2000) {
    return { ok: false, reason: "テンプレートが長すぎます (最大 2000 文字)" };
  }
  return saveSetting(REMINDER_TEMPLATE_KEY, template);
}

export type AttendanceReminderSettings = {
  enabled: boolean;
  channelId: string;
  hour: number;
  leadDays: number;
  /** 表示名 → Discord ユーザー ID。 */
  memberMap: Record<string, string>;
  excluded: string[];
  template: string;
  /**
   * 設定 UI の候補として出すメンバー表示名 (現在のスケジュールソース由来)。
   * 取得できないときは空 = 手入力にフォールバック。
   */
  memberNames: string[];
};

/**
 * 設定 UI の初期値をまとめて読む。個別 fetch を UI から何本も張らない
 * ため 1 アクションに束ねる (FflogsSyncSection の status 取得と同方針)。
 */
export async function getAttendanceReminderSettingsAction(): Promise<
  { ok: true; settings: AttendanceReminderSettings } | { ok: false; reason: string }
> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: "ADMIN ロールが必要です" };
  try {
    const settings = await fetchAttendanceReminderSettings();
    return { ok: true, settings };
  } catch (e) {
    return { ok: false, reason: `設定の取得に失敗しました: ${String(e)}` };
  }
}

/**
 * 設定画面用のプレビュー。「今の設定なら誰に飛ぶか」を送信前に確認できる
 * ようにする (メンションは取り消せないので、空撃ちを防ぐ意味が大きい)。
 */
export async function previewAttendanceReminderAction(): Promise<
  { ok: true; preview: ReminderPreview | null } | { ok: false; reason: string }
> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: "ADMIN ロールが必要です" };
  try {
    const preview = await buildReminderPreview();
    return { ok: true, preview };
  } catch (e) {
    return { ok: false, reason: `プレビュー失敗: ${String(e)}` };
  }
}

/**
 * 手動送信 (テスト)。ON/OFF・目標時刻・dedup をすべて無視して即送る。
 * cron を待たずに実挙動を確認するための導線。
 */
export async function sendAttendanceReminderNowAction(): Promise<
  { ok: true; posted: number; reason?: string } | { ok: false; reason: string }
> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: "ADMIN ロールが必要です" };
  const r = await dispatchAttendanceReminder({
    respectToggle: false,
    respectDedup: false,
    respectHour: false,
  });
  if (!r.ok) return r;
  return { ok: true, posted: r.posted, reason: r.reason };
}
