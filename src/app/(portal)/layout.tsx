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
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        {children}
      </main>
    </>
  );
}
