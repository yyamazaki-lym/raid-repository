import { findCategoryBySlug } from "@/lib/supabase/categories";
import { fetchCategoryLinks } from "@/lib/supabase/category-links";
import { StrategyList } from "./strategy-list";
import { StrategyImagesList } from "./strategy-images-list";

// TODO #54 part3 横展開: FFLogs 非依存ページなので Node runtime に切替 (cold start 短縮)。
export const runtime = "nodejs";

export const metadata = {
  title: "攻略情報",
};

export default async function StrategyPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const category = await findCategoryBySlug(slug);

  if (!category) {
    return (
      <p className="text-muted-foreground p-6 text-center text-sm">
        コンテンツが見つかりませんでした。
      </p>
    );
  }

  // Phase 15 (2.x, 2026-05-13): リンクと画像を並行プリフェッチ。
  // fetchCategoryLinks は React.cache 済だが kind 違いは別キー扱いで
  // SELECT が 2 本走る。Promise.all で直列化を避ける。
  const [links, images] = await Promise.all([
    fetchCategoryLinks(category.id, "strategy"),
    fetchCategoryLinks(category.id, "image"),
  ]);
  return (
    <div className="flex flex-col gap-6">
      <StrategyList
        categoryId={category.id}
        initial={links}
        initialShowThumbnails={category.showStrategyThumbnails}
      />
      <StrategyImagesList categoryId={category.id} initial={images} />
    </div>
  );
}
