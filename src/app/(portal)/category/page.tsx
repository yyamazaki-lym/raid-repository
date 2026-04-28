import { AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/card";
// Server component — `next/dynamic({ ssr: false })` は server 側で
// 動かないので、ここは static import のまま (client チャンクには
// `category-list.tsx` 経由の `category-form-dialog-lazy` 分割が効く)。
import { CategoryFormDialog } from "@/components/portal/category-form-dialog";
import { MaintenanceMenu } from "@/components/portal/maintenance-menu";
import { fetchCategories } from "@/lib/supabase/categories";
import {
  fetchPracticeSecondsByCategory,
  fetchRecentImportCountsByCategory,
  fetchTimeToClearByCategory,
} from "@/lib/server/categories-actions";
import { getAuthorizedUserRoles } from "@/lib/server/auth";
import { filterVisibleCategories } from "@/lib/category-visibility";
import { CategoryList } from "./category-list";

export const metadata = {
  title: "コンテンツ",
};

export default async function CategoryIndexPage() {
  const [result, userRoles, recentCounts, practiceSeconds, timeToClear] =
    await Promise.all([
      fetchCategories(),
      getAuthorizedUserRoles(),
      fetchRecentImportCountsByCategory(7),
      fetchPracticeSecondsByCategory(),
      fetchTimeToClearByCategory(),
    ]);
  // TODO #19: hide categories the user's roles can't view. Cards still
  // exist in the DB and admins (= every guild member with edit access in
  // V1) can see them once their role intersection allows.
  const visible = result.ok
    ? filterVisibleCategories(result.categories, userRoles)
    : result.categories;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl text-foreground sm:text-2xl">
            Contents
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            レイドコンテンツ単位で、軽減・ロット・攻略情報を切り替えます。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <MaintenanceMenu />
          <CategoryFormDialog />
        </div>
      </div>

      {!result.ok && (
        <Card className="glass flex items-start gap-3 border-destructive/40 p-4">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-destructive/40 bg-background/40 text-destructive">
            <AlertTriangle className="h-4 w-4" aria-hidden />
          </span>
          <div className="flex flex-col gap-1">
            <p className="font-display text-sm text-foreground">
              Supabase に接続できませんでした
            </p>
            <p className="text-xs text-muted-foreground">
              <code className="font-mono">supabase/schema.sql</code>{" "}
              を Supabase Dashboard の SQL Editor で実行してください。詳細:{" "}
              <span className="font-mono">{result.reason}</span>
            </p>
          </div>
        </Card>
      )}

      <CategoryList
        initialCategories={visible}
        userRoleIds={userRoles}
        recentImportCounts={recentCounts}
        practiceSecondsByCategory={practiceSeconds}
        timeToClearByCategory={timeToClear}
      />
    </div>
  );
}
