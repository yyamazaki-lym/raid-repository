import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { dispatchAttendanceReminder } from "@/lib/server/attendance-reminder";
import { assertCronAuth } from "@/lib/server/cron-auth";

/**
 * 出欠未入力者への催促メンション cron (2026-08-30)。
 *
 * 発火元は `notify-native-schedule` と同じ **Supabase pg_cron** (毎時)。
 * route 側で「設定の目標時刻以降か」を判定し、それ以前の hour は 0 投稿で
 * 早期 return する。目標時ちょうどではなく「以降なら再試行」にしているのは
 * native 通知と同じ理由 — 単発失敗でその日の催促が恒久ミスするのを防ぐ。
 * 二重送信は対象日 rawDate の dedup マーカーで抑止する。
 *
 * `attendance_reminder_enabled` が 'true' でないときは何もしない (既定 OFF)。
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const denied = assertCronAuth(req, "cron/attendance-reminder");
  if (denied) return denied;

  const result = await dispatchAttendanceReminder({
    respectToggle: true,
    respectDedup: true,
    respectHour: true,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 503 });
  }
  return NextResponse.json({
    ok: true,
    posted: result.posted,
    skipped: result.skipped,
    reason: result.reason,
  });
}
