import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { checkRateLimit, clientIpFromHeaders } from "@/lib/rate-limit";

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

/**
 * TODO #40 (2.1): per-IP rate limit を適用する route と上限。
 *
 * - /auth/callback: Discord OAuth callback。連続呼び出しされると
 *   Discord API quota (120/min) が枯渇し、正規ユーザーの OAuth が
 *   止まる。10 req / 30 sec で十分 (正常 flow は 1 〜 2 回)。
 * - /api/cron/*: CRON_SECRET で認証されているが、誤った Bearer で
 *   叩かれた場合でも認証チェック前段に rate limit を入れて課金 /
 *   ログ汚染を抑える。Vercel cron は 1 路線につき秒単位連打しない
 *   ので 10 req / 30 sec で実害無し。
 *
 * windowMs は短めにして「一時的な burst から守る」だけに使う。
 * 長期的な abuse は Vercel WAF / Upstash Redis に任せる方針。
 */
type RateLimitRule = {
  scope: string;
  match: (pathname: string) => boolean;
  limit: number;
  windowMs: number;
};

const RATE_LIMIT_RULES: RateLimitRule[] = [
  {
    scope: "auth-callback",
    match: (p) => p === "/auth/callback",
    limit: 10,
    windowMs: 30_000,
  },
  {
    scope: "api-cron",
    match: (p) => p.startsWith("/api/cron/"),
    limit: 10,
    windowMs: 30_000,
  },
];

function applyRateLimit(request: NextRequest): NextResponse | null {
  const rule = RATE_LIMIT_RULES.find((r) => r.match(request.nextUrl.pathname));
  if (!rule) return null;
  const ip = clientIpFromHeaders(request.headers);
  const result = checkRateLimit(rule.scope, ip, rule.limit, rule.windowMs);
  if (result.allowed) return null;
  return new NextResponse("Too Many Requests", {
    status: 429,
    headers: {
      "Retry-After": String(result.retryAfterSeconds),
      "Cache-Control": "no-store",
    },
  });
}

// Dev-only bypass: `DEV_AUTH_BYPASS=true` + `NODE_ENV !== "production"` で
// Discord guild membership / login チェックを丸ごと skip する。本番ビルド
// では `NODE_ENV === "production"` で必ず無効化される (二重ガード) ため、
// 万一 env が漏れても Vercel 側ではバイパスは効かない。
function isDevAuthBypassEnabled(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.DEV_AUTH_BYPASS === "true"
  );
}

export async function proxy(request: NextRequest) {
  // TODO #40: rate limit は session refresh より前段で評価して、
  // 攻撃時に Supabase への往復も抑える。dev bypass は意図的に rate
  // limit より後に置いて、ローカル開発で 429 を踏まないようにする。
  const limited = applyRateLimit(request);
  if (limited) return limited;

  const { user, response } = await updateSession(request);
  const { pathname, search } = request.nextUrl;

  if (isPublicPath(pathname)) {
    return response;
  }

  // Dev bypass: ログイン状態 / guild membership を一切問わずにそのまま通す。
  // この経路を取るのはローカル開発時のみ (NODE_ENV ガード済み)。
  if (isDevAuthBypassEnabled()) {
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
