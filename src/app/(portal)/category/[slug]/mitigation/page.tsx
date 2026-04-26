import { SheetIframe } from "@/components/portal/sheet-iframe";
import { findCategoryBySlug } from "@/lib/supabase/categories";

export const metadata = {
  title: "軽減表",
};

export default async function MitigationPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const category = await findCategoryBySlug(slug);

  return (
    <SheetIframe
      url={category?.mitigationSheetUrl ?? null}
      title="軽減表"
      emptyHint="ヘッダーのカテゴリーメニュー → 編集 から、軽減表のスプレッドシートURL（Google Sheets の公開URL等）を登録すると、ここに埋め込み表示されます。"
    />
  );
}
