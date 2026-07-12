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
  const nextInit = initialRequestHeaders
    ? { request: { headers: initialRequestHeaders } }
    : { request };
  let response = NextResponse.next(nextInit);

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
          response = NextResponse.next(nextInit);
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  const { data } = await supabase.auth.getClaims();

  let user: AuthenticatedUser | null = null;
  if (data?.claims) {
    user = {
      id: data.claims.sub,
      app_metadata: (data.claims.app_metadata ?? {}) as UserAppMetadata,
    };
  }

  return { user, response };
}
