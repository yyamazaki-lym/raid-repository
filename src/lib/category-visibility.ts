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
 *
 * ⚠️ これはセキュリティ境界ではない (2026-06-11 監査で確認・割り切り)。
 * 「表示の出し分け / 誤クリック防止」のためのアプリ層フィルタであって機密
 * 境界ではない。RLS は全テーブル `SELECT ... USING (true)` で anon に開放
 * されている (単一テナント性善説設計、schema.sql 冒頭参照) ため、ブラウザ
 * バンドルに含まれる公開値 `NEXT_PUBLIC_SUPABASE_ANON_KEY` で Supabase
 * REST/Realtime を直接叩けば、このフィルタを通さずロール制限カテゴリの中身
 * (攻略情報・メンバー名等) も読める。「同じギルドの他メンバーにも秘匿したい
 * 機密」は required_role_ids では守れないので置かないこと。真の秘匿が必要に
 * なったら RLS にロール条件を実装する (= SELECT 全開設計の部分撤回が必要)。
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
