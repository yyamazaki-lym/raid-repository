import { ChunkErrorHandler } from "@/components/portal/chunk-error-handler";
import { SiteHeader } from "@/components/portal/site-header";
import { MainTabs } from "@/components/portal/main-tabs";
import { MainActionSlotProvider } from "@/components/portal/action-slot";
import { fetchCategories } from "@/lib/supabase/categories";
import { getAuthorizedUserRoles } from "@/lib/server/auth";
import { filterVisibleCategories } from "@/lib/category-visibility";
import { getScheduleSourceMode } from "@/lib/schedule/source-mode";

/**
 * 2.9 (2026-06-11): Edge → Node runtime 化 (デプロイ後/アイドル後の初回
 * 描画 5 秒問題の根本対策)。
 *
 * 旧構成 (TODO #45, 2026-04-29) は「FFLogs scrape は Edge IP 必須 —
 * Vercel の Node Lambda IP 帯は Cloudflare bot 判定で 403 を引く」を
 * 根拠に全ポータルページを Edge に統一していたが、この前提は崩れた:
 *   - cron (/api/cron/fflogs-sync, runtime="nodejs") が Node IP で日次
 *     scrape に成功している (2.8 実測: 459 件取得 / 403 は間欠的)
 *   - TODO #54 part3 で Node 化済みの category 系ページからも settings
 *     dialog 経由で同じ scrape Server Action を呼べる状態で運用済み
 *
 * 一方 Edge runtime は Fluid Compute の instance 再利用に乗れず、デプロイ
 * 後/アイドル後の初回アクセスで毎回 cold start を踏む。TODO #54 part3 の
 * Node 化 6 ページで「デプロイ後でも表示が早くなった」体感改善が実証済み
 * のため、取り残されていた本 layout + TOP `page.tsx` も Node に揃える。
 *
 * 注意: Server Action は呼び出し元 page の runtime で実行される。Node 化
 * 直後の本番実測で、Node IP からの FFLogs scrape は Cloudflare 403 が
 * **恒常化** することが確定した (間欠ではなかった) ため、scrape の外向き
 * fetch だけを Edge route (`/api/fflogs/scrape-proxy`) に切り出して中継
 * している (fflogs.ts の `fetchScrapePageHtml` 参照)。ページ runtime を
 * Edge に戻す部分ロールバックは不要になった (経緯: .claude/todos/54.md)。
 */
export const runtime = "nodejs";

export default async function PortalLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Fetch once per request — `fetchCategories` is React-cached so the
  // category page / sub-tab layout don't repeat the query.
  // TODO #19: filter the list to categories the user's Discord roles can
  // see. Categories with `requiredRoleIds = []` (default) are visible to
  // everyone; non-empty arrays restrict to role intersection.
  // TODO #79: scheduleSourceMode を MainTabs に渡してスケジュール tab の
  // 出し分け (disabled モード時は非表示) を行う。getScheduleSourceMode は
  // React.cache 済なので page.tsx 側で再度呼ばれても DB クエリは 1 回。
  const [result, userRoles, scheduleSourceMode] = await Promise.all([
    fetchCategories(),
    getAuthorizedUserRoles(),
    getScheduleSourceMode(),
  ]);
  const visible = result.ok
    ? filterVisibleCategories(result.categories, userRoles)
    : result.categories;

  return (
    <>
      <ChunkErrorHandler />
      <SiteHeader />
      {/* TODO #58 part2: /category 一覧の Maintenance + 追加ボタンを MainTabs
          右端 portal target へ追従表示するための context。MainTabs と children
          を一緒に包み、子側 <MainActionSlot> が stuck 状態を push、MainTabs 側
          <MainActionSlotTarget> が portal 着地 div を提供する。 */}
      <MainActionSlotProvider>
        <MainTabs
          initialCategories={visible}
          userRoleIds={userRoles}
          scheduleSourceMode={scheduleSourceMode}
        />
        {/* 1.9.30: max-width を 6xl (1152px) → 5xl (1024px) に絞る。
            PC 横幅が広すぎてカードや表が間延びして見える、という
            ユーザー指摘への対応。最も広いレイアウトでも 1024px に収まる
            ようにし、上下方向の縦スクロールを犠牲にしてでも横の密度を
            上げる。schedule の詳細表は overflow-x-auto があるので
            必要なら横スクロールに切り替わる。 */}
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
          {children}
        </main>
      </MainActionSlotProvider>
    </>
  );
}
