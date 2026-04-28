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
  allowedRoleIds: readonly string[],
): Promise<AuthorizedUser> {
  const authed = await requireDiscordMember();
  if (allowedRoleIds.length === 0) return authed;
  const has = allowedRoleIds.some((r) => authed.roles.includes(r));
  if (!has) redirect("/auth/denied?reason=missing_role");
  return authed;
}

/**
 * 認証は要求するが拒否はせず、ユーザの roles を返すだけのヘルパー。
 * 各種「カテゴリ一覧のうち、見える分だけフィルタする」用途で使う想定。
 *
 * proxy.ts でゲート済みなので user は必ず存在するが、念のため未認証で
 * 呼ばれた場合は redirect する (= ここに来る前に proxy で弾かれている
 * はずなのであくまで安全網)。
 */
export async function getAuthorizedUserRoles(): Promise<string[]> {
  const { roles } = await requireDiscordMember();
  return roles;
}

// =============================================================
// Admin gating (TODO #21, 2.1)
// =============================================================
//
// `DISCORD_ADMIN_ROLE_IDS` env (カンマ区切り role ID) で「管理者ロール」を
// 定義し、カテゴリの create / update / delete をそのロール持ちのみに制限
// する。env 未設定 = 旧挙動 (全 guild メンバー編集可) — 既存デプロイの
// 後方互換のため fail-open。本番は env を設定してロックダウンすべき。
//
// UI 側は `getCurrentUserCanEdit()` で sync 状態をフェッチし、編集 UI
// を非 admin に対して隠す。Server Action 側は `requireAdmin()` (ハード)
// もしくは `assertAdminResult()` (ソフト = エラーオブジェクト返却) で
// 防御する。

/** env からカンマ区切りで admin role ID 一覧を取り出す。trim + 空除去。 */
export function getAdminRoleIds(): string[] {
  const raw = process.env.DISCORD_ADMIN_ROLE_IDS?.trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * ユーザが admin かどうか。env 未設定なら true (= 全員 admin、
 * 後方互換)。設定済みなら user roles と admin role IDs の交差で判定。
 */
export function userIsAdmin(userRoleIds: readonly string[]): boolean {
  const adminIds = getAdminRoleIds();
  if (adminIds.length === 0) return true; // backward-compat
  return adminIds.some((id) => userRoleIds.includes(id));
}

/**
 * 現在のユーザが編集可能かを返す (UI から「ボタン出すか」判定する用途)。
 * `requireDiscordMember()` を経由するので未ログイン / 非メンバーは
 * /login や /auth/denied にリダイレクトされる。
 */
export async function getCurrentUserCanEdit(): Promise<boolean> {
  const { roles } = await requireDiscordMember();
  return userIsAdmin(roles);
}

/**
 * 編集系 Server Action / Route Handler の入口で呼ぶハードガード。
 * 非 admin は /auth/denied?reason=not_admin にリダイレクト。
 */
export async function requireAdmin(): Promise<AuthorizedUser> {
  const authed = await requireDiscordMember();
  if (!userIsAdmin(authed.roles)) {
    redirect("/auth/denied?reason=not_admin");
  }
  return authed;
}

/**
 * Server Action で「リダイレクトせず toast でエラーを出したい」用途。
 * 結果が `{ ok: false, reason: "not_admin" }` で返る。
 */
export async function assertAdminResult(): Promise<
  { ok: true; user: AuthorizedUser } | { ok: false; reason: "not_admin" }
> {
  const authed = await requireDiscordMember();
  if (!userIsAdmin(authed.roles)) {
    return { ok: false, reason: "not_admin" };
  }
  return { ok: true, user: authed };
}
