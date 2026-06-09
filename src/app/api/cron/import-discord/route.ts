import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { runDiscordImport } from "@/lib/server/discord-import";
import { assertCronAuth } from "@/lib/server/cron-auth";

/**
 * Vercel Cron entrypoint — daily import of strategy / video URLs from
 * configured Discord channels into category_links.
 *
 * The actual logic lives in `lib/server/discord-import.ts`; this route only
 * deals with auth + JSON shaping. The same core function is also called
 * from the "Import now" Server Action (UI button).
 *
 * Authorization は `assertCronAuth` (src/lib/server/cron-auth.ts) に集約。
 * `Authorization: Bearer ${CRON_SECRET}` または `x-vercel-cron` ヘッダで通過。
 *
 * Schedule defined in `vercel.json`: 0 16 * * * (01:00 JST).
 *
 * 2.x (2026-06-09): maxDuration を 60 → 300 に引き上げ。N カテゴリ並列 ×
 * 5 ページの message fetch (15s timeout) × per-URL enrichment で 60s を
 * 超えるケースがあり、全カテゴリの insert がロールバックされるリスクが
 * あった。Vercel 標準 default (300s) に揃える。
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const denied = assertCronAuth(req, "cron/discord");
  if (denied) return denied;

  const result = await runDiscordImport();
  if (!result.ok) {
    return NextResponse.json(
      { error: result.reason ?? "import failed" },
      { status: 503 },
    );
  }
  return NextResponse.json({ ok: true, results: result.results });
}
