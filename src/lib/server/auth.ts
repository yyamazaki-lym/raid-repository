import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Server Component / Server Action / Route Handler から auth を強制する
 * ためのヘルパー。
 *
 * proxy.ts でサイト全体を gate しているが、Next.js 16 docs の警告どおり
 * (`proxy.md` の "Execution order" セクション)、Server Function は POST
 * リクエストとして扱われ matcher 変更で silent にカバレッジが外れる
 * 可能性があるので、書き込み系の Server Action / Route Handler では
 * 明示的にこの関数を呼ぶこと (defense-in-depth)。
 *
 * 認可不足時は `redirect()` を投げる (= Server Action からは throw 経由で
 * 親 layout の error.tsx で握られる)。Route Handler の場合は手動で
 * NextResponse.redirect を return しても良い。
 */

export type DiscordAppMetadata = {
  discord_id?: string;
  discord_guild_member?: boolean;
  discord_roles?: string[];
  discord_member_verified_at?: string;
};

export type AuthorizedUser = {
  userId: string;
  discordId: string;
  roles: string[];
};

export async function requireDiscordMember(): Promise<AuthorizedUser> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const meta = (user.app_metadata ?? {}) as DiscordAppMetadata;
  if (meta.discord_guild_member !== true || !meta.discord_id) {
    redirect("/auth/denied");
  }

  return {
    userId: user.id,
    discordId: meta.discord_id,
    roles: meta.discord_roles ?? [],
  };
}

/**
 * 指定ロールのいずれか 1 つでも持っていれば通す ("any" 判定)。
 * 「ロール ID = サーバー内チャンネル/カテゴリの可視性」を表現する想定で、
 * 例えば `requireDiscordRoles(['<role-id-A>', '<role-id-B>'])` のように使う。
 *
 * 「全ロール必須」が要るときは `requireDiscordRolesAll` を別途追加すること。
 */
export async function requireDiscordRoles(
  allowedRoleIds: string[],
): Promise<AuthorizedUser> {
  const authed = await requireDiscordMember();
  if (allowedRoleIds.length === 0) return authed;
  const has = allowedRoleIds.some((r) => authed.roles.includes(r));
  if (!has) redirect("/auth/denied?reason=missing_role");
  return authed;
}
