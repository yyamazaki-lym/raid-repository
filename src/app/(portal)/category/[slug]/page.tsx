import { redirect } from "next/navigation";
import { findCategoryBySlug } from "@/lib/supabase/categories";

export default async function CategoryRootPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  // Phase 17 (2026-05-13): 既定タブは category.defaultTab (DB 設定)。
  // カテゴリが見つからない or 設定欠落時は従来通り mitigation にフォールバック。
  const category = await findCategoryBySlug(slug);
  const target = category?.defaultTab ?? "mitigation";
  redirect(`/category/${slug}/${target}`);
}
