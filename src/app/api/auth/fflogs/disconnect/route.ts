import "server-only";
import { NextResponse } from "next/server";
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
 * Handler は自動 CSRF 防御が無いので、認可レベルでの遮断が必須。
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
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
