import "server-only";
import { cache } from "react";
import { getPortalSetting } from "@/lib/supabase/app-settings";
import { SCHEDULE_SOURCE_MODE_KEY } from "./settings-keys";

// 2026-07-12 監査 A-2: キー定数は settings-keys.ts (純定数モジュール) へ移動。
// 既存 import 互換のため re-export を維持する。
export { SCHEDULE_SOURCE_MODE_KEY };

/**
 * スケジュール機能のソースモード (TODO #2 phase 1, 2026-05-07)。
 *
 * - `sync`: 既存挙動。`app_settings.schedule_url` の character-sheets
 *   を fetch + parse してスケジュール表を作る。編集は iframe 経由。
 * - `native`: 自前実装。`native_schedule_*` テーブルから出欠データを
 *   読み出して描画。candidate / decision の状態管理 + Discord 通知
 *   は phase 2 以降で実装。phase 1 では skeleton (空 sessions) のみ。
 * - `disabled`: 機能停止。スケジュール page は notice のみ表示。
 *   過去データは保持されており、`sync` または `native` に戻せば復活。
 *
 * mode 切替で DB は破壊しない (両方残置方針) — 切替コストは
 * `app_settings.schedule_source_mode` の 1 行 update のみ。
 */
export type ScheduleSourceMode = "sync" | "native" | "disabled";

/**
 * `app_settings.schedule_source_mode` を読み出して返す。
 *
 * - 行が無い (= 一度も保存していない) → `'sync'` (既存運用と互換)
 * - 値が想定外 (typo 等) → `'sync'` (fail-safe で既存挙動)
 *
 * `React.cache` で同一 render 内のクエリ重複を排除。読み出しは
 * `fetchPortalSettings()` の一括 SELECT に相乗りする (A-2)。
 */
export const getScheduleSourceMode = cache(
  async (): Promise<ScheduleSourceMode> => {
    const v = await getPortalSetting(SCHEDULE_SOURCE_MODE_KEY);
    if (v === "native" || v === "disabled" || v === "sync") return v;
    return "sync";
  },
);
