import Link from "next/link";
import { SheetIframe } from "@/components/portal/sheet-iframe";
import { SheetCards } from "@/components/portal/sheet-cards";
import { SheetViewSwitch } from "@/components/portal/sheet-view-switch";
import { SheetUrlOnboarding } from "@/components/portal/sheet-url-onboarding";
import { fetchSheetTable, fetchSheetTabs } from "@/lib/server/sheet-table";
import { extractSheetGid, parseSheetTabsSetting } from "@/lib/sheet-csv";
import { MitigationSheetTabsDialog } from "@/components/portal/mitigation-sheet-tabs-dialog";
import { notFound } from "next/navigation";
import { findCategoryBySlug } from "@/lib/supabase/categories";
import { getCurrentUserCanEdit } from "@/lib/server/auth";

// TODO #54 part3 横展開: FFLogs 非依存ページなので Node runtime に切替 (cold start 短縮)。
export const runtime = "nodejs";

export const metadata = {
  title: "軽減表",
};

export default async function MitigationPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  // 2026-08-30: 層タブ切替 (?gid=<ワークシート gid>)。
  searchParams: Promise<{ gid?: string }>;
}) {
  const [{ slug }, { gid: rawGid }] = await Promise.all([params, searchParams]);
  const [category, canEdit] = await Promise.all([
    findCategoryBySlug(slug),
    getCurrentUserCanEdit(),
  ]);

  if (!category) {
    return (
      <p className="text-muted-foreground p-6 text-center text-sm">
        コンテンツが見つかりませんでした。
      </p>
    );
  }

  // 監査 P3-m: enabled=false のタブはナビ (sub-tabs / カード / 切替メニュー) から
  // 除外されるが、直 URL / ブックマークでは page が描画されてしまう。ナビ非表示と
  // 到達性を一致させるため無効タブは 404 にする (role gate は別途 layout で維持)。
  if (category.tabConfig?.["mitigation"]?.enabled === false) notFound();

  if (!category.mitigationSheetUrl) {
    return (
      <SheetUrlOnboarding
        categoryId={category.id}
        categoryName={category.name}
        kind="mitigation"
      />
    );
  }

  // TODO #94 / A-3: Sheets を編集の正としたまま、モバイルでは CSV 由来の
  // 読み取り専用カードを出す。取得に失敗したら従来どおり iframe だけを描く
  // (= 機能後退しない fallback)。
  // 2026-08-30: シート内のワークシート (層) 一覧を取得し、?gid= で切替
  // できるタブを出す (ユーザー要望「シートに存在する各層を切り替えたい」)。
  // タブ一覧が取れないシートは従来どおり単一表示。
  // 2026-08-30 実機報告「シートが一番最初のものしか参照されていない」:
  // pubhtml / htmlview からの自動検出は公開設定と Google のマークアップに
  // 依存して当てにならなかった。**手動登録があればそれを正**とし、
  // 無いときだけ自動検出にフォールバックする。
  const manualTabs = parseSheetTabsSetting(category.mitigationSheetTabs);
  const tabs =
    manualTabs.length > 0
      ? manualTabs
      : await fetchSheetTabs(category.mitigationSheetUrl);
  const requestedGid =
    rawGid && /^\d+$/.test(rawGid) && tabs.some((t) => t.gid === rawGid)
      ? rawGid
      : null;
  const defaultGid =
    extractSheetGid(category.mitigationSheetUrl) ?? tabs[0]?.gid ?? null;
  const activeGid = requestedGid ?? defaultGid;
  const table = await fetchSheetTable(category.mitigationSheetUrl, activeGid);

  const tabsEditor = canEdit ? (
    <MitigationSheetTabsDialog
      categoryId={category.id}
      sheetUrl={category.mitigationSheetUrl}
      initialTabs={manualTabs}
      autoDetectedCount={manualTabs.length === 0 ? tabs.length : 0}
    />
  ) : null;

  const floorTabs =
    tabs.length > 1 ? (
      <nav
        aria-label="層の切り替え"
        className="flex flex-wrap items-center gap-1"
      >
        {tabs.map((t) => {
          const active = t.gid === activeGid;
          return (
            <Link
              key={t.gid}
              href={t.gid === defaultGid ? "?" : `?gid=${t.gid}`}
              prefetch={false}
              scroll={false}
              aria-current={active ? "page" : undefined}
              className={
                "rounded-md border px-2.5 py-1 font-mono text-[11px] tracking-normal transition-colors " +
                (active
                  ? "border-[var(--neon-cyan)]/60 bg-[var(--neon-cyan)]/12 text-[var(--neon-cyan)]"
                  : "border-border/50 text-muted-foreground hover:border-border hover:text-foreground")
              }
            >
              {t.name}
            </Link>
          );
        })}
        {tabsEditor}
      </nav>
    ) : (
      tabsEditor
    );

  return (
    <div className="flex flex-col gap-4">
      {/* TODO #94: モバイルはカード固定、PC はボタンでシート ⇄ カードを切替。 */}
      {table.ok ? (
        <SheetViewSwitch
          storageKey="raid-repo:sheet-card-mode:mitigation"
          cards={
            <div className="flex flex-col gap-3">
              {floorTabs}
              <SheetCards
                table={table.table}
                sheetUrl={category.mitigationSheetUrl}
                title="軽減表"
                variant="mitigation"
              />
            </div>
          }
          iframe={
            <SheetIframe
              url={category.mitigationSheetUrl}
              title="軽減表"
              emptyHint=""
              categoryId={category.id}
              kind="mitigation"
              canEdit={canEdit}
            />
          }
        />
      ) : (
        <SheetIframe
          url={category.mitigationSheetUrl}
          title="軽減表"
          emptyHint=""
          categoryId={category.id}
          kind="mitigation"
          canEdit={canEdit}
        />
      )}
    </div>
  );
}
