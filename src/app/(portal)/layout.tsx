import { SiteHeader } from "@/components/portal/site-header";
import { MainTabs } from "@/components/portal/main-tabs";
import { fetchCategories } from "@/lib/supabase/categories";

export default async function PortalLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Fetch once per request — `fetchCategories` is React-cached so the
  // category page / sub-tab layout don't repeat the query.
  const result = await fetchCategories();

  return (
    <>
      <SiteHeader />
      <MainTabs initialCategories={result.categories} />
      {/* 1.9.30: max-width を 6xl (1152px) → 5xl (1024px) に絞る。
          PC 横幅が広すぎてカードや表が間延びして見える、という
          ユーザー指摘への対応。最も広いレイアウトでも 1024px に収まる
          ようにし、上下方向の縦スクロールを犠牲にしてでも横の密度を
          上げる。schedule の詳細表は overflow-x-auto があるので
          必要なら横スクロールに切り替わる。 */}
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        {children}
      </main>
    </>
  );
}
