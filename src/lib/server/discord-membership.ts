import "server-only";

/**
 * Discord guild メンバーシップを bot token で検証し、結果を Supabase
 * の `auth.users.app_metadata` に書き込むためのユーティリティ。
 *
 * - メンバーシップ判定は **bot token** で `GET /guilds/{id}/members/{user_id}`
 *   を叩く方式。ユーザーの OAuth access_token (provider_token) には依存
 *   しないので、Supabase 側で Discord トークンを保管する設定が無くても
 *   動く。bot は対象 guild に join 済み + `View Server Members` 相当の
 *   intent を持っている必要がある。
 *
 * - app_metadata は service-role key でしか書き換えられないので、
 *   Supabase REST Admin API (`PUT /auth/v1/admin/users/{user_id}`) を
 *   使う。`SUPABASE_SERVICE_ROLE_KEY` がブラウザに漏れないように、
 *   このファイルは `server-only` を import している。
 */

const DISCORD_API = "https://discord.com/api/v10";

export type GuildMembership =
  | { ok: true; roles: string[] }
  | {
      ok: false;
      reason: "missing_config" | "not_in_guild" | "discord_error";
      detail?: string;
    };

export async function fetchGuildMember(
  discordUserId: string,
): Promise<GuildMembership> {
  const botToken = process.env.DISCORD_BOT_TOKEN?.trim();
  const guildId = process.env.DISCORD_GUILD_ID?.trim();
  if (!botToken || !guildId) {
    return { ok: false, reason: "missing_config" };
  }

  const res = await fetch(
    `${DISCORD_API}/guilds/${guildId}/members/${discordUserId}`,
    {
      headers: { Authorization: `Bot ${botToken}` },
      cache: "no-store",
    },
  );

  if (res.status === 404) {
    return { ok: false, reason: "not_in_guild" };
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return { ok: false, reason: "discord_error", detail: detail.slice(0, 500) };
  }

  const data = (await res.json()) as { roles?: string[] };
  return { ok: true, roles: Array.isArray(data.roles) ? data.roles : [] };
}

export type AppMetadataUpdate = {
  discord_id: string;
  discord_guild_member: boolean;
  discord_roles: string[];
  discord_member_verified_at: string;
  /**
   * TODO #36 phase 2 (2.1+): admin かどうかの計算結果を JWT に同梱
   * させて、Postgres RLS から `auth.jwt()->'app_metadata'->>'is_admin'`
   * で参照できるようにする。`getAdminRoleIds()` の結果と `discord_roles`
   * の交差で計算する (auth.ts の userIsAdmin と同じロジック)。
   * 環境変数 `DISCORD_ADMIN_ROLE_IDS` 未設定時は backward compat で
   * `true` (= 全員 admin) を入れる。
   */
  is_admin: boolean;
};

/**
 * `auth.users.app_metadata` を service-role で更新する。
 * 既存の app_metadata はマージされず**完全置換**になる点に注意 (Supabase
 * Admin API の仕様。ここでは Discord 関連のキーしか積んでいないので問題
 * ないが、別目的の app_metadata を足す場合は GET → merge → PUT に変える
 * 必要がある)。
 */
export async function updateUserAppMetadata(
  userId: string,
  appMetadata: AppMetadataUpdate,
): Promise<void> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_URL が未設定",
    );
  }

  const res = await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
    method: "PUT",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ app_metadata: appMetadata }),
    cache: "no-store",
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `Supabase admin update failed (${res.status}): ${detail.slice(0, 500)}`,
    );
  }
}
