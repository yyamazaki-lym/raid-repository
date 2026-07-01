"use server";

import { createClient } from "@/lib/supabase/server";
import { SCHEDULE_TOP_TEXT_OVERRIDE_KEY } from "@/lib/schedule-top-text-keys";
import { assertAdminResult } from "./auth";
import { dbError } from "./db-error";

/**
 * schedule_top_text_override (app_settings) の書き込み Server Actions
 * (監査バッチC #18, 2026-06-24)。category-macros-actions と同方針
 * (app gate + RLS の二層化)。読み取り (getScheduleTopTextOverride /
 * parseSchedule の fetchAppSetting) は anon のまま。
 */

type TopTextWriteResult = { ok: true } | { ok: false; reason: string };

/** 空文字なら override を削除 (= scraped 値に戻る)、それ以外は upsert。 */
export async function setScheduleTopTextOverrideAction(
  raw: string,
): Promise<TopTextWriteResult> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: auth.reason };

  const trimmed = raw.trim();
  // category_macros (char_length<=8000 CHECK) と揃えた長さ上限。app_settings.value
  // は長さ CHECK が無い裸の text なので、巨大ペイロードによる DB/描画肥大を
  // action 側で防ぐ。
  const MAX_TOP_TEXT_LEN = 8000;
  if (trimmed.length > MAX_TOP_TEXT_LEN) {
    return {
      ok: false,
      reason: `本文が長すぎます (最大 ${MAX_TOP_TEXT_LEN} 文字)`,
    };
  }
  const supabase = await createClient();
  if (!trimmed) {
    const { error } = await supabase
      .from("app_settings")
      .delete()
      .eq("key", SCHEDULE_TOP_TEXT_OVERRIDE_KEY);
    if (error) return { ok: false, reason: dbError("ルール保存", error) };
    return { ok: true };
  }
  const { error } = await supabase
    .from("app_settings")
    .upsert(
      { key: SCHEDULE_TOP_TEXT_OVERRIDE_KEY, value: trimmed },
      { onConflict: "key" },
    );
  if (error) return { ok: false, reason: dbError("ルール保存", error) };
  return { ok: true };
}

/** Override をクリアして scraped 値表示に戻す。 */
export async function clearScheduleTopTextOverrideAction(): Promise<TopTextWriteResult> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: auth.reason };

  const supabase = await createClient();
  const { error } = await supabase
    .from("app_settings")
    .delete()
    .eq("key", SCHEDULE_TOP_TEXT_OVERRIDE_KEY);
  if (error) return { ok: false, reason: dbError("ルールクリア", error) };
  return { ok: true };
}
