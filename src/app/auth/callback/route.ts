import "server-only";
import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  fetchGuildMember,
  updateUserAppMetadata,
} from "@/lib/server/discord-membership";
import { userIsAdmin } from "@/lib/server/auth";

/**
 * Supabase の Discord OAuth 完了後にリダイレクトされてくるエンドポイント。
 *
 * フロー:
 *   1. `?code=...` を受け取って `exchangeCodeForSession` でセッション cookie を確立
 *   2. user.identities から Discord の provider_id (snowflake) を取り出す
 *   3. bot token で対象 guild のメンバーかを検証 + ロール一覧取得
 *   4. service-role で app_metadata に { discord_guild_member, discord_roles, ... } を書き込み
 *   5. JWT を refresh して新しい app_metadata を cookie に乗せ直す
 *   6. ?next= が指定されていればそこへ、そうでなければ "/" にリダイレクト
 *
 * 失敗時の挙動:
 *   - code 欠落 → /login?error=...
 *   - メンバーでない / Discord API エラー → signOut() してから /auth/denied
 *     (cookie を残すと proxy ループはしないが、見た目「ログイン済みっぽい」
 *     状態になるので明示的に消す)
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const next = sanitizeNextParam(req.nextUrl.searchParams.get("next"));

  if (!code) {
    return redirectTo(req, "/login", { error: "missing_code" });
  }

  const supabase = await createClient();

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) {
    return redirectTo(req, "/login", {
      error: "exchange_failed",
      detail: error?.message ?? "no_user",
    });
  }

  const discordIdentity = data.user.identities?.find(
    (i) => i.provider === "discord",
  );
  // Supabase の identities[].identity_data.provider_id (= Discord snowflake)
  // を優先。フォールバックで identity_data.sub も見る。
  const discordId =
    (discordIdentity?.identity_data as
      | { provider_id?: string; sub?: string }
      | undefined)?.provider_id ??
    (discordIdentity?.identity_data as { sub?: string } | undefined)?.sub;

  if (!discordId) {
    await supabase.auth.signOut();
    return redirectTo(req, "/auth/denied", { reason: "no_discord_id" });
  }

  const membership = await fetchGuildMember(discordId);
  if (!membership.ok) {
    await supabase.auth.signOut();
    return redirectTo(req, "/auth/denied", { reason: membership.reason });
  }

  try {
    // TODO #36 phase 2: is_admin を JWT に同梱して RLS から参照可能に。
    // `userIsAdmin` は env `DISCORD_ADMIN_ROLE_IDS` 未設定時 false を返す
    // (fail-closed、2.x で変更) ので、その挙動も自動的に JWT 経由で RLS に
    // 伝播する (env 未設定 = 全員 非admin = RLS write も deny)。
    const isAdmin = userIsAdmin(membership.roles);
    await updateUserAppMetadata(data.user.id, {
      discord_id: discordId,
      discord_guild_member: true,
      discord_roles: membership.roles,
      discord_member_verified_at: new Date().toISOString(),
      is_admin: isAdmin,
    });
  } catch (e) {
    console.error("[auth/callback] updateUserAppMetadata failed", e);
    await supabase.auth.signOut();
    return redirectTo(req, "/auth/denied", { reason: "metadata_write_failed" });
  }

  // app_metadata の更新は JWT に反映されないので refresh が必須。
  // proxy.ts は user.app_metadata.discord_guild_member を見ているので、
  // refresh しないと初回リダイレクトでまた /auth/denied に飛ばされる。
  await supabase.auth.refreshSession();

  // 二重防御: sanitizeNextParam をすり抜けても、解決後の URL が自オリジン以外を
  // 指していたら "/" に落とす。`new URL(next, req.url)` は WHATWG 正規化で
  // バックスラッシュを "/" 等価に扱うため、相対パス前提の sanitize だけでは
  // protocol-relative (`/\evil.com` → `//evil.com`) を取りこぼし得る。
  const target = new URL(next, req.url);
  if (target.origin !== req.nextUrl.origin) {
    return NextResponse.redirect(new URL("/", req.url));
  }
  return NextResponse.redirect(target);
}

function redirectTo(
  req: NextRequest,
  path: string,
  params: Record<string, string>,
) {
  const url = new URL(path, req.url);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return NextResponse.redirect(url);
}

/**
 * `?next=` の中身は攻撃者が制御できる文字列なので、相対パスかつ "/" 始まり
 * (かつ "//" 始まりでない) にしか飛ばさない。
 *
 * ⚠ バックスラッシュは拒否する: `searchParams.get` でデコード済みの値に対し、
 * 後段の `new URL(next, req.url)` が WHATWG URL 正規化でバックスラッシュを "/"
 * 等価に扱うため、`?next=/%5Cevil.com` (= `/\evil.com`) が "/" 始まり・非 "//"
 * を通過したうえで `//evil.com` (protocol-relative) に解決され外部オリジンへ
 * 飛んでしまう (オープンリダイレクト)。解決後の origin 検証 (GET 側) と二重で
 * 防ぐ。
 */
function sanitizeNextParam(value: string | null): string {
  if (!value) return "/";
  if (value.includes("\\")) return "/";
  if (!value.startsWith("/")) return "/";
  if (value.startsWith("//")) return "/";
  return value;
}
