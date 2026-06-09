import "server-only";
import { type NextRequest, NextResponse } from "next/server";
import {
  buildAuthorizeUrl,
  buildRedirectUri,
} from "@/lib/server/fflogs-oauth";
import { assertAdminResult } from "@/lib/server/auth";

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
 *
 * 2.x (2026-06-09): admin gate を追加。非 admin が叩くと
 * `/auth/denied?reason=not_admin` にリダイレクト。理由は (a) FFLogs 連携は
 * admin が固定全体の設定として行う運用、(b) 非 admin が start を叩くと
 * OAuth state cookie が上書きされ admin の連携途中フローを破壊できる
 * (defense-in-depth の二重ゲート)。
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const auth = await assertAdminResult();
  if (!auth.ok) {
    return NextResponse.redirect(
      new URL("/auth/denied?reason=not_admin", origin),
    );
  }
  const redirectUri = buildRedirectUri(origin);
  const result = await buildAuthorizeUrl(redirectUri);
  if (!result.ok) {
    // Redirect back to home with error param so the settings dialog
    // can toast the message — much friendlier than a raw JSON error
    // page when the user just clicked "FFLogs と OAuth 接続" and is
    // missing env vars.
    const homeUrl = new URL("/", origin);
    homeUrl.searchParams.set("fflogs_oauth_error", result.reason);
    return NextResponse.redirect(homeUrl);
  }
  // 2.x: state を HttpOnly cookie に焼き付けて 1 ユーザー 1 state に
  // バインド。callback で同 cookie 値と URL の `state` を照合する。
  const response = NextResponse.redirect(result.url);
  response.cookies.set("fflogs_oauth_state", result.state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600, // 10 分以内に callback が返らない OAuth は破棄
  });
  return response;
}
