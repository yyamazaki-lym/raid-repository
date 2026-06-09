import "server-only";
import { createClient } from "@/lib/supabase/server";
import { dbError } from "@/lib/server/db-error";
import { fetchAppSetting } from "@/lib/supabase/app-settings";
import {
  deleteSecretValue,
  getSecretValue,
  setSecretValue,
} from "./secret-store";

/**
 * FFLogs v2 OAuth (Authorization Code Flow) helpers.
 *
 * Flow:
 *   1. User clicks "Connect FFLogs" → /api/auth/fflogs/start (admin only)
 *   2. Server builds authorize URL + sets `fflogs_oauth_state` HttpOnly
 *      cookie → redirect to FFLogs
 *   3. User authorizes on fflogs.com → redirected to
 *      /api/auth/fflogs/callback?code=...&state=...
 *   4. Server validates state against the cookie, exchanges code for
 *      tokens, stores access/refresh in encrypted `secrets` table
 *      and expires_at/user_name in `app_settings`
 *   5. User redirected back to app
 *
 * Token usage:
 *   `getValidFflogsOAuthToken()` reads stored tokens; if expired,
 *   refreshes via the refresh_token; returns a valid access token
 *   (or null if not connected / refresh failed).
 *
 * Required env vars (server-side):
 *   - FFLOGS_OAUTH_CLIENT_ID
 *   - FFLOGS_OAUTH_CLIENT_SECRET
 *   - SECRET_ENCRYPTION_KEY  (2.x で必須化)
 *   - SUPABASE_SERVICE_ROLE_KEY  (secrets テーブル書き込みに必須)
 *
 * The redirect URI is built from the request origin at runtime so the
 * same code works for localhost dev and Vercel production. Make sure
 * BOTH are registered in the FFLogs OAuth app's allowed redirect URIs:
 *   - http://localhost:3000/api/auth/fflogs/callback
 *   - https://<your-prod-host>/api/auth/fflogs/callback
 *
 * SECURITY history:
 * - TODO #35 (2.1): access_token / refresh_token を `secrets` (AES-256-GCM)
 *   に保存。旧 `app_settings` plaintext は読み取り fallback として残置。
 * - 2.x (2026-06-09): plaintext fallback を完全撤去。`SECRET_ENCRYPTION_KEY`
 *   未設定だと `app_settings` の anon SELECT (全開) 経由で token が漏れる
 *   リスクがあったため、暗号化保存が成立しないなら早期失敗 (fail-closed)
 *   に変更。state もここでは扱わず callback 側で cookie と照合する。
 */

export const OAUTH_AUTHORIZE_URL = "https://www.fflogs.com/oauth/authorize";
export const OAUTH_TOKEN_URL = "https://www.fflogs.com/oauth/token";
/**
 * Scope: `view-user-profile` lets us read the user's profile data and
 * private reports they own. FFLogs v2 OAuth scopes are documented at
 * https://articles.fflogs.com/articles/help/api-documentation/
 */
export const OAUTH_SCOPE = "view-user-profile";

const KEY_ACCESS = "fflogs_oauth_access_token";
const KEY_REFRESH = "fflogs_oauth_refresh_token";
const KEY_EXPIRES = "fflogs_oauth_expires_at";
const KEY_USER_NAME = "fflogs_oauth_user_name";

export type OAuthTokens = {
  accessToken: string;
  refreshToken: string;
  /** ISO timestamp when the access token expires. */
  expiresAt: string;
};

/** Read the OAuth client credentials from env (server-only). */
function getOAuthClientCreds():
  | { clientId: string; clientSecret: string }
  | null {
  const clientId = process.env.FFLOGS_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.FFLOGS_OAUTH_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

/**
 * Build the authorization URL the user is redirected to. The `state`
 * is a random per-request token; the caller is expected to persist it
 * (now: HttpOnly cookie at /api/auth/fflogs/start) and compare it on
 * callback to defend against CSRF.
 *
 * 2.x (2026-06-09): state を `app_settings` に書く処理を撤去。callback
 * 側で cookie と照合する設計に変更したため、ここでは state を生成して
 * 返すだけで永続化はしない。
 */
export async function buildAuthorizeUrl(
  redirectUri: string,
): Promise<{ ok: true; url: string; state: string } | { ok: false; reason: string }> {
  const creds = getOAuthClientCreds();
  if (!creds) {
    return {
      ok: false,
      reason:
        "OAuth クライアント未設定 — fflogs.com/api/clients/ で OAuth クライアントを作成し、Vercel の環境変数 FFLOGS_OAUTH_CLIENT_ID / FFLOGS_OAUTH_CLIENT_SECRET に設定して redeploy してください",
    };
  }
  // Use Web Crypto for a random state. 32 bytes → 64 hex chars.
  const stateBytes = new Uint8Array(32);
  crypto.getRandomValues(stateBytes);
  const state = Array.from(stateBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const url = new URL(OAUTH_AUTHORIZE_URL);
  url.searchParams.set("client_id", creds.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  url.searchParams.set("scope", OAUTH_SCOPE);
  return { ok: true, url: url.toString(), state };
}

/**
 * Exchange the auth code for access + refresh tokens.
 *
 * 2.x (2026-06-09): state 検証は callback route 側で cookie と照合する
 * 形に分離。本関数は code → token の交換と保存だけを担当する。
 */
export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string,
): Promise<{ ok: true; tokens: OAuthTokens } | { ok: false; reason: string }> {
  const creds = getOAuthClientCreds();
  if (!creds) {
    return {
      ok: false,
      reason:
        "OAuth クライアント未設定 — Vercel の環境変数 FFLOGS_OAUTH_CLIENT_ID / FFLOGS_OAUTH_CLIENT_SECRET を設定して redeploy してください",
    };
  }

  // FFLogs requires HTTP Basic auth on the token endpoint (body-form
  // credentials returned `invalid_client` in the wild). Switch to the
  // Authorization: Basic <base64(id:secret)> header form which is the
  // strict OAuth 2.0 spec preference.
  // 1.9 (2026-04-28) TODO #11: Edge Runtime 化のため Buffer.from を
  // btoa (web 標準) に置換。Node でも Edge でも動く。
  const basicAuth = btoa(`${creds.clientId}:${creds.clientSecret}`);
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });
  try {
    const res = await fetch(OAUTH_TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: body.toString(),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      // 401 invalid_client almost always means the OAuth client is
      // configured as Public (no secret) but we're sending one, OR
      // the credentials are wrong. Surface a hint.
      if (
        res.status === 401 ||
        /invalid_client/i.test(text)
      ) {
        return {
          ok: false,
          reason:
            "OAuth クライアント認証失敗 — fflogs.com/api/clients/ で client_id / client_secret が正しいか、Public Client にチェックが入っていないかを確認してください",
        };
      }
      // 2.x (2026-06-09): エラー詳細は console.warn 経由でログのみに出し、
      // ユーザー向け reason には HTTP status と既知パターンのみ載せる
      // (URL に echo されたとき制御文字 / token 様文字列が漏れない)。
      console.warn("[fflogs-oauth] token exchange error", {
        status: res.status,
        bodyPreview: text.slice(0, 200),
      });
      return {
        ok: false,
        reason: `token 交換失敗 (HTTP ${res.status}) — Vercel ログで詳細を確認してください`,
      };
    }
    const data = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      token_type?: string;
    };
    if (!data.access_token || !data.refresh_token || !data.expires_in) {
      return {
        ok: false,
        reason: "token レスポンスが想定外の形式です",
      };
    }
    const expiresAt = new Date(
      Date.now() + data.expires_in * 1000,
    ).toISOString();
    const tokens: OAuthTokens = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt,
    };
    const persisted = await persistTokens(tokens);
    if (!persisted.ok) {
      return { ok: false, reason: persisted.reason };
    }
    // Best-effort: fetch the connected user's name for the UI badge.
    await fetchAndPersistUserName(tokens.accessToken);
    return { ok: true, tokens };
  } catch (e) {
    return { ok: false, reason: "fetch error: " + String(e) };
  }
}

/**
 * Use refresh_token to get a new access_token. Persists the new tokens
 * via `persistTokens` (encrypted `secrets` only). Returns null on
 * failure (caller should treat as not connected).
 */
async function refreshTokens(
  refreshToken: string,
): Promise<OAuthTokens | null> {
  const creds = getOAuthClientCreds();
  if (!creds) return null;
  // Same Basic-Auth pattern as the code-exchange path — FFLogs's
  // token endpoint rejects body-form credentials with invalid_client.
  // 1.9 (2026-04-28) TODO #11: Edge Runtime 化のため Buffer.from を
  // btoa (web 標準) に置換。Node でも Edge でも動く。
  const basicAuth = btoa(`${creds.clientId}:${creds.clientSecret}`);
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  try {
    const res = await fetch(OAUTH_TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: body.toString(),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      console.warn("[fflogs-oauth] refresh failed:", res.status);
      return null;
    }
    const data = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
    if (!data.access_token || !data.expires_in) return null;
    const tokens: OAuthTokens = {
      accessToken: data.access_token,
      // Some OAuth servers rotate refresh tokens; reuse the old one if
      // not provided.
      refreshToken: data.refresh_token ?? refreshToken,
      expiresAt: new Date(Date.now() + data.expires_in * 1000).toISOString(),
    };
    const persisted = await persistTokens(tokens);
    if (!persisted.ok) {
      console.warn("[fflogs-oauth] refresh persist failed:", persisted.reason);
      return null;
    }
    return tokens;
  } catch (e) {
    console.warn("[fflogs-oauth] refresh exception:", e);
    return null;
  }
}

/**
 * Read stored tokens and refresh if within 60 seconds of expiry.
 *
 * 2.x (2026-06-09): `app_settings` 平文 fallback を撤去。`secrets`
 * テーブル (暗号化) のみを参照する。`SECRET_ENCRYPTION_KEY` 未設定 /
 * service role 未設定 などで `getSecretValue` が null を返す環境では
 * 接続なし扱いになる。
 */
export async function getValidFflogsOAuthToken(): Promise<string | null> {
  const [accessToken, refreshToken, expiresAtStr] = await Promise.all([
    getSecretValue(KEY_ACCESS),
    getSecretValue(KEY_REFRESH),
    fetchAppSetting(KEY_EXPIRES),
  ]);
  if (!accessToken || !refreshToken || !expiresAtStr) return null;
  const expiresAt = new Date(expiresAtStr).getTime();
  if (Number.isNaN(expiresAt)) return null;
  // Refresh slightly before expiry to avoid mid-request token expiration.
  if (Date.now() < expiresAt - 60_000) {
    return accessToken;
  }
  const refreshed = await refreshTokens(refreshToken);
  return refreshed?.accessToken ?? null;
}

/**
 * Returns connection metadata for the settings UI.
 *
 * 2.x (2026-06-09): plaintext fallback 撤去。access token は `secrets`
 * のみを見る。
 */
export async function getFflogsOAuthStatus(): Promise<{
  connected: boolean;
  userName: string | null;
  expiresAt: string | null;
}> {
  // Idempotent cleanup of legacy v1 setting — removed in 1.7.3 but
  // existing deployments may still have the row. Drops it on every
  // settings-dialog open until gone.
  try {
    const supabase = await createClient();
    await supabase.from("app_settings").delete().eq("key", "fflogs_username");
  } catch {
    // best-effort
  }
  const [accessToken, userName, expiresAt] = await Promise.all([
    getSecretValue(KEY_ACCESS),
    fetchAppSetting(KEY_USER_NAME),
    fetchAppSetting(KEY_EXPIRES),
  ]);
  return {
    connected: Boolean(accessToken),
    userName: userName ?? null,
    expiresAt: expiresAt ?? null,
  };
}

/**
 * Disconnect — clears all OAuth state from app_settings + secrets.
 *
 * 2.x (2026-06-09): 旧 `KEY_STATE_PENDING` は廃止 (cookie 化) のため
 * 削除リストから外し、念のため legacy plaintext token も全て掃く。
 */
export async function disconnectFflogsOAuth(): Promise<{
  ok: true;
} | { ok: false; reason: string }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("app_settings")
    .delete()
    .in("key", [
      KEY_ACCESS, // legacy plaintext (2.x で書き込みは行われないが旧行を掃く)
      KEY_REFRESH, // legacy plaintext
      KEY_EXPIRES,
      KEY_USER_NAME,
      // 旧 state key (2.x で cookie 化により書かれなくなったが残ってる可能性)
      "fflogs_oauth_state_pending",
    ]);
  if (error) return { ok: false, reason: dbError("FFLogs 連携解除", error) };
  // 新 secrets テーブルからも消す (best-effort)。
  await deleteSecretValue(KEY_ACCESS);
  await deleteSecretValue(KEY_REFRESH);
  return { ok: true };
}

/**
 * 暗号化 `secrets` テーブルに access / refresh token を書き込む。
 * `expires_at` だけは機密度が低いため `app_settings` (平文) に残す。
 *
 * 2.x (2026-06-09): 旧 `app_settings` 平文 fallback を撤去し、暗号化
 * 保存が成立しなければ caller にエラーを返す (fail-closed)。fork が
 * `SECRET_ENCRYPTION_KEY` / `SUPABASE_SERVICE_ROLE_KEY` を設定し忘れた
 * まま OAuth を完走しても平文で token が漏れない。
 */
async function persistTokens(
  tokens: OAuthTokens,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const accessRes = await setSecretValue(KEY_ACCESS, tokens.accessToken);
  if (!accessRes.ok) {
    return {
      ok: false,
      reason:
        "FFLogs access_token を暗号化保存できませんでした: " +
        accessRes.reason +
        " (SECRET_ENCRYPTION_KEY と SUPABASE_SERVICE_ROLE_KEY を Vercel の env に設定してから再連携してください)",
    };
  }
  const refreshRes = await setSecretValue(KEY_REFRESH, tokens.refreshToken);
  if (!refreshRes.ok) {
    return {
      ok: false,
      reason:
        "FFLogs refresh_token を暗号化保存できませんでした: " +
        refreshRes.reason,
    };
  }
  const supabase = await createClient();
  await supabase.from("app_settings").upsert(
    [{ key: KEY_EXPIRES, value: tokens.expiresAt }],
    { onConflict: "key" },
  );
  // 旧 plaintext 行が残っていれば idempotent に掃く (1 回限りの自動移行)。
  await supabase
    .from("app_settings")
    .delete()
    .in("key", [KEY_ACCESS, KEY_REFRESH]);
  return { ok: true };
}

/**
 * After connecting, query the GraphQL endpoint for the user's display
 * name and persist it for the settings UI badge.
 */
async function fetchAndPersistUserName(accessToken: string): Promise<void> {
  try {
    const res = await fetch("https://www.fflogs.com/api/v2/user", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        query: `query { userData { currentUser { id name } } }`,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return;
    const json = (await res.json()) as {
      data?: {
        userData?: { currentUser?: { id?: number; name?: string } };
      };
    };
    const name = json.data?.userData?.currentUser?.name;
    if (!name) return;
    const supabase = await createClient();
    await supabase
      .from("app_settings")
      .upsert(
        { key: KEY_USER_NAME, value: name },
        { onConflict: "key" },
      );
  } catch {
    // best-effort
  }
}

/**
 * Build the absolute callback URL from a request's origin. Used by
 * both the start and callback routes so the redirect_uri value is
 * identical (FFLogs requires exact match).
 */
export function buildRedirectUri(origin: string): string {
  return `${origin.replace(/\/$/, "")}/api/auth/fflogs/callback`;
}
