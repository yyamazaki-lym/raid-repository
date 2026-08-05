import "server-only";

/**
 * admin ロール判定の純粋関数だけを切り出したリーフモジュール。
 *
 * 元は `auth.ts` に同居していたが、`auth.ts` は `next/headers` に依存する
 * `@/lib/supabase/server` を import するため proxy.ts (request 前段) から
 * 読み込めない。2026-08-05 監査 H-1 でメンバーシップ再検証を proxy 側に
 * 置くにあたり、env 参照のみの純粋ロジックをここへ分離した。
 *
 * `auth.ts` は後方互換のため両関数を re-export しているので、既存の
 * `import { userIsAdmin } from "@/lib/server/auth"` はそのまま動く。
 */

/**
 * Dev-only bypass 用の擬似 admin ロール ID。
 * `DISCORD_ADMIN_ROLE_IDS` env から独立した固定値にすることで、
 * env 未設定の dev 環境でも admin 視点を再現できるようにする
 * (2.x: userIsAdmin の fail-closed 化対応)。
 */
export const DEV_BYPASS_ADMIN_ROLE_ID = "__dev-bypass-admin__";

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
