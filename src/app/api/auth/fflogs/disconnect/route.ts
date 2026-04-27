import "server-only";
import { NextResponse } from "next/server";
import { disconnectFflogsOAuth } from "@/lib/server/fflogs-oauth";

/**
 * Clear FFLogs OAuth tokens. Settings UI calls this when the user
 * clicks "Disconnect". Returns JSON so the client can show feedback
 * without a redirect.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const result = await disconnectFflogsOAuth();
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 503 });
  }
  return NextResponse.json({ ok: true });
}
