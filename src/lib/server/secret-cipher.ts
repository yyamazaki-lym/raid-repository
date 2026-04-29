import "server-only";

/**
 * AES-256-GCM 暗号化ヘルパー (TODO #35, 2.1)。
 *
 * `secrets` テーブルに格納する value を暗号化/復号する。鍵は env
 * `SECRET_ENCRYPTION_KEY` (32 bytes / 64 hex chars)。本番環境では
 * Vercel の Environment Variables に登録、ローカル開発では
 * `.env.local` に書く。鍵生成は `openssl rand -hex 32`。
 *
 * 形式: `iv_b64:tag_b64:ciphertext_b64` (3 つを `:` 区切り)
 *   - iv: 12 バイト (GCM 推奨長)
 *   - tag: 16 バイト (GCM 認証タグ。Web Crypto では ciphertext の
 *     末尾 16 バイトとして自動付与されるが、storage の見やすさで
 *     明示的に分離して保存する)
 *   - ciphertext: 平文と同じバイト数
 *
 * Edge Runtime 互換のため Web Crypto API (`globalThis.crypto.subtle`)
 * を使用。Node.js の `node:crypto` は proxy.ts (Edge runtime) 経由で
 * 評価されるパスでは動かない。Node 16+ / Edge / Vercel すべてで
 * Web Crypto は利用可能。
 *
 * 鍵が変わると過去の encrypted 値は復号できなくなる。鍵 rotation を
 * 将来サポートする場合は version prefix を追加する設計に拡張。
 */

const ALGORITHM = "AES-GCM";
const IV_LENGTH_BYTES = 12;
const TAG_LENGTH_BITS = 128; // Web Crypto は tag を ciphertext 末尾に付与

let cachedKey: CryptoKey | null = null;
let cachedKeyHex: string | null = null;

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  // btoa は Edge / Node 両方で利用可能
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function getEncryptionKey(): Promise<CryptoKey> {
  const raw = process.env.SECRET_ENCRYPTION_KEY?.trim();
  if (!raw) {
    throw new Error(
      "SECRET_ENCRYPTION_KEY が未設定です。`openssl rand -hex 32` で 32 バイトの鍵を生成して env に設定してください",
    );
  }
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error(
      "SECRET_ENCRYPTION_KEY は 64 文字の hex (= 32 バイト) で指定してください",
    );
  }
  if (cachedKey && cachedKeyHex === raw) return cachedKey;
  const keyBytes = hexToBytes(raw);
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    keyBytes as BufferSource,
    { name: ALGORITHM },
    false, // not extractable
    ["encrypt", "decrypt"],
  );
  cachedKey = key;
  cachedKeyHex = raw;
  return key;
}

/**
 * 平文を暗号化して `iv:tag:ciphertext` (base64) 形式の文字列を返す。
 * 復号時は `decryptSecret()` に同じ文字列を渡す。
 */
export async function encryptSecret(plaintext: string): Promise<string> {
  const key = await getEncryptionKey();
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES));
  const plaintextBytes = new TextEncoder().encode(plaintext);
  const encrypted = new Uint8Array(
    await globalThis.crypto.subtle.encrypt(
      { name: ALGORITHM, iv: iv as BufferSource, tagLength: TAG_LENGTH_BITS },
      key,
      plaintextBytes as BufferSource,
    ),
  );
  // Web Crypto は ciphertext の末尾 16 バイト (= 128 bit) に auth tag を
  // 付与する。storage 形式の都合で iv / tag / ciphertext を別 base64 に
  // 分けて保存。
  const tagBytes = encrypted.slice(encrypted.length - 16);
  const cipherBytes = encrypted.slice(0, encrypted.length - 16);
  return [bytesToBase64(iv), bytesToBase64(tagBytes), bytesToBase64(cipherBytes)].join(
    ":",
  );
}

/**
 * `iv:tag:ciphertext` 形式の文字列を復号して平文を返す。
 * フォーマット不正 / 鍵不一致 / tag 検証失敗の場合は throw する。
 */
export async function decryptSecret(serialized: string): Promise<string> {
  const parts = serialized.split(":");
  if (parts.length !== 3) {
    throw new Error("encrypted_value のフォーマットが不正です");
  }
  const [ivB64, tagB64, dataB64] = parts;
  const iv = base64ToBytes(ivB64!);
  const tag = base64ToBytes(tagB64!);
  const data = base64ToBytes(dataB64!);
  if (iv.length !== IV_LENGTH_BYTES) {
    throw new Error("iv の長さが不正です");
  }
  // Web Crypto に渡す ciphertext は ciphertext + tag を結合した形。
  const combined = new Uint8Array(data.length + tag.length);
  combined.set(data, 0);
  combined.set(tag, data.length);
  const key = await getEncryptionKey();
  const plainBuf = await globalThis.crypto.subtle.decrypt(
    { name: ALGORITHM, iv: iv as BufferSource, tagLength: TAG_LENGTH_BITS },
    key,
    combined as BufferSource,
  );
  return new TextDecoder().decode(plainBuf);
}

/**
 * env が設定されているか判定。未設定なら encrypt/decrypt は throw する
 * ので、呼び出し側で fallback (旧 app_settings 平文) に切替できるよう
 * boolean で返す。
 */
export function isSecretEncryptionConfigured(): boolean {
  const raw = process.env.SECRET_ENCRYPTION_KEY?.trim();
  return Boolean(raw && /^[0-9a-fA-F]{64}$/.test(raw));
}
