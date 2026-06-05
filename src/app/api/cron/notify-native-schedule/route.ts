import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { dispatchNoonNotifyForToday } from "@/lib/server/native-schedule-discord";

/**
 * native スケジュールの DECISION セッションを Discord 通知する route
 * (TODO #2 phase 4, 2026-05-08)。
 *
 * 発火元は Vercel Cron ではなく **Supabase pg_cron**
 * (`supabase/schema.sql` Section 13 の `notify-native-schedule-hourly`、
 * 毎時 0 分 UTC = JST 毎時 0 分発火、`pg_net.http_get` で本 route を叩く)。
 * Vercel Hobby cron が sub-daily 限定のため毎時発火を pg_cron に逃がしている。
 *
 * 当日通知の目標時刻は `app_settings.native_schedule_discord_notify_hour`
 * (default 12 = 12:00 JST)。route 側 HH gate で目標時のみ実通知し、それ以外の
 * hour は 0 投稿で early return する。auth は snapshot-schedule cron と同
 * パターン (`Authorization: Bearer ${CRON_SECRET}` または `x-vercel-cron`
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
