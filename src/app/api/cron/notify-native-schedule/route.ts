import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { dispatchNoonNotifyForToday } from "@/lib/server/native-schedule-discord";
import { assertCronAuth } from "@/lib/server/cron-auth";

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
 * hour は 0 投稿で early return する。
 *
 * Authorization は `assertCronAuth` (src/lib/server/cron-auth.ts) に集約。
 * `Authorization: Bearer ${CRON_SECRET}` (pg_cron が vault から取得) または
 * `x-vercel-cron` ヘッダで通過。
 *
 * `app_settings.native_schedule_discord_notify_enabled='false'` の
 * ときは早期 return (`{ ok: true, skipped: "disabled" }`) で Discord 投稿 0。
 *
 * 2.x (2026-06-09): maxDuration を 60 → 300 に揃える (1 投稿あたりは軽量
 * だが、対象セッション数 × Discord API レイテンシで稀にスパイクする)。
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const denied = assertCronAuth(req, "cron/notify-native-schedule");
  if (denied) return denied;

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
