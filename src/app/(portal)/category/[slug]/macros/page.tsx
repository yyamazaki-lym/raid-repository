import { findCategoryBySlug } from "@/lib/supabase/categories";
import {
  fetchCategoryMacros,
  fetchRecruitmentTemplatesForCategory,
} from "@/lib/supabase/category-macros";
import { MacrosList } from "./macros-list";

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
        カテゴリーが見つかりませんでした。
      </p>
    );
  }

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
