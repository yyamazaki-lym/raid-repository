import "server-only";
import { type NextRequest, NextResponse } from "next/server";
import {
  buildRedirectUri,
  exchangeCodeForTokens,
} from "@/lib/server/fflogs-oauth";

/**
 * FFLogs OAuth callback.
 *
 * Receives `?code=...&state=...` from FFLogs after user authorization,
 * exchanges the code for access + refresh tokens (server-to-server
 * with client_secret), persists tokens in `app_settings`, and redirects
 * the user back to the home page with a flag the settings dialog
 * picks up.
 *
 * On error (state mismatch, code exchange failure, etc.) redirects
 * with an `?fflogs_oauth_error=...` query so the UI can toast.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const homeUrl = new URL("/", origin);

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const errorParam = req.nextUrl.searchParams.get("error");

  // FFLogs may redirect back with `?error=access_denied` if the user
  // declined. Surface that to the UI rather than silently swallowing.
  if (errorParam) {
    homeUrl.searchParams.set(
      "fflogs_oauth_error",
      `FFLogs から拒否されました: ${errorParam}`,
    );
    return NextResponse.redirect(homeUrl);
  }

  if (!code || !state) {
    homeUrl.searchParams.set(
      "fflogs_oauth_error",
      "code または state が欠落しています",
    );
    return NextResponse.redirect(homeUrl);
  }

  const redirectUri = buildRedirectUri(origin);
  const result = await exchangeCodeForTokens(code, state, redirectUri);
  if (!result.ok) {
    homeUrl.searchParams.set("fflogs_oauth_error", result.reason);
    return NextResponse.redirect(homeUrl);
  }

  homeUrl.searchParams.set("fflogs_oauth_connected", "1");
  return NextResponse.redirect(homeUrl);
}
