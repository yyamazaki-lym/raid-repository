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
import {
  getAuthorizedUserRoles,
  userIsAdmin,
} from "@/lib/server/auth";
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
  // 2.0 (2026-04-29): /category index は管理ビューとして全件表示する。
  // 直前 PR (#3) ではここでもフィルタしていたが、ロール制限を付けた
  // カテゴリを後で undo するために編集ダイアログへ到達する経路が必要
  // なため、index ではフィルタを外す。代わりに category-list.tsx 側で
  // 自分が見えないカードに 🔒 + ロールバッジを出して視認性を確保。
  // MainTabs ドロップダウンと subpage 直アクセスは引き続きロール gate。
  // 2.1 (TODO #21): admin 限定編集。canEdit=false のときは「+追加」/
  // MaintenanceMenu / DnD / ⋮ メニュー / ステータス変更 を全て隠す。
  // env (`DISCORD_ADMIN_ROLE_IDS`) 未設定なら canEdit=true (後方互換)。
  const canEdit = userIsAdmin(userRoles);

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
          {canEdit && <MaintenanceMenu />}
          {canEdit && <CategoryFormDialog />}
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
        initialCategories={result.categories}
        userRoleIds={userRoles}
        canEdit={canEdit}
        recentImportCounts={recentCounts}
        practiceSecondsByCategory={practiceSeconds}
        timeToClearByCategory={timeToClear}
      />
    </div>
  );
}
