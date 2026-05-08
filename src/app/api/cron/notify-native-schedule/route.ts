import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { dispatchNoonNotifyForToday } from "@/lib/server/native-schedule-discord";

/**
 * Vercel Cron (TODO #2 phase 4, 2026-05-08): 当日昼 12:00 JST に native
 * スケジュールの DECISION セッションを Discord 通知する。
 *
 * Schedule: `0 3 * * *` UTC = 12:00 JST。auth は snapshot-schedule cron と
 * 同パターン (`Authorization: Bearer ${CRON_SECRET}` または `x-vercel-cron`
 * header)。`app_settings.native_schedule_discord_notify_enabled='false'` の
 * ときは早期 return (`{ ok: true, skipped: "disabled" }`) で Discord 投稿 0。
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    console.warn("[cron/notify-native-schedule] CRON_SECRET not configured");
    return NextResponse.json({ error: "not configured" }, { status: 503 });
  }

  const isVercelCron = req.headers.get("x-vercel-cron") !== null;
  const expected = `Bearer ${secret}`;
  const headerOk = authHeader === expected || authHeader?.trim() === expected;
  if (!headerOk && !isVercelCron) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await dispatchNoonNotifyForToday();
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 503 });
  }
  return NextResponse.json({
    ok: true,
    posted: result.posted,
    skipped: result.skipped,
  });
}
