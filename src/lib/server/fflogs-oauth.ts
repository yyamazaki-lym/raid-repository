import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchAppSetting } from "@/lib/supabase/app-settings";

/**
 * FFLogs v2 OAuth (Authorization Code Flow) helpers.
 *
 * Flow:
 *   1. User clicks "Connect FFLogs" → /api/auth/fflogs/start
 *   2. Server builds authorize URL + sets state cookie → redirect
 *   3. User authorizes on fflogs.com → redirected to
 *      /api/auth/fflogs/callback?code=...&state=...
 *   4. Server validates state cookie, exchanges code for tokens,
 *      stores in `app_settings` keyed under `fflogs_oauth_*`
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
 *
 * The redirect URI is built from the request origin at runtime so the
 * same code works for localhost dev and Vercel production. Make sure
 * BOTH are registered in the FFLogs OAuth app's allowed redirect URIs:
 *   - http://localhost:3000/api/auth/fflogs/callback
 *   - https://<your-prod-host>/api/auth/fflogs/callback
 *
 * SECURITY NOTE: tokens are stored in `app_settings` which has open
 * RLS for `anon`. For a small private固定 this is acceptable (members
 * trust each other), but if you intend to expand access, lock the
 * `fflogs_oauth_*` keys behind a stricter RLS policy.
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
/** Random state value persisted to app_settings for CSRF check on callback. */
const KEY_STATE_PENDING = "fflogs_oauth_state_pending";

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
 * is a random per-request token that we also persist server-side and
 * compare on callback to defend against CSRF.
 */
export async function buildAuthorizeUrl(
  redirectUri: string,
): Promise<{ ok: true; url: string; state: string } | { ok: false; reason: string }> {
  const creds = getOAuthClientCreds();
  if (!creds) {
    return {
      ok: false,
      reason:
        "FFLOGS_OAUTH_CLIENT_ID / FFLOGS_OAUTH_CLIENT_SECRET 環境変数が未設定です",
    };
  }
  // Use Web Crypto for a random state. 32 bytes → 64 hex chars.
  const stateBytes = new Uint8Array(32);
  crypto.getRandomValues(stateBytes);
  const state = Array.from(stateBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  // Persist state for callback verification (single in-flight handshake
  // per app instance is fine for our scale).
  const supabase = await createClient();
  const { error } = await supabase
    .from("app_settings")
    .upsert(
      { key: KEY_STATE_PENDING, value: state },
      { onConflict: "key" },
    );
  if (error) return { ok: false, reason: "state 保存失敗: " + error.message };

  const url = new URL(OAUTH_AUTHORIZE_URL);
  url.searchParams.set("client_id", creds.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  url.searchParams.set("scope", OAUTH_SCOPE);
  return { ok: true, url: url.toString(), state };
}

/**
 * Exchange the auth code for access + refresh tokens. Validates the
 * state cookie before calling FFLogs.
 */
export async function exchangeCodeForTokens(
  code: string,
  state: string,
  redirectUri: string,
): Promise<{ ok: true; tokens: OAuthTokens } | { ok: false; reason: string }> {
  const creds = getOAuthClientCreds();
  if (!creds) {
    return {
      ok: false,
      reason:
        "FFLOGS_OAUTH_CLIENT_ID / FFLOGS_OAUTH_CLIENT_SECRET 環境変数が未設定です",
    };
  }
  // Verify state matches what we issued.
  const expectedState = await fetchAppSetting(KEY_STATE_PENDING);
  if (!expectedState || expectedState !== state) {
    return {
      ok: false,
      reason: "OAuth state が一致しません — リクエストが改ざんされた可能性",
    };
  }
  // Clear the state immediately (one-time use).
  const supabase = await createClient();
  await supabase.from("app_settings").delete().eq("key", KEY_STATE_PENDING);

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
  });
  try {
    const res = await fetch(OAUTH_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: body.toString(),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        ok: false,
        reason: `token 交換失敗 (${res.status}): ${text.slice(0, 200)}`,
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
    await persistTokens(tokens);
    // Best-effort: fetch the connected user's name for the UI badge.
    await fetchAndPersistUserName(tokens.accessToken);
    return { ok: true, tokens };
  } catch (e) {
    return { ok: false, reason: "fetch error: " + String(e) };
  }
}

/**
 * Use refresh_token to get a new access_token. Updates app_settings
 * in-place. Returns null on failure (caller should treat as not
 * connected).
 */
async function refreshTokens(
  refreshToken: string,
): Promise<OAuthTokens | null> {
  const creds = getOAuthClientCreds();
  if (!creds) return null;
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
  });
  try {
    const res = await fetch(OAUTH_TOKEN_URL, {
      method: "POST",
      headers: {
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
    await persistTokens(tokens);
    return tokens;
  } catch (e) {
    console.warn("[fflogs-oauth] refresh exception:", e);
    return null;
  }
}

/** Read stored tokens and refresh if within 60 seconds of expiry. */
export async function getValidFflogsOAuthToken(): Promise<string | null> {
  const [accessToken, refreshToken, expiresAtStr] = await Promise.all([
    fetchAppSetting(KEY_ACCESS),
    fetchAppSetting(KEY_REFRESH),
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

/** Returns connection metadata for the settings UI. */
export async function getFflogsOAuthStatus(): Promise<{
  connected: boolean;
  userName: string | null;
  expiresAt: string | null;
}> {
  const [accessToken, userName, expiresAt] = await Promise.all([
    fetchAppSetting(KEY_ACCESS),
    fetchAppSetting(KEY_USER_NAME),
    fetchAppSetting(KEY_EXPIRES),
  ]);
  return {
    connected: Boolean(accessToken),
    userName: userName ?? null,
    expiresAt: expiresAt ?? null,
  };
}

/** Disconnect — clears all OAuth state from app_settings. */
export async function disconnectFflogsOAuth(): Promise<{
  ok: true;
} | { ok: false; reason: string }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("app_settings")
    .delete()
    .in("key", [
      KEY_ACCESS,
      KEY_REFRESH,
      KEY_EXPIRES,
      KEY_USER_NAME,
      KEY_STATE_PENDING,
    ]);
  if (error) return { ok: false, reason: error.message };
  return { ok: true };
}

async function persistTokens(tokens: OAuthTokens): Promise<void> {
  const supabase = await createClient();
  await supabase.from("app_settings").upsert(
    [
      { key: KEY_ACCESS, value: tokens.accessToken },
      { key: KEY_REFRESH, value: tokens.refreshToken },
      { key: KEY_EXPIRES, value: tokens.expiresAt },
    ],
    { onConflict: "key" },
  );
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
