import { notFound } from "next/navigation";
import { findCategoryBySlug } from "@/lib/supabase/categories";
import { fetchCategoryLinks } from "@/lib/supabase/category-links";
import { VideosList } from "./videos-list";

// TODO #54 part3: Edge → Node runtime 個別 override で cold start 短縮を試験。
// 親 layout は edge (settings-dialog 経由の FFLogs Server Action のため維持必須) だが、
// このページは Supabase REST のみ依存で FFLogs に触れていないため Node に移せる。
// preferredRegion は Node では Vercel project 設定 (vercel.json regions: ["hnd1"]) に従う。
export const runtime = "nodejs";

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
        コンテンツが見つかりませんでした。
      </p>
    );
  }

  // 監査 P3-m: enabled=false のタブはナビから除外されるが直 URL では描画される。
  // ナビ非表示と到達性を一致させるため無効タブは 404 にする。
  if (category.tabConfig?.["videos"]?.enabled === false) notFound();

  const videos = await fetchCategoryLinks(category.id, "video");
  return (
    <VideosList
      categoryId={category.id}
      initial={videos}
      firstClearAt={category.firstClearAt}
      status={category.status}
      manualTimeToClearSeconds={category.manualTimeToClearSeconds}
    />
  );
}
