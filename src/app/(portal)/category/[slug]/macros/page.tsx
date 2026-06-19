import { notFound } from "next/navigation";
import { findCategoryBySlug } from "@/lib/supabase/categories";
import {
  fetchCategoryMacros,
  fetchRecruitmentTemplatesForCategory,
} from "@/lib/supabase/category-macros";
import { MacrosList } from "./macros-list";

// TODO #54 part3 横展開: FFLogs 非依存ページなので Node runtime に切替 (cold start 短縮)。
export const runtime = "nodejs";

export const metadata = {
  title: "マクロ",
};

export default async function MacrosPage({
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
  if (category.tabConfig?.["macros"]?.enabled === false) notFound();

  const [macros, templates] = await Promise.all([
    fetchCategoryMacros(category.id),
    fetchRecruitmentTemplatesForCategory(category.id),
  ]);

  return (
    <MacrosList
      categoryId={category.id}
      categoryName={category.name}
      initialMacros={macros}
      initialTemplates={templates}
    />
  );
}
