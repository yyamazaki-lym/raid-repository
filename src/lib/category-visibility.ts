import type { Category } from "@/lib/supabase/types";

/**
 * カテゴリのロール gate 判定 (TODO #19)。
 *
 * - `requiredRoleIds` が空 → 全 guild メンバー閲覧可
 * - 非空 → ユーザの roles と 1 つでも交差すれば可、しなければ不可
 *
 * Server Component / Server Action では `requireDiscordMember()` (auth.ts)
 * からユーザの roles を取得して渡す。Client 側で使う場合は server から
 * props で roles を渡す形にする (browser から直接 app_metadata は読めない)。
 */
export function isCategoryVisibleToRoles(
  category: Pick<Category, "requiredRoleIds">,
  userRoleIds: readonly string[],
): boolean {
  const required = category.requiredRoleIds;
  if (!required || required.length === 0) return true;
  if (userRoleIds.length === 0) return false;
  const set = new Set(userRoleIds);
  return required.some((id) => set.has(id));
}

export function filterVisibleCategories<C extends Pick<Category, "requiredRoleIds">>(
  categories: readonly C[],
  userRoleIds: readonly string[],
): C[] {
  return categories.filter((c) => isCategoryVisibleToRoles(c, userRoleIds));
}
