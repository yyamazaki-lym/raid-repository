"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { fetchAppSetting } from "@/lib/supabase/app-settings";
import { assertAdminResult } from "./auth";
import { dbError } from "./db-error";
import {
  MAINTENANCE_MAX_WINDOWS,
  MAINTENANCE_WINDOWS_KEY,
  isMaintenanceDateTime,
  maintenanceMs,
  parseMaintenanceWindows,
  type MaintenanceWindow,
} from "@/lib/maintenance-schedule";

/**
 * 公式メンテ / パッチ日程の登録 (W-30、2026-09-07)。
 *
 * 公式に機械可読な API が無いので手入力。Lodestone のトピック監視まで
 * 自動化すると scrape 依存になり告知ページの構造変更で黙って壊れるため、
 * 年に数回の入力で足りるこの機能には見合わないと判断した。
 *
 * 保存は `app_settings` の 1 キーに JSON 配列。専用テーブルを作るほどの量
 * ではない (多くても年 20〜30 件)。
 */

export async function getMaintenanceWindowsAction(): Promise<
  { ok: true; windows: MaintenanceWindow[] } | { ok: false; reason: string }
> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: "ADMIN ロールが必要です" };
  const raw = await fetchAppSetting(MAINTENANCE_WINDOWS_KEY);
  return { ok: true, windows: parseMaintenanceWindows(raw) };
}

/**
 * 一覧をまとめて保存する (差分ではなく全置換)。
 *
 * **読み取り側は不正な行を黙って捨てる**が、書き込みではエラーを返す —
 * 入力ミスに気付かないまま「登録したのに警告が出ない」状態になるのを
 * 避けたい。どの行が悪いかも返す。
 */
export async function setMaintenanceWindowsAction(
  windows: ReadonlyArray<{ start: string; end: string; label?: string }>,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: "ADMIN ロールが必要です" };
  if (windows.length > MAINTENANCE_MAX_WINDOWS) {
    return {
      ok: false,
      reason: `登録できるのは ${MAINTENANCE_MAX_WINDOWS} 件までです`,
    };
  }

  const normalized: MaintenanceWindow[] = [];
  for (const [i, w] of windows.entries()) {
    const row = i + 1;
    if (!isMaintenanceDateTime(w.start) || !isMaintenanceDateTime(w.end)) {
      return { ok: false, reason: `${row} 行目: 開始と終了を入力してください` };
    }
    const s = maintenanceMs(w.start);
    const e = maintenanceMs(w.end);
    if (s === null || e === null) {
      return { ok: false, reason: `${row} 行目: 日時の形式が不正です` };
    }
    if (e < s) {
      return { ok: false, reason: `${row} 行目: 終了が開始より前になっています` };
    }
    const label = (w.label ?? "").trim().slice(0, 60);
    normalized.push({ start: w.start, end: w.end, ...(label ? { label } : {}) });
  }
  normalized.sort((a, b) => a.start.localeCompare(b.start));

  const supabase = createSupabaseServiceRoleClient();
  const { error } = await supabase.from("app_settings").upsert(
    { key: MAINTENANCE_WINDOWS_KEY, value: JSON.stringify(normalized) },
    { onConflict: "key" },
  );
  if (error) return { ok: false, reason: dbError("メンテ日程保存", error) };
  try {
    // 衝突警告は TOP の次回開催カードに出るので / を落とす。
    revalidatePath("/");
  } catch {
    // best-effort
  }
  return { ok: true };
}
