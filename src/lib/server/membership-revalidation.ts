import "server-only";
import { fetchGuildMember, updateUserAppMetadata } from "./discord-membership";
import { userIsAdmin } from "./admin-roles";

/**
 * Discord メンバーシップ / admin ロールの **定期再検証** (2026-08-05 監査 H-1)。
 *
 * ## 直した問題
 *
 * `discord_guild_member` / `discord_roles` / `is_admin` を書くのは
 * `/auth/callback` ただ一箇所で、以後 proxy も `requireDiscordMember()` も
 * JWT 内 `app_metadata` を読むだけだった。callback が書いていた
 * `discord_member_verified_at` はコード中どこからも読まれておらず、TTL 判定が
 * 存在しなかった。
 *
 * 結果、Discord 側で kick / admin ロール剥奪をしても `auth.users.app_metadata`
 * は不変のまま、refresh のたびに同じ claim を載せた JWT が再発行され、
 *   1. proxy.ts の gate
 *   2. requireDiscordMember()
 *   3. assertAdminResult()
 *   4. RLS の auth.jwt()->'app_metadata'->>'is_admin'
 * の 4 層すべてを通過し続けた。元 admin は公開 anon key + 自分の JWT で
 * PostgREST を直叩きして CASCADE 削除まで実行できた。
 *
 * ## 方針
 *
 * - **soft TTL 超過**で Discord へ再問い合わせ → app_metadata を書き戻す。
 *   proxy 側から呼ぶので `refreshSession()` で JWT (= RLS の claim) も
 *   同一リクエスト中に更新できる。
 * - **not_in_guild は即時失効**。kick された利用者はその場でサインアウト。
 * - **Discord 側の一時障害 (discord_error / missing_config) では落とさない**。
 *   `verified_at` を更新しないので次リクエストで再試行される。ただし
 *   **hard TTL** を超えてなお検証できない場合は fail-closed で失効させる
 *   (障害を装って無期限に居座られるのを防ぐ)。
 *
 * TTL は env で上書きできる。既定は soft 6h / hard 72h。
 */

const DEFAULT_SOFT_TTL_MS = 6 * 60 * 60 * 1000; // 6h
const DEFAULT_HARD_TTL_MS = 72 * 60 * 60 * 1000; // 72h

function envMs(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function membershipSoftTtlMs(): number {
  return envMs("DISCORD_MEMBERSHIP_TTL_MS", DEFAULT_SOFT_TTL_MS);
}

export function membershipHardTtlMs(): number {
  const soft = membershipSoftTtlMs();
  const hard = envMs("DISCORD_MEMBERSHIP_HARD_TTL_MS", DEFAULT_HARD_TTL_MS);
  // hard < soft の設定ミスで常時失効しないよう下限を soft に合わせる。
  return Math.max(hard, soft);
}

export type MembershipClaims = {
  discord_id?: string;
  discord_guild_member?: boolean;
  discord_roles?: string[];
  discord_member_verified_at?: string;
  is_admin?: boolean;
};

/** `verified_at` からの経過ミリ秒。未設定 / 壊れた値は Infinity 扱い。 */
export function membershipAgeMs(claims: MembershipClaims, now: number): number {
  const verifiedAt = Date.parse(claims.discord_member_verified_at ?? "");
  if (!Number.isFinite(verifiedAt)) return Number.POSITIVE_INFINITY;
  // 時計ずれで未来日が入っていても «新鮮» 側に倒す (負値を 0 に丸める)。
  return Math.max(0, now - verifiedAt);
}

export type RevalidationOutcome =
  /** TTL 内。何もしていない。 */
  | { status: "fresh" }
  /** 再検証して app_metadata を更新した。JWT の refresh が必要。 */
  | { status: "refreshed"; roles: string[]; isAdmin: boolean }
  /** guild から外れている / hard TTL 超過。セッションを失効させること。 */
  | { status: "revoked"; reason: "not_in_guild" | "stale_unverifiable" }
  /** Discord 側の一時障害。今回は通すが verified_at は据え置き。 */
  | { status: "deferred"; reason: string };

/**
 * claims の鮮度を見て、必要なら Discord へ再問い合わせし app_metadata を
 * 書き戻す。**cookie は触らない** ので、呼び出し側が `refreshSession()` /
 * `signOut()` を実行すること (cookie を書ける文脈でのみ呼ぶ想定)。
 */
export async function revalidateMembership(
  userId: string,
  claims: MembershipClaims,
  now: number = Date.now(),
): Promise<RevalidationOutcome> {
  const discordId = claims.discord_id;
  if (!discordId) {
    // discord_id が無い = callback を通っていない不正な状態。
    return { status: "revoked", reason: "not_in_guild" };
  }

  const age = membershipAgeMs(claims, now);
  if (age < membershipSoftTtlMs()) return { status: "fresh" };

  const membership = await fetchGuildMember(discordId);

  if (!membership.ok) {
    if (membership.reason === "not_in_guild") {
      return { status: "revoked", reason: "not_in_guild" };
    }
    // discord_error / missing_config = 検証不能。hard TTL までは通す。
    if (age >= membershipHardTtlMs()) {
      return { status: "revoked", reason: "stale_unverifiable" };
    }
    return { status: "deferred", reason: membership.reason };
  }

  const isAdmin = userIsAdmin(membership.roles);
  try {
    await updateUserAppMetadata(userId, {
      discord_id: discordId,
      discord_guild_member: true,
      discord_roles: membership.roles,
      discord_member_verified_at: new Date(now).toISOString(),
      is_admin: isAdmin,
    });
  } catch (e) {
    console.error("[membership] app_metadata の更新に失敗", e);
    // 書き戻せなかった場合も hard TTL までは通す (Supabase 側の一時障害)。
    if (age >= membershipHardTtlMs()) {
      return { status: "revoked", reason: "stale_unverifiable" };
    }
    return { status: "deferred", reason: "metadata_write_failed" };
  }

  return { status: "refreshed", roles: membership.roles, isAdmin };
}
