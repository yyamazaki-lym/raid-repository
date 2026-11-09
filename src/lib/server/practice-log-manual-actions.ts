"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { jstYmdString } from "@/lib/jst-date";
import {
  jstDayRangeIso,
  toStoredSegments,
  validateManualDayInput,
  type ManualDayInputError,
} from "@/lib/practice-log-manual";
import { getScheduleSourceMode } from "@/lib/schedule/source-mode";
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

export type CancelMissingDayResult =
  | { ok: true; method: "native-cancelled" | "excluded"; sessions: number }
  | { ok: false; reason: string };

/**
 * ログが欠けている日を「中止だった」にする (2026-11-08、ユーザーの選択
 * 「カードから中止にする」)。
 *
 * スケジュールの過去ログのゴミ箱 (`excludePastSessionAction`) と同じ印を使う:
 *   - 自前作成式: その日の確定 (DECISION)・有志練習でない日程を `CANCELLED` に
 *     する (全スケジュール。欠けている日の判定と同じ母数)
 *   - 同期式: その日の過去の日程に `excluded_at` を付ける (行は消さない。
 *     時刻違いの重複も同じ日なので一緒に外れる。ADR-007)
 * 戻すのは設定ダイアログの「中止した日程」/「過去ログから除外中の日程」。
 *
 * ⚠ **ログか手動の記録がある日は中止にしない。** 欠けている日は「どこにも
 * ログが無い日」なので、画面が古いまま押された (その後に同期でログが入った)
 * 場合に、練習した日の日程を中止にしてしまわないよう書く前に確かめる。
 * 今日以降も中止にしない (欠けている日に出ない日)。
 */
export async function cancelMissingPracticeDayAction(input: {
  date: unknown;
}): Promise<CancelMissingDayResult> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: "ADMIN ロールが必要です" };
  const date = typeof input.date === "string" ? input.date.trim() : "";
  // jstDayRangeIso は YYYY-MM-DD でなければ null (下の .or() の文字列に入れる前の検査も兼ねる)。
  const range = jstDayRangeIso(date);
  if (!range) return { ok: false, reason: "日付が不正です" };
  if (date >= jstYmdString(new Date())) {
    return { ok: false, reason: "今日より前の日だけ中止にできます" };
  }
  const mode = await getScheduleSourceMode();
  if (mode === "disabled") return { ok: false, reason: "スケジュール機能が無効です" };

  const supabase = await createClient();
  // 練習した日 (ログか手動の記録がある日) は中止にしない。
  // ⚠ ログはその日だけを直接引く (練習ログの `fightDate` と同じ日: session_date、
  // 無ければ開始の JST 暦日)。以前は practice_log_days(p_from = その日) で
  // 「その日以降の全コンテンツ × 日」を新しい順に読んでいたため、1000 行の上限で
  // いちばん古い対象の日が抜け、ログのある日を中止にし得た (レビューで検出)。
  const fromMs = Date.parse(range.from);
  const toMs = Date.parse(range.to);
  const [logRes, manualRes] = await Promise.all([
    supabase
      .from("fflogs_fights")
      .select("id")
      .or(
        `session_date.eq.${date},and(session_date.is.null,start_ms.gte.${fromMs},start_ms.lt.${toMs})`,
      )
      .limit(1),
    supabase.from("practice_log_manual_days").select("id").eq("session_date", date).limit(1),
  ]);
  if (logRes.error || manualRes.error) {
    return { ok: false, reason: dbError("練習した日の確認", logRes.error ?? manualRes.error) };
  }
  const practiced = (logRes.data ?? []).length > 0 || (manualRes.data ?? []).length > 0;
  if (practiced) {
    return { ok: false, reason: "その日にはログか手動の記録があります (練習した日は中止にできません)" };
  }

  if (mode === "native") {
    const { data, error } = await supabase
      .from("native_schedule_sessions")
      .update({ status: "CANCELLED" })
      .eq("status", "DECISION")
      .eq("is_optional", false)
      .gte("parsed_date", range.from)
      .lt("parsed_date", range.to)
      .select("id");
    if (error) return { ok: false, reason: dbError("日程の中止", error) };
    const n = (data ?? []).length;
    if (n === 0) return { ok: false, reason: "その日の確定した日程が見つかりませんでした" };
    // TOP の予定表 (過去ログ) も中止を反映する (`excludePastSessionAction` と同じ)。
    try {
      revalidatePath("/");
    } catch {
      // best-effort
    }
    return { ok: true, method: "native-cancelled", sessions: n };
  }

  // 同期式: revalidatePath("/") は呼ばない (`excludePastSessionAction` の
  // sync の分岐と同じ理由。TOP の描画が外部シートの取得を待つ)。画面が自分で
  // 取り直す。
  const { data, error } = await supabase
    .from("schedule_past_sessions")
    .update({ excluded_at: new Date().toISOString() })
    .is("excluded_at", null)
    .gte("parsed_date", range.from)
    .lt("parsed_date", range.to)
    .select("raw_date");
  if (error) return { ok: false, reason: dbError("過去ログからの除外", error) };
  const n = (data ?? []).length;
  if (n === 0) return { ok: false, reason: "その日の過去の日程が見つかりませんでした" };
  return { ok: true, method: "excluded", sessions: n };
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
