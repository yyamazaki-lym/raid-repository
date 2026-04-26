import { SheetIframe } from "@/components/portal/sheet-iframe";
import { findCategoryBySlug } from "@/lib/supabase/categories";

export const metadata = {
  title: "ロット管理",
};

export default async function LootPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const category = await findCategoryBySlug(slug);

  return (
    <SheetIframe
      url={category?.lootSheetUrl ?? null}
      title="ロット管理"
      emptyHint="ヘッダーのカテゴリーメニュー → 編集 から、ロット管理のスプレッドシートURLを登録すると、ここに埋め込み表示されます。"
    />
  );
}
