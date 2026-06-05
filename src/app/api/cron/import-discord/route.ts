import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { runDiscordImport } from "@/lib/server/discord-import";

/**
 * Vercel Cron entrypoint — daily import of strategy / video URLs from
 * configured Discord channels into category_links.
 *
 * The actual logic lives in `lib/server/discord-import.ts`; this route only
 * deals with auth + JSON shaping. The same core function is also called
 * from the "Import now" Server Action (UI button).
 *
 * Authorization
 * -------------
 * Either of these is acceptable:
 *   - `Authorization: Bearer ${CRON_SECRET}` (for external/manual curl calls)
 *   - `x-vercel-cron` header present (Vercel-issued cron triggers, both
 *     scheduled and dashboard "Run" button)
 *
 * Schedule defined in `vercel.json`: 0 16 * * * (01:00 JST).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    console.warn("[cron/discord] CRON_SECRET not configured");
    return NextResponse.json({ error: "not configured" }, { status: 503 });
  }

  const isVercelCron = req.headers.get("x-vercel-cron") !== null;
  const expected = `Bearer ${secret}`;
  const headerOk = authHeader === expected || authHeader?.trim() === expected;

  if (!headerOk && !isVercelCron) {
    console.warn(
      "[cron/discord] auth failed",
      JSON.stringify({
        receivedHeaderLength: authHeader?.length ?? 0,
        receivedHeaderPrefix: authHeader?.slice(0, 14) ?? null,
        expectedSecretLength: secret.length,
        hasVercelCronHeader: isVercelCron,
      }),
    );
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await runDiscordImport();
  if (!result.ok) {
    return NextResponse.json(
      { error: result.reason ?? "import failed" },
      { status: 503 },
    );
  }
  return NextResponse.json({ ok: true, results: result.results });
}
