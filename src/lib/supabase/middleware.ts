import "server-only";
import { createServerClient } from "@supabase/ssr";
import type { UserAppMetadata } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { requireSupabaseEnv } from "./env";

/**
 * Supabase の SSR セッション維持を proxy.ts から呼ぶためのヘルパー。
 *
 * 公式パターン (https://supabase.com/docs/guides/auth/server-side):
 *   - リクエストが来るたびに anon key で server client を作成
 *   - cookie の getAll / setAll を NextRequest / NextResponse に橋渡し
 *   - cookie に入っている JWT を検証 → user 情報を取り出す
 *
 * 戻り値の `response` は cookie 書き戻し済みなので、proxy 側はこれに
 * `redirect` などを重ねるか、そのまま return するだけで良い。
 *
 * **TODO #54 part2-c**: Auth API 往復削減のため `getUser()` から
 * `getClaims()` に切り替え。`getClaims()` は asymmetric JWT signing
 * key (RS256/ES256, kid あり) であれば JWKS を WebCrypto でローカル
 * 検証して Supabase Auth API への往復をスキップする (JWKS はクライアント
 * 内キャッシュ)。symmetric (HS256) のままだと内部で `getUser()` に
 * フォールバックするため効果ゼロ。Supabase Dashboard → Settings →
 * API → JWT Keys で asymmetric への migration が必要。
 */
export type AuthenticatedUser = {
  id: string;
  app_metadata: UserAppMetadata;
};

export async function updateSession(
  request: NextRequest,
  // 2.4 (2026-06-09) TODO #84: proxy.ts で生成した CSP nonce 等の追加
  // request header を Server Components に伝搬させるための optional 引数。
  // `NextResponse.next({ request: { headers } })` の `headers` は
  // 「downstream の render が `headers()` で読む値」を決定する。
  initialRequestHeaders?: Headers,
) {
  /**
   * `NextResponse.next({ request: { headers } })` の `headers` は「downstream の
   * render が `headers()` / `cookies()` で読む値」を決める。cookie は Cookie
   * ヘッダそのもの (Next 16 docs `proxy.md` "Using cookies": *Cookies are regular
   * headers. On a `Request`, they are stored in the `Cookie` header.*) なので、
   * refresh でローテーションした cookie を下流に届けるには **setAll のたびに**
   * `request.headers` から作り直す必要がある。
   *
   * 2026-08-05 監査 M-2: ここを初回スナップショットの使い回しにしていたため、
   * Supabase がトークンをローテーションした当該リクエストで Server Component
   * 側が失効済み access token + 消費済み refresh token を受け取っていた。
   * proxy は「認証済み」と判定するのに `requireDiscordMember()` は `/login` へ
   * redirect する不整合が起き、refresh token 再利用検知の猶予を外れると
   * セッション一族ごと失効して強制ログアウトになる。
   */
  const buildNextInit = () => {
    if (!initialRequestHeaders) return { request };
    // `request.cookies.set()` は request.headers の Cookie を書き換えるので、
    // 最新の request.headers を土台にしたうえで、proxy.ts が足した追加ヘッダ
    // (CSP nonce / Content-Security-Policy) だけを上書きで戻す。
    const headers = new Headers(request.headers);
    for (const [key, value] of initialRequestHeaders) {
      if (key.toLowerCase() === "cookie") continue;
      headers.set(key, value);
    }
    return { request: { headers } };
  };

  let response = NextResponse.next(buildNextInit());

  // D-4 (2026-07-12 監査): `!` アサーションを fail-fast 検証に置換。
  const { url: supabaseUrl, anonKey } = requireSupabaseEnv();
  const supabase = createServerClient(
    supabaseUrl,
    anonKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next(buildNextInit());
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  const readClaims = async (): Promise<AuthenticatedUser | null> => {
    const { data } = await supabase.auth.getClaims();
    if (!data?.claims) return null;
    return {
      id: data.claims.sub,
      app_metadata: (data.claims.app_metadata ?? {}) as UserAppMetadata,
    };
  };

  const user = await readClaims();

  return {
    user,
    supabase,
    readClaims,
    /**
     * `response` は `setAll` のたびに差し替わる。呼び出し側が
     * `refreshSession()` 等で cookie を更新したあとに最新の response を
     * 取れるよう、参照ではなく getter で返す (2026-08-05 監査 H-1:
     * proxy 側のメンバーシップ再検証が cookie を書き戻すため)。
     */
    getResponse: () => response,
  };
}
