import { SheetIframe } from "@/components/portal/sheet-iframe";
import { SheetUrlOnboarding } from "@/components/portal/sheet-url-onboarding";
import { notFound } from "next/navigation";
import { findCategoryBySlug } from "@/lib/supabase/categories";
import { getCurrentUserCanEdit } from "@/lib/server/auth";

// TODO #54 part3 横展開: FFLogs 非依存ページなので Node runtime に切替 (cold start 短縮)。
export const runtime = "nodejs";

export const metadata = {
  title: "ロット管理",
};

export default async function LootPage({
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

  // 監査 P3-m: enabled=false のタブはナビから除外されるが直 URL では描画される。
  // ナビ非表示と到達性を一致させるため無効タブは 404 にする。
  if (category.tabConfig?.["loot"]?.enabled === false) notFound();

  if (!category.lootSheetUrl) {
    return (
      <SheetUrlOnboarding
        categoryId={category.id}
        categoryName={category.name}
        kind="loot"
      />
    );
  }

  return (
    <SheetIframe
      url={category.lootSheetUrl}
      title="ロット管理"
      emptyHint=""
      categoryId={category.id}
      kind="loot"
      canEdit={canEdit}
    />
  );
}
