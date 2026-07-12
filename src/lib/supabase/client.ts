import { createBrowserClient } from "@supabase/ssr";
import { requireSupabaseEnv } from "./env";

export function createClient() {
  // D-4 (2026-07-12 監査): `!` アサーションを fail-fast 検証に置換
  // (未設定時に欠落キー名を列挙した明確なエラーで即落とす)。
  const { url, anonKey } = requireSupabaseEnv();
  return createBrowserClient(url, anonKey);
}
