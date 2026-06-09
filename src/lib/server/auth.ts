import "server-only";
import { cache } from "react";
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

/**
 * Dev-only bypass 用の擬似 admin ロール ID。
 * `DISCORD_ADMIN_ROLE_IDS` env から独立した固定値にすることで、
 * env 未設定の dev 環境でも admin 視点を再現できるようにする
 * (2.x: userIsAdmin の fail-closed 化対応)。
 */
const DEV_BYPASS_ADMIN_ROLE_ID = "__dev-bypass-admin__";

/**
 * Dev-only bypass: `DEV_AUTH_BYPASS=true` + `NODE_ENV !== "production"`
 * で Discord guild membership チェックを丸ごと skip し、admin ロールを
 * 持つ偽ユーザーを返す。本番ビルドでは NODE_ENV ガードで必ず無効化。
 *
 * 偽ユーザーの roles には固定の擬似 admin role ID (`DEV_BYPASS_ADMIN_ROLE_ID`)
 * を入れる。userIsAdmin はこの ID を見て true を返すよう特例で組まれて
 * いるので、`DISCORD_ADMIN_ROLE_IDS` env の有無に依存せず admin として
 * 振る舞える。non-admin 視点を試したい場合は `DEV_AUTH_BYPASS_NON_ADMIN=true`
 * を追加で立てて roles を空にする。
 */
function devAuthBypassUser(): AuthorizedUser | null {
  if (
    process.env.NODE_ENV === "production" ||
    process.env.DEV_AUTH_BYPASS !== "true"
  ) {
    return null;
  }
  const roles =
    process.env.DEV_AUTH_BYPASS_NON_ADMIN === "true"
      ? []
      : [DEV_BYPASS_ADMIN_ROLE_ID];
  return {
    // Stable fake UUID-ish so any downstream code that keys on userId
    // sees a consistent identity across requests.
    userId: "00000000-0000-0000-0000-000000000dev",
    discordId: "dev-bypass-discord-id",
    roles,
  };
}

/**
 * Public demo mode bypass: `PUBLIC_DEMO_MODE=true` で本番ビルドでも Discord
 * OAuth gate を skip し、roles=[] (非 admin) の偽ゲストを返す。モックサイト
 * (TODO #8) で portal を一般公開しつつ、書き込みは admin gate で禁止する用途。
 *
 * dev bypass との違い:
 * - NODE_ENV ガードを設けず production でも有効
 * - roles は常に空 ([]) — `userIsAdmin()` は false を返し、`requireAdmin()`
 *   や `assertAdminResult()` で書き込み Server Action を弾く
 * - createClient() は service role に切替えない (anon key で動作)
 *   → RLS の `WITH CHECK (auth.jwt()->>is_admin = 'true')` でも block される
 *
 * 優先順位は dev bypass の後 (= ローカル開発で両方 true なら admin 視点維持)。
 */
function publicDemoModeUser(): AuthorizedUser | null {
  if (process.env.PUBLIC_DEMO_MODE !== "true") return null;
  return {
    userId: "00000000-0000-0000-0000-0000000d3m0u",
    discordId: "public-demo-mode-guest",
    roles: [], // always non-admin — read-only public demo
  };
}

/**
 * React `cache()` でリクエスト単位 dedupe する。1 回の hard nav 中に
 * `(portal)/layout` (`getAuthorizedUserRoles`) → `[slug]/layout`
 * (`requireDiscordRoles`) → 各 page (`getCurrentUserCanEdit`) の 3 経路で
 * `auth.getUser()` が走っていたのを 1 回に圧縮 (TODO #11 phase 5)。
 */
export const requireDiscordMember = cache(
  async (): Promise<AuthorizedUser> => {
    const bypass = devAuthBypassUser();
    if (bypass) return bypass;

    const demo = publicDemoModeUser();
    if (demo) return demo;

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
  },
);

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
 * ユーザが admin かどうか。
 *
 * 2.x (2026-06-09): **fail-closed** 化。`DISCORD_ADMIN_ROLE_IDS` 未設定
 * なら **false** を返す (= 編集機能は全員 OFF)。以前は env 未設定で全員
 * admin (= fail-open) という後方互換動作だったが、fork で env 設定を
 * 忘れた瞬間に全 guild メンバーが anon key + JWT で REST 直叩きから
 * RLS の書き込みを通過できてしまうリスクがあった。
 *
 * Dev bypass (NODE_ENV != production && DEV_AUTH_BYPASS=true) のみ、
 * env から切り離した固定 ID (`DEV_BYPASS_ADMIN_ROLE_ID`) を保有する
 * 偽ユーザーが admin として扱われる特例を設ける。これで dev 環境では
 * env なしでも admin 視点が再現できる (devAuthBypassUser 参照)。
 */
export function userIsAdmin(userRoleIds: readonly string[]): boolean {
  // Dev bypass の擬似 admin: env と無関係に常に admin として扱う。
  // production ビルドでは devAuthBypassUser が null を返すのでこの
  // ID は roles に乗らない。
  if (userRoleIds.includes(DEV_BYPASS_ADMIN_ROLE_ID)) return true;
  const adminIds = getAdminRoleIds();
  if (adminIds.length === 0) return false; // fail-closed
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
