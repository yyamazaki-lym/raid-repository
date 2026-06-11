import "server-only";
import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * サインアウト用エンドポイント。
 * SiteHeader の `<form action="/auth/sign-out" method="post">` から POST で叩く想定。
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // CSRF: クロスサイトからの強制ログアウトを防ぐため Origin を検証する。
  // 同一オリジンの form POST は Origin ヘッダを送るので、Origin があって
  // 自オリジンと不一致なら拒否 (Origin 無しの古い UA は従来どおり許容)。
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/login", req.url), { status: 303 });
}
