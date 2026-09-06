import Link from "next/link";
import { SheetIframe } from "@/components/portal/sheet-iframe";
import { SheetCards } from "@/components/portal/sheet-cards";
import { SheetViewSwitch } from "@/components/portal/sheet-view-switch";
import { SheetUrlOnboarding } from "@/components/portal/sheet-url-onboarding";
import { fetchSheetTable, fetchSheetTabs } from "@/lib/server/sheet-table";
import {
  diagnoseSheetColumns,
  extractSheetGid,
  parseColumnLabelsSetting,
  findAbilityHeaderRows,
  buildAutoColumnLabels,
  parseSheetTabsSetting,
} from "@/lib/sheet-csv";
import { MitigationColumnsDialog } from "@/components/portal/mitigation-columns-dialog";
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
  // 2026-09-04: タブ一覧 → シート本体の **直列待ち** を解消する (実機報告
  // 「外部サービスの読み込みにラグを感じる」)。旧実装はタブを取ってから
  // gid を決めて本体を取っていたので、外部への往復が 2 回直列に並んでいた。
  //
  // 実際にはタブ一覧が要るのは「?gid も URL の gid も無い」ときだけなので、
  // 先に決まる gid (?gid → URL の gid) で本体の取得を **同時に** 走らせる。
  // 通常のシートは URL に gid を持つので、これで往復は 1 回分の時間になる。
  //
  // ⚠ 先読みに使う gid は **登録済みの層に限る**。`?gid=` は閲覧者が自由に
  // 付けられるクエリなので、数字でありさえすれば取りに行く形にすると
  // 「未知の gid で外向き fetch を誘発できる」経路になる (旧実装はタブ一覧と
  // 突き合わせてから取得していたので、その性質を落とさない)。手動登録が
  // あればタブ一覧を待たずに突き合わせられるので、先読みはそのときだけ。
  const urlGid = extractSheetGid(category.mitigationSheetUrl);
  const preValidatedGid =
    rawGid && /^\d+$/.test(rawGid) && manualTabs.some((t) => t.gid === rawGid)
      ? rawGid
      : null;
  const provisionalGid = preValidatedGid ?? urlGid;
  const [tabs, provisionalTable] = await Promise.all([
    manualTabs.length > 0
      ? Promise.resolve(manualTabs)
      : fetchSheetTabs(category.mitigationSheetUrl),
    fetchSheetTable(category.mitigationSheetUrl, provisionalGid),
  ]);
  const requestedGid =
    rawGid && /^\d+$/.test(rawGid) && tabs.some((t) => t.gid === rawGid)
      ? rawGid
      : null;
  const defaultGid = urlGid ?? tabs[0]?.gid ?? null;
  const activeGid = requestedGid ?? defaultGid;
  // 先読みした gid と最終的な gid が食い違うのは「URL に gid が無く、タブ
  // 一覧の先頭に落ちた」場合だけ。そのときだけ取り直す (同一 gid なら
  // React cache が効くので二重取得にはならない)。
  const table =
    activeGid === provisionalGid
      ? provisionalTable
      : await fetchSheetTable(category.mitigationSheetUrl, activeGid);

  // 2026-08-30: 列の判定結果 + チェック列の名前登録 (実機報告
  // 「Type や軽減率は出ているがそれ以外は情報なし」の切り分け導線)。
  const manualLabels = parseColumnLabelsSetting(
    category.mitigationColumnLabels,
    activeGid,
  );

  // 2026-08-31 (実物の xlsx を解析): 軽減表テンプレートは列ごとに
  // 「ジョブ名 / アビリティ名 / 対象種別」の 3 行を持ち、アイコンはその
  // アビリティ名で引かれているだけだった。つまり**名前は CSV に出ている**。
  // 画像から逆算する必要はなく、この行を読めば手入力なしで名前が付く。
  const grid = table.ok
    ? [table.table.headers, ...table.table.rows]
    : ([] as string[][]);
  const firstPass = table.ok ? diagnoseSheetColumns(table.table) : [];
  const headerRows = table.ok
    ? findAbilityHeaderRows(
        grid,
        firstPass.filter((c) => c.role === "check").map((c) => c.index),
      )
    : null;
  // 見出し 3 行はデータではない。判定にもカードにも混ぜない。
  const ignoreRows = new Set<number>();
  if (headerRows) {
    for (const r of [
      headerRows.jobRow,
      headerRows.abilityRow,
      headerRows.targetRow,
    ]) {
      // grid は headers を 0 行目とするので table.rows へは -1 で写す。
      if (r !== null && r >= 1) ignoreRows.add(r - 1);
    }
  }
  const autoLabels =
    headerRows && table.ok ? buildAutoColumnLabels(grid, headerRows) : {};
  // 手動登録は自動判定より優先する (シート側の名前が実態と違うこともある)。
  const columnLabels: Record<number, string> = {};
  for (const [k, v] of Object.entries(autoLabels)) {
    columnLabels[Number(k)] = v.job ? `${v.name} (${v.job})` : v.name;
  }
  for (const [k, v] of Object.entries(manualLabels)) {
    columnLabels[Number(k)] = v;
  }

  const columnsEditor =
    canEdit && table.ok ? (
      <MitigationColumnsDialog
        categoryId={category.id}
        gid={activeGid ?? ""}
        // 見出し行が無ければ firstPass と同じ結果になるので再スキャンしない
        // (表は数百行 × 数十列になることがある)。
        columns={
          ignoreRows.size > 0
            ? diagnoseSheetColumns(table.table, ignoreRows)
            : firstPass
        }
        initialLabels={manualLabels}
        autoLabels={autoLabels}
      />
    ) : null;

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
        {columnsEditor}
      </nav>
    ) : (
      <div className="flex flex-wrap items-center gap-1">
        {tabsEditor}
        {columnsEditor}
      </div>
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
                columnLabels={columnLabels}
                ignoreRows={ignoreRows}
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
