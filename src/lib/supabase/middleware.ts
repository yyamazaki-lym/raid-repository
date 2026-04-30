import "server-only";
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Supabase の SSR セッション維持を proxy.ts から呼ぶためのヘルパー。
 *
 * 公式パターン (https://supabase.com/docs/guides/auth/server-side):
 *   - リクエストが来るたびに anon key で server client を作成
 *   - cookie の getAll / setAll を NextRequest / NextResponse に橋渡し
 *   - `getUser()` を呼ぶことで自動的に access_token をリフレッシュ
 *     (期限切れなら refresh_token を消費して新しい cookie を書き戻す)
 *
 * 戻り値の `response` は cookie 書き戻し済みなので、proxy 側はこれに
 * `redirect` などを重ねるか、そのまま return するだけで良い。
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // IMPORTANT: getUser() は JWT を検証する。getSession() だけでは
  // cookie に入っている JWT を検証せず信用してしまうので、proxy で
  // 認可判定するなら必ず getUser() を使う (Supabase 公式の指示)。
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { user, response };
}
