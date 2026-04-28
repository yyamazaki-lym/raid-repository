"use client";

import { createClient } from "@/lib/supabase/client";
import { SCHEDULE_TOP_TEXT_OVERRIDE_KEY } from "@/lib/schedule-top-text-keys";

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
 *
 * Key 定数は server / client 両方で使うため、`"use client"` 指令を
 * 持たない `schedule-top-text-keys.ts` に切り出して両方から import。
 * (1.9 (2026-04-28): 当初この file 内で定義 + export していたが、
 * `"use client"` 経由の文字列 export は server component から見ると
 * Server Reference proxy 化されてしまい、`fetchAppSetting()` が常に
 * null を返すバグが発生していた。独立 module 化で解決。)
 */

const TOP_TEXT_OVERRIDE_KEY = SCHEDULE_TOP_TEXT_OVERRIDE_KEY;

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

/* `SCHEDULE_TOP_TEXT_OVERRIDE_KEY` は `schedule-top-text-keys.ts` で定義し、
   こちらでは re-export しない (上述の Server Reference proxy 化バグ回避)。 */
