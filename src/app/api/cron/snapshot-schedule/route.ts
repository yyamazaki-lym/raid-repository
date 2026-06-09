import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { runScheduleSnapshot } from "@/lib/server/schedule-snapshot";
import { getScheduleSourceMode } from "@/lib/schedule/source-mode";
import { assertCronAuth } from "@/lib/server/cron-auth";

/**
 * Vercel Cron: snapshot character-sheets attendance into
 * `schedule_past_sessions` so the data survives upstream pruning.
 *
 * Schedule: 12:50 UTC = 21:50 JST. Right before raid time, when the
 * latest answers from members are most likely to be in.
 *
 * Authorization は `assertCronAuth` (src/lib/server/cron-auth.ts) に集約。
 *
 * 2.x (2026-06-09): maxDuration を 60 → 300 に揃える (char-sheets fetch
 * + 多数 row の UPSERT を含むので余裕を持たせる)。
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const denied = assertCronAuth(req, "cron/snapshot-schedule");
  if (denied) return denied;

  const mode = await getScheduleSourceMode();
  if (mode !== "sync") {
    return NextResponse.json({ ok: true, skipped: "mode not sync" });
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
    cleanedCandidates: result.cleanedCandidates,
  });
}
