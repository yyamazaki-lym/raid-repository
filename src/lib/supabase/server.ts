import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Server-side Supabase client.
 *
 * 通常: anon key + cookie 経由の Supabase session。Discord OAuth で
 * 認証済みのユーザーは JWT が cookie に乗っているので、`auth.uid()` /
 * `auth.role() = 'authenticated'` が解決され RLS が機能する。
 *
 * dev bypass (NODE_ENV !== production && DEV_AUTH_BYPASS=true):
 * Supabase auth session が無いため、TODO #36 で write 系 RLS を
 * `TO authenticated` に絞ると anon 状態だと書き込みが全失敗する。
 * 開発体験を保つため、bypass モード時は service role key で client
 * を作って RLS をバイパスする (production では `NODE_ENV` ガードに
 * 阻まれるので絶対に走らない)。
 */
export async function createClient() {
  const cookieStore = await cookies();

  // Dev bypass: service role で RLS バイパス (development のみ)。
  const isDevBypass =
    process.env.NODE_ENV !== "production" &&
    process.env.DEV_AUTH_BYPASS === "true";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (isDevBypass && serviceKey) {
    return createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceKey,
      {
        cookies: {
          // service role は session を持たないので cookies は触らない。
          getAll() {
            return [];
          },
          setAll() {
            // no-op
          },
        },
      },
    );
  }

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Calling setAll from a Server Component is allowed but no-ops here.
          }
        },
      },
    },
  );
}
