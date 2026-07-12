import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { runScheduleSnapshot } from "@/lib/server/schedule-snapshot";
import { getScheduleSourceMode } from "@/lib/schedule/source-mode";
import { fetchPortalSettings } from "@/lib/supabase/app-settings";
import {
  ensureNativeMonthlyPlaceholders,
  NATIVE_DEFAULT_END_TIME_KEY,
  NATIVE_DEFAULT_START_TIME_KEY,
} from "@/lib/server/native-schedule-placeholders";
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
 *
 * 2026-07-12 監査 A-3: native モード時は snapshot の代わりに
 * `ensureNativeMonthlyPlaceholders` (当月+条件付き翌月の placeholder 敷設) を
 * 日次実行する。従来は TOP の GET 描画が毎リクエスト service role write を
 * 行っていたが、敷設は日次で十分先回りできる (placeholder は月末 7 日前に
 * 翌月分まで投入される) ため cron へ移設し、描画パスは「今日以降の行が
 * 0 件のときだけ自己修復する」フォールバックに縮退した (page.tsx 参照)。
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const denied = assertCronAuth(req, "cron/snapshot-schedule");
  if (denied) return denied;

  const mode = await getScheduleSourceMode();
  if (mode === "native") {
    const settings = await fetchPortalSettings();
    await ensureNativeMonthlyPlaceholders({
      startTime: settings[NATIVE_DEFAULT_START_TIME_KEY],
      endTime: settings[NATIVE_DEFAULT_END_TIME_KEY],
    });
    return NextResponse.json({ ok: true, mode: "native", ensured: true });
  }
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
