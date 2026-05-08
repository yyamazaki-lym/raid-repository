import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
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

/**
 * Service-role Supabase client. RLS をバイパスして書き込みできる、cookie session
 * を持たない pure server client。
 *
 * 用途:
 *   - Vercel cron (Discord 通知 / snapshot / import) で anon に降格して
 *     UPDATE が RLS で拒否されるのを避ける
 *   - admin gate を server action 側で済ませた後の重い書き込みを一括処理
 *
 * 取扱注意: anon ではなく service role の権限なので、呼び出し元で必ず
 * `assertAdminResult()` か CRON_SECRET 経由 auth を済ませること。
 */
export function createSupabaseServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "createSupabaseServiceRoleClient: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing",
    );
  }
  return createSupabaseClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
