import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { checkRateLimit, clientIpFromHeaders } from "@/lib/rate-limit";
import { buildCspHeader, generateCspNonce, CSP_NONCE_HEADER } from "@/lib/csp";

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
  // 2.x (2026-06-09): /api/page-title は認証済ユーザー (および
  // PUBLIC_DEMO_MODE の匿名読者) から任意 URL を fetch する経路で、
  // 制限なしだと Vercel 関数の active CPU 課金と外部 HTTP quota が
  // 浴び続ける。1 分 30 回あれば登録ダイアログの正規利用 (連打 5〜10
  // 回程度) を遥かに超える上限。
  {
    scope: "api-page-title",
    match: (p) => p === "/api/page-title",
    limit: 30,
    windowMs: 60_000,
  },
];

async function applyRateLimit(
  request: NextRequest,
): Promise<NextResponse | null> {
  const rule = RATE_LIMIT_RULES.find((r) => r.match(request.nextUrl.pathname));
  if (!rule) return null;
  const ip = clientIpFromHeaders(request.headers);
  // 2.4 (2026-06-09) TODO #82: `checkRateLimit` は async に変更。Upstash
  // Redis env がセットされていれば分散 fixed-window、未設定なら従来通り
  // in-memory fallback (per-instance) に倒す。
  const result = await checkRateLimit(rule.scope, ip, rule.limit, rule.windowMs);
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

// Public demo mode: `PUBLIC_DEMO_MODE=true` で本番ビルドでも Discord OAuth
// gate を skip する。モックサイト (TODO #8) 用に portal を一般公開する用途。
// dev bypass と違って NODE_ENV ガードを設けず production でも有効になる。
//
// gate skip のみで実セッション cookie はそのまま app 層へ届く。TODO #91
// (案 A) 以降、`auth.ts` の `requireDiscordMember()` が demo でもセッション
// を先に確認し、guild member 検証済みなら本物の roles を返す (= admin
// ロール持ちの owner だけ編集可能)。セッションなし / 非メンバーは roles=[]
// (= 非 admin) のゲストに fallback し、`requireAdmin()` /
// `assertAdminResult()` 経由でアプリ層が書き込みを弾く。ゲストは実
// Supabase auth session を持たないため、書き込み時の `createClient()` は
// anon key で動作 → RLS の `WITH CHECK (auth.jwt()->>is_admin = 'true')`
// も通過できず 4 層防御の最深層 (RLS) でも block される。
function isPublicDemoModeEnabled(): boolean {
  return process.env.PUBLIC_DEMO_MODE === "true";
}

export async function proxy(request: NextRequest) {
  // 2.4 (2026-06-09) TODO #84: CSP nonce をリクエストごとに生成し、
  // (a) Server Components 側で `headers().get('x-nonce')` から取得できる
  //     よう request header に書き込み、
  // (b) browser 側へは response header の `Content-Security-Policy` 値
  //     `script-src 'nonce-${nonce}'` として返す。
  const nonce = generateCspNonce();
  const cspHeader = buildCspHeader(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(CSP_NONCE_HEADER, nonce);
  // Next.js docs: nonce を framework scripts (React runtime / page bundles /
  // Next.js が生成する inline script) に自動適用させるには `Content-Security-Policy`
  // を request header にも書き込む必要がある (Next.js が `'nonce-...'` パターンを
  // パースして拾う仕組み)。response 側にも同値を書き込む。
  requestHeaders.set("Content-Security-Policy", cspHeader);

  // どの return path を通っても browser に CSP が届くよう、戻り値を
  // 装飾するヘルパ。redirect / 429 / 通常 response いずれにも適用。
  const withCsp = <T extends NextResponse>(res: T): T => {
    res.headers.set("Content-Security-Policy", cspHeader);
    return res;
  };

  // TODO #40: rate limit は session refresh より前段で評価して、
  // 攻撃時に Supabase への往復も抑える。dev bypass は意図的に rate
  // limit より後に置いて、ローカル開発で 429 を踏まないようにする。
  const limited = await applyRateLimit(request);
  if (limited) return withCsp(limited);

  const { user, response } = await updateSession(request, requestHeaders);
  const { pathname, search } = request.nextUrl;

  if (isPublicPath(pathname)) {
    return withCsp(response);
  }

  // Dev bypass: ログイン状態 / guild membership を一切問わずにそのまま通す。
  // この経路を取るのはローカル開発時のみ (NODE_ENV ガード済み)。
  if (isDevAuthBypassEnabled()) {
    return withCsp(response);
  }

  // Public demo mode: 本番ビルドでも auth gate を skip。書き込みは
  // auth.ts 側の roles=[] non-admin user で弾かれるので read-only 公開。
  // 優先順位は dev bypass の後 (= ローカル開発で両方 true なら admin 視点維持)。
  if (isPublicDemoModeEnabled()) {
    // gate を外す副作用として、実セッションを持たない匿名ゲストでも
    // /api/page-title (任意 URL を server 側で fetch する経路) を叩けてしまい、
    // 匿名 SSRF / 外部 URL プロキシ・DoS 中継として悪用されうる。内部 IP は
    // isPublicHttpUrl で遮断済みだが、外部 URL への踏み台化を防ぐため demo の
    // 匿名ゲスト (user 無し) には外部 fetch 系 API を 403 で閉じる。実セッションを
    // 持つ owner (リンク登録ダイアログで利用) は user があるので通過する。
    if (!user && pathname === "/api/page-title") {
      return withCsp(
        new NextResponse("Forbidden", {
          status: 403,
          headers: { "Cache-Control": "no-store" },
        }),
      );
    }
    return withCsp(response);
  }

  if (!user) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname + search);
    return withCsp(NextResponse.redirect(loginUrl));
  }

  const appMeta = (user.app_metadata ?? {}) as {
    discord_guild_member?: boolean;
  };
  if (appMeta.discord_guild_member !== true) {
    return withCsp(NextResponse.redirect(new URL("/auth/denied", request.url)));
  }

  return withCsp(response);
}

export const config = {
  // 静的アセット / 画像最適化は proxy を通さない (cookie 書き戻しが
  // 無駄に発生し、Vercel の関数呼び出し料金にも効く)。
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|mp4)$).*)",
  ],
};
