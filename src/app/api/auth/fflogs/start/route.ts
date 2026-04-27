import "server-only";
import { type NextRequest, NextResponse } from "next/server";
import {
  buildAuthorizeUrl,
  buildRedirectUri,
} from "@/lib/server/fflogs-oauth";

/**
 * Initiate the FFLogs OAuth Authorization Code Flow.
 *
 * Builds the authorize URL using the request's own origin (so the
 * redirect_uri matches whichever host the user is on — localhost dev
 * or Vercel production), persists the random `state` token for CSRF
 * verification on callback, and 302-redirects to FFLogs.
 *
 * The user grants permission on FFLogs, then FFLogs redirects to
 * `/api/auth/fflogs/callback?code=...&state=...`.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const redirectUri = buildRedirectUri(origin);
  const result = await buildAuthorizeUrl(redirectUri);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 503 });
  }
  return NextResponse.redirect(result.url);
}
