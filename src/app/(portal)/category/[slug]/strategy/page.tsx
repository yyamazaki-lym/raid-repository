import { findCategoryBySlug } from "@/lib/supabase/categories";
import { fetchCategoryLinks } from "@/lib/supabase/category-links";
import { StrategyList } from "./strategy-list";

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

  const links = await fetchCategoryLinks(category.id, "strategy");
  return <StrategyList categoryId={category.id} initial={links} />;
}
