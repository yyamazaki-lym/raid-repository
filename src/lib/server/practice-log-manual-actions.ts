"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { jstYmdString } from "@/lib/jst-date";
import {
  toStoredSegments,
  validateManualDayInput,
  type ManualDayInputError,
} from "@/lib/practice-log-manual";
import { assertAdminResult } from "./auth";
import { dbError } from "./db-error";

/**
 * 練習ログの手動の記録 (2026-11-08、schema.sql 6b-13) の書き込み。
 *
 * 権限は「ログを同期」と同じ admin。admin gate (ここ) と RLS (7 章の汎用ループ:
 * 書き込みは `is_portal_admin()`) の二層。入力の形は純関数
 * `validateManualDayInput` が検める (client の値なので型から疑う)。
 */

type WriteResult = { ok: true } | { ok: false; reason: string };

const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** 入力の誤り → 返す文 (Server Action の返す理由は既存の Action と同じく日本語)。 */
function inputErrorReason(e: ManualDayInputError): string {
  switch (e) {
    case "date":
      return "日付が不正です";
    case "future":
      return "今日より後の日は記録できません";
    case "segments":
      return "区間は 1〜12 個で入力してください";
    case "pulls":
      return "pull 数は 1〜500 で入力してください";
    case "kills":
      return "討伐数は 0 以上、pull 数以下で入力してください";
    case "percentage":
      return "残 HP% は 0〜100 で入力してください";
    case "segmentKey":
      return "層 / フェーズの指定が不正です";
    case "duplicateSegment":
      return "同じ層 / フェーズが 2 回入っています";
    case "minutes":
      return "練習時間は 0〜1440 分で入力してください";
    case "note":
      return "メモは改行なしの 200 文字以内で入力してください";
  }
}

/**
 * 手動の記録を保存する。`id` があればその行の更新、無ければ追加。
 * 同じコンテンツ・同じ日に 2 行目は作れない (UNIQUE)。その日は既存の行を直す。
 */
export async function saveManualPracticeDayAction(input: {
  id?: string | null;
  categoryId: string;
  date: unknown;
  segments: unknown;
  logMinutes: unknown;
  note: unknown;
}): Promise<WriteResult> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: "ADMIN ロールが必要です" };

  const categoryId = typeof input.categoryId === "string" ? input.categoryId.trim() : "";
  if (!UUID_RE.test(categoryId)) return { ok: false, reason: "コンテンツが不正です" };
  const id = typeof input.id === "string" ? input.id.trim() : "";
  if (id && !UUID_RE.test(id)) return { ok: false, reason: "記録の ID が不正です" };

  const v = validateManualDayInput(
    {
      date: input.date,
      segments: input.segments,
      logMinutes: input.logMinutes,
      note: input.note,
    },
    jstYmdString(new Date()),
  );
  if (!v.ok) return { ok: false, reason: inputErrorReason(v.error) };

  const values = {
    session_date: v.value.date,
    segments: toStoredSegments(v.value.segments),
    log_minutes: v.value.logMinutes,
    note: v.value.note,
  };
  const supabase = await createClient();
  if (id) {
    // 更新は同じコンテンツの行だけ (別のコンテンツの行を ID で書き換えない)。
    const { data, error } = await supabase
      .from("practice_log_manual_days")
      .update(values)
      .eq("id", id)
      .eq("category_id", categoryId)
      .select("id");
    if (error) return { ok: false, reason: saveError(error) };
    if ((data ?? []).length === 0) {
      return { ok: false, reason: "記録が見つかりませんでした (消されたか、権限がありません)" };
    }
  } else {
    const { error } = await supabase.from("practice_log_manual_days").insert({
      category_id: categoryId,
      created_by_id: auth.user.discordId,
      ...values,
    });
    if (error) return { ok: false, reason: saveError(error) };
  }
  revalidateQuietly();
  return { ok: true };
}

/** 手動の記録を消す (1 行)。 */
export async function deleteManualPracticeDayAction(input: {
  id: string;
  categoryId: string;
}): Promise<WriteResult> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: "ADMIN ロールが必要です" };
  const id = typeof input.id === "string" ? input.id.trim() : "";
  const categoryId = typeof input.categoryId === "string" ? input.categoryId.trim() : "";
  if (!UUID_RE.test(id) || !UUID_RE.test(categoryId)) {
    return { ok: false, reason: "記録の ID が不正です" };
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("practice_log_manual_days")
    .delete()
    .eq("id", id)
    .eq("category_id", categoryId)
    .select("id");
  if (error) return { ok: false, reason: dbError("手動の記録の削除", error) };
  // RLS で弾かれた削除はエラーではなく 0 行になる (#176 と同じ形)。黙って成功に
  // しない。
  if ((data ?? []).length === 0) {
    return { ok: false, reason: "記録が見つかりませんでした (消されたか、権限がありません)" };
  }
  revalidateQuietly();
  return { ok: true };
}

/** 同じ日の 2 行目 (UNIQUE 違反) だけは分かる文にする。 */
function saveError(error: { code?: string; message?: string }): string {
  if (error.code === "23505") {
    return "その日の手動の記録はすでにあります (その日の記録を直してください)";
  }
  return dbError("手動の記録の保存", error);
}

function revalidateQuietly() {
  try {
    revalidatePath("/category", "layout");
  } catch {
    // best-effort
  }
}
