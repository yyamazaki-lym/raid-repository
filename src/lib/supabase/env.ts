/**
 * Supabase 必須 env の fail-fast リーダー (2026-07-12 監査 D-4)。
 *
 * 従来は `process.env.NEXT_PUBLIC_SUPABASE_URL!` の非 null アサーションで
 * 型だけ通し、未設定時は `undefined` が supabase-js に渡って「実行時の
 * 不明瞭なエラー」として遅延顕在化していた (どの env が欠けたのか
 * スタックから読めない)。ここで欠落キー名を列挙した Error を投げる。
 *
 * 依存追加なしの最小実装。`NEXT_PUBLIC_*` はビルド時インライン置換される
 * ため client bundle でも同様に動く (未設定ビルド → 実行時に明確な文言)。
 * SUPABASE_SERVICE_ROLE_KEY は対象外 — 既に `createSupabaseServiceRoleClient`
 * が明示 throw している (server.ts)。
 */
export function requireSupabaseEnv(): { url: string; anonKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    const missing = [
      !url ? "NEXT_PUBLIC_SUPABASE_URL" : null,
      !anonKey ? "NEXT_PUBLIC_SUPABASE_ANON_KEY" : null,
    ]
      .filter(Boolean)
      .join(", ");
    throw new Error(
      `Supabase の必須環境変数が未設定です: ${missing} — .env.local (ローカル) / ` +
        "Vercel の Environment Variables を確認してください (README の Deploy 手順参照)",
    );
  }
  return { url, anonKey };
}
