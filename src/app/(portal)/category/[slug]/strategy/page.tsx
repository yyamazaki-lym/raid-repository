import { notFound } from "next/navigation";
import { findCategoryBySlug } from "@/lib/supabase/categories";
import { fetchCategoryLinks } from "@/lib/supabase/category-links";
import { fetchCategoryGphotoAlbums } from "@/lib/supabase/category-gphoto-albums";
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

  // 監査 P3-m: enabled=false のタブはナビから除外されるが直 URL では描画される。
  // ナビ非表示と到達性を一致させるため無効タブは 404 にする。
  if (category.tabConfig?.["strategy"]?.enabled === false) notFound();

  // Phase 15 / 16 (2026-05-13): リンク / 画像 / Google フォト系を並行プリフェッチ。
  // fetchCategoryLinks は React.cache 済だが kind 違いは別キー扱いで
  // SELECT が分かれる。Promise.all で直列化を避ける。
  const [links, images, gphotos, albums] = await Promise.all([
    fetchCategoryLinks(category.id, "strategy"),
    fetchCategoryLinks(category.id, "image"),
    fetchCategoryLinks(category.id, "gphoto"),
    fetchCategoryGphotoAlbums(category.id),
  ]);
  return (
    <div className="flex flex-col gap-6">
      <StrategyList
        categoryId={category.id}
        initial={links}
        initialShowThumbnails={category.showStrategyThumbnails}
      />
      <StrategyImagesList
        categoryId={category.id}
        initialImages={images}
        initialGphotos={gphotos}
        initialAlbums={albums}
      />
    </div>
  );
}
