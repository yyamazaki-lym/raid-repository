"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { assertAdminResult } from "./auth";
import { dbError } from "./db-error";
import {
  DEFAULT_NATIVE_SCHEDULE_ID,
  MAX_NATIVE_SCHEDULES,
  NATIVE_ACTIVE_SCHEDULE_ID_KEY,
  NATIVE_SCHEDULE_NAME_MAX,
  isNativeScheduleId,
} from "@/lib/schedule/settings-keys";
import { getActiveNativeScheduleId } from "@/lib/schedule/native-active";

/**
 * 自前スケジュール (native) の一覧 CRUD と切替 (2026-09-18 段階 1)。
 *
 * 一覧は `native_schedules` テーブル、**表示中は
 * `app_settings.native_schedule_active_id` の 1 キー**。同期式が
 * 「一覧は app_settings の JSON / 表示中は schedule_url」で切替を成立させて
 * いるのと同じ形で、切替は 1 キーの差し替えに閉じる。
 *
 * 段階 1 の範囲: セッションと出欠だけがスケジュール別。メンバー・既定時刻・
 * 定期枠・凡例・日付メモ・FFLogs 紐づけ・過去ログは全スケジュール共通。
 *
 * ⚠ **削除は「予定が 1 件も無いスケジュール」に限る。** FK は ON DELETE
 * CASCADE なので、行が残ったまま消すと**過去の予定と出欠がまとめて消える**。
 * 誤操作で履歴が飛ぶのを防ぐため、空でないスケジュールは server 側で拒否
 * する (UI にも同じ条件を出すが、最後の砦はここ)。
 */

type ActionResult<T = unknown> =
  | ({ ok: true } & T)
  | { ok: false; reason: string };

/** 制御文字を落として前後の空白を削る。空文字になったら null。 */
function normalizeScheduleName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = Array.from(raw)
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code >= 0x20 && code !== 0x7f;
    })
    .join("")
    .trim();
  if (!cleaned) return null;
  return cleaned.slice(0, NATIVE_SCHEDULE_NAME_MAX);
}

/** スケジュールを 1 件追加する。追加しただけでは表示は切り替わらない。 */
export async function createNativeScheduleAction(
  rawName: string,
): Promise<ActionResult<{ id: string }>> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: "ADMIN ロールが必要です" };
  const name = normalizeScheduleName(rawName);
  if (!name) return { ok: false, reason: "名前を入力してください" };

  const supabase = await createClient();
  const { count, error: countErr } = await supabase
    .from("native_schedules")
    .select("id", { count: "exact", head: true });
  if (countErr) {
    return { ok: false, reason: dbError("スケジュール数の確認", countErr) };
  }
  if ((count ?? 0) >= MAX_NATIVE_SCHEDULES) {
    return {
      ok: false,
      reason: `登録できるのは ${MAX_NATIVE_SCHEDULES} 件までです`,
    };
  }

  const { data, error } = await supabase
    .from("native_schedules")
    .insert({ name, sort_order: count ?? 0 })
    .select("id")
    .single();
  if (error) return { ok: false, reason: dbError("スケジュール追加", error) };
  return { ok: true, id: (data as { id: string }).id };
}

/** 名前を変える。予定・出欠には影響しない。 */
export async function renameNativeScheduleAction(
  rawId: string,
  rawName: string,
): Promise<ActionResult> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: "ADMIN ロールが必要です" };
  if (!isNativeScheduleId(rawId)) {
    return { ok: false, reason: "対象が正しくありません" };
  }
  const name = normalizeScheduleName(rawName);
  if (!name) return { ok: false, reason: "名前を入力してください" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("native_schedules")
    .update({ name })
    .eq("id", rawId.trim())
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, reason: dbError("名前の変更", error) };
  if (!data) return { ok: false, reason: "対象が見つかりませんでした" };
  try {
    revalidatePath("/");
  } catch {
    // best-effort
  }
  return { ok: true };
}

/**
 * 表示するスケジュールを切り替える (全員に反映)。
 *
 * 実体は `app_settings.native_schedule_active_id` の差し替えなので、予定表の
 * 描画・候補日の自動生成・Discord 通知・自動確定・催促・出席サマリーが
 * まとめて追従する。
 */
export async function selectNativeScheduleAction(
  rawId: string,
): Promise<ActionResult> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: "ADMIN ロールが必要です" };
  if (!isNativeScheduleId(rawId)) {
    return { ok: false, reason: "対象が正しくありません" };
  }
  const id = rawId.trim();

  const supabase = await createClient();
  // 存在しない id を表示中にすると「予定が 1 件も無い」画面になるので、
  // 実在を確かめてから書く。
  const { data: found, error: findErr } = await supabase
    .from("native_schedules")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (findErr) {
    return { ok: false, reason: dbError("スケジュールの確認", findErr) };
  }
  if (!found) return { ok: false, reason: "対象が見つかりませんでした" };

  const { error } = await supabase
    .from("app_settings")
    .upsert(
      { key: NATIVE_ACTIVE_SCHEDULE_ID_KEY, value: id },
      { onConflict: "key" },
    );
  if (error) {
    return { ok: false, reason: dbError("表示スケジュールの切替", error) };
  }
  try {
    revalidatePath("/");
  } catch {
    // best-effort
  }
  return { ok: true };
}

/**
 * スケジュールを削除する。**予定が 1 件でも残っていれば拒否する。**
 *
 * FK が ON DELETE CASCADE なので、残したまま消すと予定と出欠が道連れになる。
 * 「空にしてから消す」を強制すれば、消える前に必ず一度は予定の一覧を見る
 * ことになる。既定スケジュールと表示中のものも消せない。
 */
export async function deleteNativeScheduleAction(
  rawId: string,
): Promise<ActionResult> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: "ADMIN ロールが必要です" };
  if (!isNativeScheduleId(rawId)) {
    return { ok: false, reason: "対象が正しくありません" };
  }
  const id = rawId.trim();
  if (id === DEFAULT_NATIVE_SCHEDULE_ID) {
    return { ok: false, reason: "既定のスケジュールは削除できません" };
  }
  if (id === (await getActiveNativeScheduleId())) {
    return { ok: false, reason: "表示中のスケジュールは削除できません" };
  }

  const supabase = await createClient();
  const { count, error: countErr } = await supabase
    .from("native_schedule_sessions")
    .select("id", { count: "exact", head: true })
    .eq("schedule_id", id);
  if (countErr) {
    return { ok: false, reason: dbError("予定の確認", countErr) };
  }
  if ((count ?? 0) > 0) {
    return {
      ok: false,
      reason: `予定が ${count} 件残っています (先に空にしてください)`,
    };
  }

  const { error } = await supabase
    .from("native_schedules")
    .delete()
    .eq("id", id);
  if (error) return { ok: false, reason: dbError("スケジュール削除", error) };
  return { ok: true };
}
