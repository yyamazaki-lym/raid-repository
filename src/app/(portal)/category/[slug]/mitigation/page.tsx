import { SheetIframe } from "@/components/portal/sheet-iframe";
import { SheetCards } from "@/components/portal/sheet-cards";
import { SheetViewSwitch } from "@/components/portal/sheet-view-switch";
import { SheetUrlOnboarding } from "@/components/portal/sheet-url-onboarding";
import { fetchSheetTable } from "@/lib/server/sheet-table";
import { notFound } from "next/navigation";
import { findCategoryBySlug } from "@/lib/supabase/categories";
import { getCurrentUserCanEdit } from "@/lib/server/auth";

// TODO #54 part3 横展開: FFLogs 非依存ページなので Node runtime に切替 (cold start 短縮)。
export const runtime = "nodejs";

export const metadata = {
  title: "軽減表",
};

export default async function MitigationPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [category, canEdit] = await Promise.all([
    findCategoryBySlug(slug),
    getCurrentUserCanEdit(),
  ]);

  if (!category) {
    return (
      <p className="text-muted-foreground p-6 text-center text-sm">
        コンテンツが見つかりませんでした。
      </p>
    );
  }

  // 監査 P3-m: enabled=false のタブはナビ (sub-tabs / カード / 切替メニュー) から
  // 除外されるが、直 URL / ブックマークでは page が描画されてしまう。ナビ非表示と
  // 到達性を一致させるため無効タブは 404 にする (role gate は別途 layout で維持)。
  if (category.tabConfig?.["mitigation"]?.enabled === false) notFound();

  if (!category.mitigationSheetUrl) {
    return (
      <SheetUrlOnboarding
        categoryId={category.id}
        categoryName={category.name}
        kind="mitigation"
      />
    );
  }

  // TODO #94 / A-3: Sheets を編集の正としたまま、モバイルでは CSV 由来の
  // 読み取り専用カードを出す。取得に失敗したら従来どおり iframe だけを描く
  // (= 機能後退しない fallback)。
  const table = await fetchSheetTable(category.mitigationSheetUrl);

  return (
    <div className="flex flex-col gap-4">
      {/* TODO #94: モバイルはカード固定、PC はボタンでシート ⇄ カードを切替。 */}
      {table.ok ? (
        <SheetViewSwitch
          storageKey="raid-repo:sheet-card-mode:mitigation"
          cards={
            <SheetCards
              table={table.table}
              sheetUrl={category.mitigationSheetUrl}
              title="軽減表"
            />
          }
          iframe={
            <SheetIframe
              url={category.mitigationSheetUrl}
              title="軽減表"
              emptyHint=""
              categoryId={category.id}
              kind="mitigation"
              canEdit={canEdit}
            />
          }
        />
      ) : (
        <SheetIframe
          url={category.mitigationSheetUrl}
          title="軽減表"
          emptyHint=""
          categoryId={category.id}
          kind="mitigation"
          canEdit={canEdit}
        />
      )}
    </div>
  );
}
