import "server-only";
import { type NextRequest, NextResponse } from "next/server";
import { disconnectFflogsOAuth } from "@/lib/server/fflogs-oauth";
import { assertAdminResult } from "@/lib/server/auth";

/**
 * Clear FFLogs OAuth tokens. Settings UI calls this when the user
 * clicks "Disconnect". Returns JSON so the client can show feedback
 * without a redirect.
 *
 * 2.x (2026-06-09): admin gate を追加。非 admin guild メンバーが
 * POST を直接叩いて admin の FFLogs 連携を解除できないようにする。
 * Server Action は next-action ヘッダで CSRF 防御が自動だが、Route
 * Handler は自動 CSRF 防御が無い。認可は「被害者=admin 自身の cookie」で
 * 通ってしまうため CSRF 対策にはならない。sign-out/route.ts と同じく
 * Origin 検証をクロスサイト強制実行の多層防御として併用する。
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // CSRF: クロスサイトからの強制連携解除を防ぐため Origin を検証する。
  // 同一オリジンの fetch/form POST は Origin ヘッダを送るので、Origin が
  // あって自オリジンと不一致なら拒否 (Origin 無しの古い UA は従来どおり許容)。
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  const auth = await assertAdminResult();
  if (!auth.ok) {
    return NextResponse.json({ error: "admin role required" }, { status: 403 });
  }
  const result = await disconnectFflogsOAuth();
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 503 });
  }
  return NextResponse.json({ ok: true });
}
