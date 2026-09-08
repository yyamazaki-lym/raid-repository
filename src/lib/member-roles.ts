import { normalizeName } from "./schedule/attendance-reminder-core";

/**
 * メンバーのロール (UI-4、2026-09-08)。
 *
 * 軽減表のカードを **「自分のロールだけ」** に絞るために使う。調査ノート
 * 第 4 回 8-3 UI-4 の前提だった「ロール」を portal 側に持つ最小の形。
 *
 * ## 3 値に固定する
 *
 * ⚠ タンク / ヒーラー / DPS はゲームの構造で、運営の再編で増減しない
 * (DC 名を自由記述にしたのとは事情が違う)。**MT/ST/H1/H2/D1〜D4 の細かい
 * 位置は持たない** — 固定ごとに呼び方が違い、シートの列見出しが正だから。
 *
 * ## 列との対応は表示名で取る
 *
 * 軽減表の列見出しはメンバーの表示名なので、`native_schedule_members` の
 * 表示名 → ロールの対応をそのまま使う。比較は催促 / 出席突合と同じ
 * `normalizeName` (全角英数の半角化 + 空白除去 + 小文字化) に揃える。
 *
 * 検証: `node scripts/check-member-roles.mjs`
 */

export const MEMBER_ROLES = ["tank", "healer", "dps"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

const ROLE_SET = new Set<string>(MEMBER_ROLES);

export function isMemberRole(v: unknown): v is MemberRole {
  return typeof v === "string" && ROLE_SET.has(v);
}

/** 表示名 → ロール の対応 (比較キーは正規化済み)。 */
export type RoleByName = Record<string, MemberRole>;

export function buildRoleByName(
  members: ReadonlyArray<{ displayName: string; role: string | null }>,
): RoleByName {
  const out: RoleByName = {};
  for (const mem of members) {
    if (!isMemberRole(mem.role)) continue;
    const key = normalizeName((mem.displayName ?? "").trim());
    if (!key) continue;
    // 同名が 2 人居たら**どちらにも決めない** (取り違えて他人の列を
    // 「自分のロール」に混ぜるより、絞らない方が害が小さい)。
    if (key in out && out[key] !== mem.role) {
      delete out[key];
      continue;
    }
    out[key] = mem.role;
  }
  return out;
}

/** 名前からロールを引く (未登録は null)。 */
export function roleOfName(
  roleByName: RoleByName,
  name: string | null | undefined,
): MemberRole | null {
  const key = normalizeName((name ?? "").trim());
  if (!key) return null;
  return roleByName[key] ?? null;
}

/**
 * 「自分のロールだけ」で残す列の判定。
 *
 * 自分のロールが分からない (名前が未登録 / ロール未設定) ときは
 * **絞らない** — 空の表を出すより全部見せる方が害が少ない。
 */
export function isSameRoleColumn({
  roleByName,
  myName,
  columnName,
}: {
  roleByName: RoleByName;
  myName: string | null | undefined;
  columnName: string | null | undefined;
}): boolean {
  const mine = roleOfName(roleByName, myName);
  if (mine === null) return true;
  return roleOfName(roleByName, columnName) === mine;
}
