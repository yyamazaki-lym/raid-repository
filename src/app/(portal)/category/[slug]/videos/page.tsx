import { findCategoryBySlug } from "@/lib/supabase/categories";
import { fetchCategoryLinks } from "@/lib/supabase/category-links";
import { VideosList } from "./videos-list";

export const metadata = {
  title: "動画",
};

export default async function VideosPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const category = await findCategoryBySlug(slug);

  if (!category) {
    return (
      <p className="text-muted-foreground p-6 text-center text-sm">
        カテゴリーが見つかりませんでした。
      </p>
    );
  }

  const videos = await fetchCategoryLinks(category.id, "video");
  return <VideosList categoryId={category.id} initial={videos} />;
}
