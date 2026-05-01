import { ChunkErrorHandler } from "@/components/portal/chunk-error-handler";
import { SiteHeader } from "@/components/portal/site-header";
import { MainTabs } from "@/components/portal/main-tabs";
import { fetchCategories } from "@/lib/supabase/categories";
import { getAuthorizedUserRoles } from "@/lib/server/auth";
import { filterVisibleCategories } from "@/lib/category-visibility";

/**
 * 2.1 (2026-04-29) TODO #45: 全ポータルページを Edge Runtime に統一。
 *
 * Server Action は呼び出し元ページの runtime で実行される仕様のため、
 * 旧構成では TOP (`page.tsx` が `runtime = "edge"`) からの linkFflogsReports
 * は Edge IP、`/category/...` 等からは Node Lambda IP で fflogs.com に
 * fetch していた。Vercel の Node Lambda IP 帯は Cloudflare の bot 判定で
 * 403 を引きやすく、HTML scrape による Unlisted/Private レポート取得が
 * ページによって失敗する原因になっていた。
 *
 * Layout 配下の全 page は明示しない限りこの runtime を継承する。子 page
 * 側で `export const runtime = "nodejs"` を明示すれば個別に上書き可能。
 * Edge 互換性は TOP `page.tsx` で既に検証済 (Supabase ssr / fetch /
 * cookies() / fflogs OAuth Basic は btoa で Edge 対応)。
 */
export const runtime = "edge";

export default async function PortalLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Fetch once per request — `fetchCategories` is React-cached so the
  // category page / sub-tab layout don't repeat the query.
  // TODO #19: filter the list to categories the user's Discord roles can
  // see. Categories with `requiredRoleIds = []` (default) are visible to
  // everyone; non-empty arrays restrict to role intersection.
  const [result, userRoles] = await Promise.all([
    fetchCategories(),
    getAuthorizedUserRoles(),
  ]);
  const visible = result.ok
    ? filterVisibleCategories(result.categories, userRoles)
    : result.categories;

  return (
    <>
      <ChunkErrorHandler />
      <SiteHeader />
      <MainTabs initialCategories={visible} userRoleIds={userRoles} />
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
