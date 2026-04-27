import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { runScheduleSnapshot } from "@/lib/server/schedule-snapshot";

/**
 * Vercel Cron: snapshot character-sheets attendance into
 * `schedule_past_sessions` so the data survives upstream pruning.
 *
 * Schedule: 12:50 UTC = 21:50 JST. Right before raid time, when the
 * latest answers from members are most likely to be in. Same auth
 * pattern as the discord-import cron (CRON_SECRET bearer or
 * x-vercel-cron header).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    console.warn("[cron/snapshot-schedule] CRON_SECRET not configured");
    return NextResponse.json({ error: "not configured" }, { status: 503 });
  }

  const isVercelCron = req.headers.get("x-vercel-cron") !== null;
  const expected = `Bearer ${secret}`;
  const headerOk = authHeader === expected || authHeader?.trim() === expected;
  if (!headerOk && !isVercelCron) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await runScheduleSnapshot();
  if (!result.ok) {
    return NextResponse.json(
      { error: result.reason ?? "snapshot failed" },
      { status: 503 },
    );
  }
  return NextResponse.json({
    ok: true,
    scanned: result.scanned,
    inserted: result.inserted,
    updated: result.updated,
  });
}
