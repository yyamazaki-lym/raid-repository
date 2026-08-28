import { SheetIframe } from "@/components/portal/sheet-iframe";
import { SheetCards } from "@/components/portal/sheet-cards";
import { SheetViewSwitch } from "@/components/portal/sheet-view-switch";
import { SheetUrlOnboarding } from "@/components/portal/sheet-url-onboarding";
import { fetchSheetTable } from "@/lib/server/sheet-table";
import { notFound } from "next/navigation";
import { findCategoryBySlug } from "@/lib/supabase/categories";
import {
  getCurrentUserCanEdit,
  requireDiscordMember,
} from "@/lib/server/auth";
import {
  fetchCategoryBisLinks,
  fetchLootWeekly,
} from "@/lib/supabase/loot-extras";
import {
  BisLinksPanel,
  LootWeeklyPanel,
} from "@/components/portal/loot-extras";
import {
  currentWeekStart,
  formatUntilNextReset,
  formatWeekLabel,
} from "@/lib/week-jst";

// TODO #54 part3 横展開: FFLogs 非依存ページなので Node runtime に切替 (cold start 短縮)。
export const runtime = "nodejs";

export const metadata = {
  title: "ロット管理",
};

export default async function LootPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [category, canEdit, viewer] = await Promise.all([
    findCategoryBySlug(slug),
    getCurrentUserCanEdit(),
    // 本人判定は server 側で済ませ、client には Discord ID を渡さない
    // (presence key の設計と同じ方針、`auth.ts` の注記参照)。
    requireDiscordMember(),
  ]);

  if (!category) {
    return (
      <p className="text-muted-foreground p-6 text-center text-sm">
        コンテンツが見つかりませんでした。
      </p>
    );
  }

  // 監査 P3-m: enabled=false のタブはナビから除外されるが直 URL では描画される。
  // ナビ非表示と到達性を一致させるため無効タブは 404 にする。
  if (category.tabConfig?.["loot"]?.enabled === false) notFound();

  // TODO #94 / A-4: 週制限の消化チェックと BiS リンクは Sheets URL の有無に
  // かかわらず使えるので、シート未設定 (onboarding) の画面でも上に出す。
  const weekStart = currentWeekStart();
  const [bisLinks, weeklyRows] = await Promise.all([
    fetchCategoryBisLinks(category.id),
    fetchLootWeekly(category.id, weekStart, viewer.discordId),
  ]);

  const extras = (
    <div className="flex flex-col gap-3 px-3 md:px-0">
      <LootWeeklyPanel
        categoryId={category.id}
        weekStart={weekStart}
        weekLabel={formatWeekLabel(weekStart)}
        untilReset={formatUntilNextReset()}
        rows={weeklyRows}
      />
      <BisLinksPanel
        categoryId={category.id}
        links={bisLinks}
        canEdit={canEdit}
      />
    </div>
  );

  if (!category.lootSheetUrl) {
    return (
      <div className="flex flex-col gap-4">
        {extras}
        <SheetUrlOnboarding
          categoryId={category.id}
          categoryName={category.name}
          kind="loot"
        />
      </div>
    );
  }

  // TODO #94 / A-3: Sheets を編集の正としたまま、モバイルでは CSV 由来の
  // 読み取り専用カードを出す。取得に失敗したら従来どおり iframe だけを描く
  // (= 機能後退しない fallback)。
  const table = await fetchSheetTable(category.lootSheetUrl);

  return (
    <div className="flex flex-col gap-4">
      {extras}
      {/* TODO #94: モバイルはカード固定、PC はボタンでシート ⇄ カードを切替。 */}
      {table.ok ? (
        <SheetViewSwitch
          storageKey="raid-repo:sheet-card-mode:loot"
          cards={
            <SheetCards
              table={table.table}
              sheetUrl={category.lootSheetUrl}
              title="ロット管理"
            />
          }
          iframe={
            <SheetIframe
              url={category.lootSheetUrl}
              title="ロット管理"
              emptyHint=""
              categoryId={category.id}
              kind="loot"
              canEdit={canEdit}
            />
          }
        />
      ) : (
        <SheetIframe
          url={category.lootSheetUrl}
          title="ロット管理"
          emptyHint=""
          categoryId={category.id}
          kind="loot"
          canEdit={canEdit}
        />
      )}
    </div>
  );
}
