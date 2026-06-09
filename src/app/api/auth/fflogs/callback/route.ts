import "server-only";
import { type NextRequest, NextResponse } from "next/server";
import {
  buildRedirectUri,
  exchangeCodeForTokens,
} from "@/lib/server/fflogs-oauth";
import { assertAdminResult } from "@/lib/server/auth";

/**
 * FFLogs OAuth callback.
 *
 * Receives `?code=...&state=...` from FFLogs after user authorization,
 * exchanges the code for access + refresh tokens (server-to-server
 * with client_secret), persists tokens in encrypted `secrets`, and
 * redirects the user back to the home page with a flag the settings
 * dialog picks up.
 *
 * 2.x (2026-06-09):
 * - admin gate を追加。FFLogs 連携は admin が固定全体の設定として
 *   行う運用なので、非 admin が callback を完走できないようにする。
 * - state を `app_settings` の単一行ではなく start 時に焼いた
 *   HttpOnly cookie (`fflogs_oauth_state`) と比較。1 ユーザー 1 state
 *   バインドで、2 名同時 OAuth でも衝突しない & anon SELECT 経由で
 *   state が漏れない。
 *
 * On error (state mismatch, code exchange failure, etc.) redirects
 * with an `?fflogs_oauth_error=...` query so the UI can toast.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const homeUrl = new URL("/", origin);

  const auth = await assertAdminResult();
  if (!auth.ok) {
    return NextResponse.redirect(
      new URL("/auth/denied?reason=not_admin", origin),
    );
  }

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const errorParam = req.nextUrl.searchParams.get("error");
  const cookieState = req.cookies.get("fflogs_oauth_state")?.value ?? null;

  function clearStateCookie(response: NextResponse): NextResponse {
    response.cookies.set("fflogs_oauth_state", "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
    return response;
  }

  // FFLogs may redirect back with `?error=access_denied` if the user
  // declined. Surface that to the UI rather than silently swallowing.
  if (errorParam) {
    homeUrl.searchParams.set(
      "fflogs_oauth_error",
      `FFLogs から拒否されました: ${errorParam}`,
    );
    return clearStateCookie(NextResponse.redirect(homeUrl));
  }

  if (!code || !state) {
    homeUrl.searchParams.set(
      "fflogs_oauth_error",
      "code または state が欠落しています",
    );
    return clearStateCookie(NextResponse.redirect(homeUrl));
  }

  if (!cookieState || cookieState !== state) {
    homeUrl.searchParams.set(
      "fflogs_oauth_error",
      "OAuth state が一致しません — リクエストが改ざんされたか cookie が失効した可能性",
    );
    return clearStateCookie(NextResponse.redirect(homeUrl));
  }

  const redirectUri = buildRedirectUri(origin);
  const result = await exchangeCodeForTokens(code, redirectUri);
  if (!result.ok) {
    homeUrl.searchParams.set("fflogs_oauth_error", result.reason);
    return clearStateCookie(NextResponse.redirect(homeUrl));
  }

  homeUrl.searchParams.set("fflogs_oauth_connected", "1");
  return clearStateCookie(NextResponse.redirect(homeUrl));
}
