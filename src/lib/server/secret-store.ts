import "server-only";
import { createClient as createSupabaseJsClient } from "@supabase/supabase-js";
import {
  decryptSecret,
  encryptSecret,
  isSecretEncryptionConfigured,
} from "./secret-cipher";

/**
 * Server-only secret store (TODO #35, 2.1).
 *
 * `secrets` テーブルへの read / write を提供。RLS で anon を deny
 * してあるので、SUPABASE_SERVICE_ROLE_KEY 経由の専用 supabase
 * client を使う (RLS をバイパスする superuser 相当)。
 *
 * 旧 `app_settings` 平文保存からの移行戦略:
 *   - `setSecretValue(key, value)` は新 secrets に encrypt 保存
 *   - `getSecretValue(key)` は secrets を見て、無ければ呼び出し側で
 *     `app_settings` plaintext を fallback として読む (各 caller が
 *     その制御を行う)。すべての caller が新書き込みを 1 回行えば
 *     自動的に encrypted に乗り換わる。
 *
 * env が未設定 (SECRET_ENCRYPTION_KEY や SUPABASE_SERVICE_ROLE_KEY)
 * の場合は `null` を返して呼び出し側に fallback させる。throw せず
 * graceful に振る舞うのは、既存環境を壊さないため。
 */

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceKey) return null;
  return createSupabaseJsClient(url, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

/**
 * 暗号化して secrets テーブルに upsert。
 * 失敗時は `false` を返し caller が fallback (app_settings plaintext)
 * を使うか判断できるようにする。
 */
export async function setSecretValue(
  key: string,
  value: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!isSecretEncryptionConfigured()) {
    return { ok: false, reason: "SECRET_ENCRYPTION_KEY 未設定" };
  }
  const client = getServiceClient();
  if (!client) {
    return { ok: false, reason: "SUPABASE_SERVICE_ROLE_KEY 未設定" };
  }
  let encrypted: string;
  try {
    encrypted = await encryptSecret(value);
  } catch (e) {
    return { ok: false, reason: "encrypt failed: " + String(e) };
  }
  const { error } = await client
    .from("secrets")
    .upsert(
      { key, encrypted_value: encrypted, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
  if (error) return { ok: false, reason: error.message };
  return { ok: true };
}

/**
 * secrets から取得して復号。値が無い / 復号失敗 / env 未設定 の場合は
 * `null` を返す。throw しない (caller が plaintext app_settings に
 * fallback できるように)。
 */
export async function getSecretValue(key: string): Promise<string | null> {
  if (!isSecretEncryptionConfigured()) return null;
  const client = getServiceClient();
  if (!client) return null;
  const { data, error } = await client
    .from("secrets")
    .select("encrypted_value")
    .eq("key", key)
    .maybeSingle();
  if (error || !data) return null;
  try {
    return await decryptSecret(data.encrypted_value as string);
  } catch (e) {
    console.warn(`[secret-store] decrypt failed for key=${key}:`, e);
    return null;
  }
}

/**
 * secrets テーブルから削除。env 未設定なら何もしない (false 返し)。
 */
export async function deleteSecretValue(
  key: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const client = getServiceClient();
  if (!client) {
    return { ok: false, reason: "SUPABASE_SERVICE_ROLE_KEY 未設定" };
  }
  const { error } = await client.from("secrets").delete().eq("key", key);
  if (error) return { ok: false, reason: error.message };
  return { ok: true };
}
