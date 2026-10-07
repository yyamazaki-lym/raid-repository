import "server-only";
import { timingSafeEqual } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";
import {
  buildRedirectUri,
  exchangeCodeForTokens,
} from "@/lib/server/fflogs-oauth";
import { assertAdminResult } from "@/lib/server/auth";
import type { FflogsOauthErrorCode } from "@/lib/fflogs-oauth-error";

/**
 * CSRF state (乱数トークン) の定数時間比較。`===` は先頭一致長で早期 return
 * するため理論上タイミング差が出る。実害はほぼ無い (cookieState は HttpOnly・
 * state は単回使用の乱数) が、暗号トークン照合のベストプラクティスに揃える。
 * 長さ差は先に弾く (timingSafeEqual は等長要求。state は固定長なので長さ自体の
 * リークは無害)。
 */
function timingSafeStrEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

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
 * with an `?fflogs_oauth_error=<code>` query so the UI can toast
 * (code は `fflogs-oauth-error.ts` の既知の値だけ。文は画面側の辞書)。
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

  // 2026-10-07 セキュリティ精査: 画面へ戻す URL には理由のコード
  // (`fflogs-oauth-error.ts`) だけを載せる。文そのものを載せていた頃は、
  // 誰でも `/?fflogs_oauth_error=<任意の文>` で正規のドメインに案内文を
  // 出せた。詳しい理由はここでログに出す。
  function fail(errorCode: FflogsOauthErrorCode, detail: string): NextResponse {
    console.warn("[fflogs-oauth] callback failed:", errorCode, detail);
    homeUrl.searchParams.set("fflogs_oauth_error", errorCode);
    return clearStateCookie(NextResponse.redirect(homeUrl));
  }

  // FFLogs may redirect back with `?error=access_denied` if the user
  // declined. Surface that to the UI rather than silently swallowing.
  if (errorParam) {
    return fail("denied", errorParam.slice(0, 100));
  }

  if (!code || !state) {
    return fail("missing_params", "code または state が欠落しています");
  }

  if (!cookieState || !timingSafeStrEqual(cookieState, state)) {
    return fail(
      "state_mismatch",
      "OAuth state が一致しません — リクエストが改ざんされたか cookie が失効した可能性",
    );
  }

  const redirectUri = buildRedirectUri(origin);
  const result = await exchangeCodeForTokens(code, redirectUri);
  if (!result.ok) {
    return fail(result.code, result.reason);
  }

  homeUrl.searchParams.set("fflogs_oauth_connected", "1");
  return clearStateCookie(NextResponse.redirect(homeUrl));
}
