"use client";

import { createClient } from "@/lib/supabase/client";

/**
 * 運用ルール / 注意事項 (スケジュールページ上部の `topText`) の
 * portal 側ローカル override。元サイトを変更せずポータル内だけで
 * 表示文を上書きできる。
 *
 * 表示優先度:
 *   1. `schedule_top_text_override` (この関数群が読み書きする)
 *   2. parseSchedule が `<p>/<pre>/<blockquote>/<h2-4>` から抽出した
 *      scraped value (元サイト由来)
 *
 * Supabase の共有 `app_settings` テーブルを使用 — 固定メンバー全員に
 * 同じ override が見える。`schedule_url` など他の app_settings と同じ
 * パターン。
 */

const TOP_TEXT_OVERRIDE_KEY = "schedule_top_text_override";

export async function setScheduleTopTextOverride(
  raw: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const trimmed = raw.trim();
  const supabase = createClient();
  if (!trimmed) {
    // 空文字なら override を削除 (= scraped 値に戻る)
    const { error } = await supabase
      .from("app_settings")
      .delete()
      .eq("key", TOP_TEXT_OVERRIDE_KEY);
    if (error) return { ok: false, reason: error.message };
    return { ok: true };
  }
  const { error } = await supabase
    .from("app_settings")
    .upsert(
      { key: TOP_TEXT_OVERRIDE_KEY, value: trimmed },
      { onConflict: "key" },
    );
  if (error) return { ok: false, reason: error.message };
  return { ok: true };
}

export async function getScheduleTopTextOverride(): Promise<string | null> {
  const supabase = createClient();
  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", TOP_TEXT_OVERRIDE_KEY)
    .maybeSingle();
  return (data?.value as string | null | undefined) ?? null;
}

/** Override をクリアして scraped 値表示に戻す */
export async function clearScheduleTopTextOverride(): Promise<
  { ok: true } | { ok: false; reason: string }
> {
  const supabase = createClient();
  const { error } = await supabase
    .from("app_settings")
    .delete()
    .eq("key", TOP_TEXT_OVERRIDE_KEY);
  if (error) return { ok: false, reason: error.message };
  return { ok: true };
}

/** server-side fetch のための key (lib/supabase/app-settings.ts と組合せる) */
export const SCHEDULE_TOP_TEXT_OVERRIDE_KEY = TOP_TEXT_OVERRIDE_KEY;
