import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * サイト全体を Discord メンバー限定にする proxy。
 *
 * Next.js 16 で `middleware.ts` は `proxy.ts` に改名された。
 * docs: node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md
 *
 * フロー:
 *   1. updateSession() で Supabase セッションを refresh + getUser() で検証
 *   2. PUBLIC_PATH (login / OAuth callback / cron / health 等) はそのまま通す
 *   3. 未ログイン → /login (next= で元 URL を保持)
 *   4. ログイン済みだが Discord guild メンバーでない → /auth/denied
 *
 * メンバーシップは /auth/callback で検証して `auth.users.app_metadata`
 * (`discord_guild_member`, `discord_roles`) に書き込まれており、JWT に
 * 同梱されている。proxy はその cookie/JWT を見るだけなので毎回 Discord
 * API を叩かない。最新化したい場合は再ログインで refresh される。
 *
 * Server Function (Server Action) の認可: Next.js 16 docs の警告どおり
 * matcher のリファクタで proxy のカバレッジが silent に外れる可能性が
 * あるため、書き込み系の Server Action / Route Handler 側でも
 * `requireDiscordMember()` (src/lib/server/auth.ts) を呼んで
 * defense-in-depth を取る方針。
 */

// 完全一致で公開するパス
const PUBLIC_PATHS = new Set<string>([
  "/login",
  "/auth/callback",
  "/auth/denied",
  "/auth/sign-out",
]);

// 前方一致で公開するパス
const PUBLIC_PREFIXES = [
  "/api/cron/", // Vercel Cron — CRON_SECRET で別途認証
  "/api/health", // ヘルスチェック
];

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export async function proxy(request: NextRequest) {
  const { user, response } = await updateSession(request);
  const { pathname, search } = request.nextUrl;

  if (isPublicPath(pathname)) {
    return response;
  }

  if (!user) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname + search);
    return NextResponse.redirect(loginUrl);
  }

  const appMeta = (user.app_metadata ?? {}) as {
    discord_guild_member?: boolean;
  };
  if (appMeta.discord_guild_member !== true) {
    return NextResponse.redirect(new URL("/auth/denied", request.url));
  }

  return response;
}

export const config = {
  // 静的アセット / 画像最適化は proxy を通さない (cookie 書き戻しが
  // 無駄に発生し、Vercel の関数呼び出し料金にも効く)。
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|mp4)$).*)",
  ],
};
