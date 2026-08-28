"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  GripVertical,
  Layers,
  Lock,
  MoreVertical,
  Trash2,
  Pencil,
  Trophy,
  Hourglass,
} from "lucide-react";
import { SUB_TAB_DEFS } from "@/lib/sub-tab-defs";
import { toast } from "sonner";
import { DndContext, closestCenter } from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/portal/empty-state";
import { StatusBadge } from "@/components/portal/status-badge";
// 1.9 (2026-04-28) TODO #11: lazy 化で初期 client bundle から外す
import { CategoryFormDialog } from "@/components/portal/category-form-dialog-lazy";
import {
  formatDurationLong,
  formatDurationShort,
  formatFirstClear,
} from "@/lib/duration-format";
import {
  deleteCategory,
  setCategoryOrder,
  updateCategoryStatus,
  useRealtimeCategories,
} from "@/lib/categories-client";
import {
  applyOptimisticOrder,
  useSortableReorder,
} from "@/lib/use-sortable-reorder";
import { useConfirm } from "@/components/portal/confirm-dialog";
import { isCategoryVisibleToRoles } from "@/lib/category-visibility";
import type { Category, CategoryStatus } from "@/lib/supabase/types";
import { isOptimizableImageHost, isSafeUrl } from "@/lib/url-safe";
import { cn } from "@/lib/utils";

type Props = {
  initialCategories: Category[];
  /**
   * TODO #19: Discord role IDs the current user has, used to keep
   * realtime updates filtered (initialCategories is already filtered
   * server-side).
   */
  userRoleIds: string[];
  /**
   * TODO #21 (2.1): false の場合、編集 UI (DnD ハンドル / ⋮ メニュー /
   * ステータス変更) を全部隠す = 閲覧専用モード。env
   * `DISCORD_ADMIN_ROLE_IDS` 未設定 / または admin ロール持ちなら true。
   */
  canEdit: boolean;
  /** Map of category.id → number of Discord-imported links in the last 7d. */
  recentImportCounts?: Record<string, number>;
  /** Map of category.id → sum of all video durations in seconds. */
  practiceSecondsByCategory?: Record<string, number>;
  /**
   * Map of category.id → sum of video durations posted on/before
   * `first_clear_at` ("time it took to clear"). Empty for categories
   * without a clear date.
   */
  timeToClearByCategory?: Record<string, number>;
};

export function CategoryList({
  initialCategories,
  userRoleIds,
  canEdit,
  recentImportCounts = {},
  practiceSecondsByCategory = {},
  timeToClearByCategory = {},
}: Props) {
  const router = useRouter();
  // Realtime hook keeps the list in sync with DB changes from any client.
  // 2.0 (2026-04-29): /category index は管理ビューとして全件を出すので
  // ここでは role フィルタしない (= 自分が見えないカードも表示)。代わり
  // に各カードに「rolesVisible」を渡し、見えないものは 🔒 + ロール ID
  // バッジで描画して、編集ダイアログから undo できる経路を残す。
  const live = useRealtimeCategories(initialCategories);
  // DnD 並び替えの共通フック (C-1/C-4)。setCategoryOrder で永続化し、
  // 値マッチ (syncOnSettle) で楽観 state を畳む (旧 setTimeout 方式を廃止)。
  const { optimisticOrder, sensors, handleDragEnd, syncOnSettle } =
    useSortableReorder({ persist: setCategoryOrder });
  const confirm = useConfirm();
  // Single edit dialog controlled at the list level. Lifting state here
  // (rather than embedding the dialog inside the per-card menu) avoids the
  // focus collision where a DropdownMenuItem closing immediately re-closes
  // the dialog it just opened.
  const [editTarget, setEditTarget] = useState<Category | null>(null);

  const sorted = useMemo(
    () => applyOptimisticOrder(live, optimisticOrder),
    [live, optimisticOrder],
  );
  // DB 確定順 (live) が楽観順に追いついたら楽観 state を畳む (値マッチ)。
  useEffect(() => {
    syncOnSettle(live.map((c) => c.id));
  }, [live, syncOnSettle]);

  // slugIds は SortableContext の items に渡す。早期 return (sorted.length===0)
  // より前で hook を呼ぶ必要があるため (rules-of-hooks)、sorted の直後に置く。
  // realtime でカテゴリ数が 0↔非0 に遷移しても hook 呼び出し順が変わらない。
  const slugIds = useMemo(() => sorted.map((c) => c.id), [sorted]);

  if (sorted.length === 0) {
    return (
      <EmptyState
        icon={Layers}
        title="コンテンツがありません"
        description="右上の「コンテンツ追加」ボタンから登録できます。"
      />
    );
  }

  const onChangeStatus = async (id: string, status: CategoryStatus) => {
    const result = await updateCategoryStatus(id, status);
    if (!result.ok) {
      toast.error("ステータス更新失敗: " + result.reason);
      return;
    }
    // 2.1 (2026-04-29) hot-fix: server-rendered RSC を再実行して UI を確実に同期。
    router.refresh();
  };

  const onDelete = async (cat: Category) => {
    const ok = await confirm({
      title: `「${cat.name}」を削除しますか？`,
      description: "ロット管理・軽減表・攻略情報もすべて削除されます。",
      confirmText: "削除",
      destructive: true,
    });
    if (!ok) return;
    const result = await deleteCategory(cat.id);
    if (!result.ok) {
      toast.error("削除失敗: " + result.reason);
      return;
    }
    toast.success(`「${cat.name}」を削除しました`);
    // Force a server-side refetch so the row disappears immediately
    // even if Realtime DELETE event filtering hasn't picked it up
    // (REPLICA IDENTITY FULL needed; schema may not have been
    // re-run yet on the user's deployment).
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-2">
      {canEdit && (
        <p className="flex items-center gap-2 font-mono text-[10px] tracking-[0.22em] text-muted-foreground uppercase">
          <span className="inline-flex h-1.5 w-1.5 rounded-full bg-muted-foreground/60" />
          Drag to reorder
          <span className="font-sans text-[11px] tracking-normal normal-case text-muted-foreground/85">
            · ドラッグで並び替え
          </span>
        </p>
      )}
      <DndContext
        // dnd-kit の `useUniqueId` はモジュールレベルのカウンタで
        // `DndDescribedBy-<n>` を採番するため、サーバー (プロセス内で加算され
        // 続ける) とクライアント (0 から) で値がずれ、`aria-describedby` の
        // hydration mismatch を起こす。`id` を明示すると採番を経由せず
        // その値がそのまま使われるので、両者が一致する。
        id="dnd-category-list"
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={canEdit ? (e) => handleDragEnd(e, sorted) : undefined}
      >
        <SortableContext items={slugIds} strategy={rectSortingStrategy}>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {sorted.map((cat) => (
              <SortableCategoryCard
                key={cat.id}
                category={cat}
                viewerCanSee={isCategoryVisibleToRoles(cat, userRoleIds)}
                canEdit={canEdit}
                recentImports={recentImportCounts[cat.id] ?? 0}
                practiceSeconds={practiceSecondsByCategory[cat.id] ?? 0}
                timeToClearSeconds={timeToClearByCategory[cat.id] ?? 0}
                onChangeStatus={(s) => onChangeStatus(cat.id, s)}
                onEdit={() => setEditTarget(cat)}
                onDelete={() => onDelete(cat)}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>

      {/* Single edit dialog — opens for whichever category was clicked.
          Only mounted for admins; the menu that opens it is also gated. */}
      {canEdit && (
        <CategoryFormDialog
          category={editTarget ?? undefined}
          open={editTarget !== null}
          onOpenChange={(o) => {
            if (!o) setEditTarget(null);
          }}
        />
      )}
    </div>
  );
}

function SortableCategoryCard({
  category,
  viewerCanSee,
  canEdit,
  recentImports,
  practiceSeconds,
  timeToClearSeconds,
  onChangeStatus,
  onEdit,
  onDelete,
}: {
  category: Category;
  /**
   * 2.0 (2026-04-29): false の場合、このカードは閲覧 (subpage 遷移)
   * できないユーザに表示されている (= 管理ビュー枠での表示)。視覚的
   * に🔒+ロール ID 数バッジを出して、誤って subpage にナビゲート
   * しないよう抑制し、編集メニュー (⋮) からの undo 経路を促す。
   */
  viewerCanSee: boolean;
  /** 2.1 (TODO #21): 編集 UI (DnD ハンドル / ⋮ / ステータス変更) を出すか。 */
  canEdit: boolean;
  recentImports: number;
  practiceSeconds: number;
  timeToClearSeconds: number;
  onChangeStatus: (s: CategoryStatus) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  // Used by the Trophy badge to navigate to the videos page focused
  // on the clear-day card without firing the parent row Link.
  const router = useRouter();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: category.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : "auto",
  };

  // 2.1 (2026-04-30): Hourglass バッジを status 依存にする (TODO 追加要望)。
  //   - クリア済 → 「クリアまでの累計時間」 (manual ?? timeToClearSeconds)
  //   - それ以外 (練習中 / 休止中 / 未着手) → 「コンテンツ挑戦時間」
  //     (manual ?? practiceSeconds = 全動画 duration の合計)
  // クリア前は firstClearAt が未設定で従来は badge が出なかったが、
  // 練習中カードにも「現時点の挑戦累計」が見えるように value source を
  // 切り替えて常時表示できるようにする。
  const isCleared = category.status === "クリア済";
  const challengeTimeSeconds = isCleared
    ? (category.manualTimeToClearSeconds ?? timeToClearSeconds)
    : (category.manualTimeToClearSeconds ?? practiceSeconds);
  const challengeTimeLabel = isCleared
    ? "クリアまでの累計時間"
    : "コンテンツ挑戦時間";

  // Background image (TODO #17): paint behind the card's glass surface so
  // text and chips remain readable. Validated via `isSafeUrl` to prevent
  // `javascript:` / `data:` URLs from being injected via category edit.
  const bgImageUrl =
    category.backgroundImageUrl && isSafeUrl(category.backgroundImageUrl)
      ? category.backgroundImageUrl
      : null;

  // min-w-0: grid item は min-width:auto のため、空白を含まない長い
  // カテゴリ名 (英数字 1 トークン等) で列幅が押し広げられるのを防ぐ。
  return (
    <li ref={setNodeRef} style={style} {...attributes} className="min-w-0">
      <Card
        className={cn(
          "glass neon-edge group relative flex items-stretch gap-2 p-0 transition-transform hover:-translate-y-0.5",
          // 2.0 (2026-04-29): viewer cannot view → 視覚的に「ロック中」を
          // 示すため彩度を落とす + 枠を amber 寄りにずらす。クリックすると
          // /auth/denied に飛ぶが、編集メニューから role 解除可能。
          !viewerCanSee && "opacity-70 ring-1 ring-badge-accent/30",
        )}
      >
        {bgImageUrl && (
          <>
            {/* TODO #11/#17 (2.1+): next/Image fill で WebP / srcset を
                自動配信。Supabase Storage (`*.supabase.co`) のみ最適化対象、
                他ホスト (imgur 等) は `unoptimized` で素通し。 */}
            <Image
              src={bgImageUrl}
              alt=""
              aria-hidden
              fill
              sizes="(min-width: 1024px) 50vw, 100vw"
              loading="lazy"
              unoptimized={!isOptimizableImageHost(bgImageUrl)}
              className="pointer-events-none rounded-xl object-cover object-center opacity-40"
            />
            {/* Dark gradient overlay so foreground text/badges remain
                readable regardless of image brightness. */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 rounded-xl bg-gradient-to-r from-background/55 via-background/30 to-background/55"
            />
          </>
        )}
        {canEdit && (
          <button
            type="button"
            {...listeners}
            aria-label={`${category.name} の並び替えハンドル`}
            className="relative z-10 flex shrink-0 cursor-grab items-center justify-center rounded-l-lg border-r border-border/40 bg-secondary/30 px-2 text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground active:cursor-grabbing"
          >
            <GripVertical className="h-4 w-4" aria-hidden />
          </button>
        )}

        {/* Middle column: name+slug+badges (one Link for the default-action
            click-anywhere behavior) above an always-visible icon row that
            short-cuts to each sub-page. Icon row is OUTSIDE the parent
            Link to keep nested-anchor invalid HTML out of the tree. */}
        <div className="relative z-10 flex min-w-0 flex-1 flex-col">
          <Link
            href={`/category/${category.slug}/${category.defaultTab}`}
            prefetch={false}
            className="flex flex-col gap-1 px-4 pt-4 pb-1"
          >
            <div className="flex min-w-0 items-start justify-between gap-2">
              {/* F-4 (2026-06-14): カード第 1 階層 = 名前を強調 (font-medium 付与)。
                  サイズは text-sm 据置で長い名前の折返しを回避しつつ、右カラムの
                  メトリクス群 (9px) との階層差を太さで明確化。
                  min-w-0 + break-words: 空白なしの長トークン名でも flex 列を
                  押し広げず語中で折り返す (通常の日本語名には影響しない)。 */}
              <p className="min-w-0 font-display break-words text-foreground text-sm font-medium leading-tight tracking-[0.04em]">
                {category.name}
              </p>
              {!viewerCanSee && (
                <span
                  className="inline-flex shrink-0 items-center gap-1 rounded-sm border border-badge-accent/40 bg-badge-accent/10 px-1.5 py-px font-mono text-[9px] tracking-[0.18em] text-badge-accent-fg uppercase"
                  title={`このコンテンツは ${category.requiredRoleIds.length} 個のロールに制限されています (あなたは閲覧不可)`}
                >
                  <Lock className="h-2.5 w-2.5" aria-hidden />
                  {category.requiredRoleIds.length}
                </span>
              )}
            </div>
            <p className="mt-1 font-mono break-all text-[11px] tracking-[0.18em] text-muted-foreground uppercase">
              /{category.slug}
            </p>
            {/* 2.1 (2026-04-29): Timer (累計練習時間) は card 上に出さない
                方針 (ユーザー要望)。Trophy + Hourglass のみ右カラムで表示。 */}
          </Link>

          <SubPageShortcuts
            slug={category.slug}
            tabConfig={category.tabConfig}
            statusSlot={
              <span
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
              >
                <StatusBadge
                  status={category.status}
                  onChange={canEdit ? onChangeStatus : undefined}
                  readOnly={!canEdit}
                  variant="compact"
                />
              </span>
            }
          />
        </div>

        {/* 2.1 (2026-04-29) 右カラムレイアウト (Status は SubPageShortcuts
            行に移設済み)。
                ┌──────────────────────┐
                │   [Trophy YYYY/MM/DD]│  ← クリア日 (ボタン)
                │     [Hourglass time] │  ← クリアまでの累計時間
                │       [+N/wk] [⋮]    │  ← +N/wk と ⋮ の横並び
                └──────────────────────┘
            すべて `items-end` で右端揃え。Trophy/Hourglass/+N/wk が
            無いカードでも `invisible` placeholder で行を確保しカード
            高さを固定 (ユーザー要望、2026-04-29)。 */}
        <div className="relative z-10 flex flex-col items-end justify-between gap-1 p-2">
          <div className="flex flex-col items-end gap-1">
            {category.firstClearAt ? (
              <button
                type="button"
                onClick={(e) => {
                  // 2.1 (2026-04-29): Trophy を <Link> 外に移したので
                  // preventDefault は不要。Card 自身に handler は無いが
                  // 念のため stopPropagation で伝播を抑止。
                  // `scroll: false` は Next.js 16 が遷移時に top へ
                  // auto-scroll するのを抑止し、videos-list.tsx 側の
                  // scrollIntoView を効かせるための指定。
                  e.stopPropagation();
                  const iso = category.firstClearAt!.slice(0, 10);
                  router.push(
                    `/category/${category.slug}/videos?focusDate=${iso}`,
                    { scroll: false },
                  );
                }}
                className="inline-flex items-center gap-1 rounded-sm border border-badge-accent/45 bg-badge-accent/10 px-1.5 py-px font-mono text-[9px] tracking-[0.18em] text-badge-accent-fg uppercase transition-colors hover:border-badge-accent/80 hover:bg-badge-accent/20"
                title={`初クリア: ${formatFirstClear(category.firstClearAt, "long")} (クリックでクリア日の動画へジャンプ)`}
              >
                <Trophy className="h-2.5 w-2.5" aria-hidden />
                {formatFirstClear(category.firstClearAt, "short")}
              </button>
            ) : (
              // Trophy が無いカードでもサイズを揃える placeholder。
              <span
                aria-hidden
                className="invisible inline-flex items-center gap-1 rounded-sm border px-1.5 py-px font-mono text-[9px] tracking-[0.18em] uppercase"
              >
                <Trophy className="h-2.5 w-2.5" aria-hidden />
                0000-00-00
              </span>
            )}
            {challengeTimeSeconds > 0 ? (
              <span
                // 2.1 (2026-04-29): 累計時間の "21h5m" は uppercase だと
                // "21H5M" になり H/M 等のアルファベットが圧縮されて見える
                // ので uppercase を外し小文字維持。
                // 2.1 (2026-04-30): クリア済以外は label が「コンテンツ挑戦時間」、
                // 矢印 "→" を出さず時間だけ表示 (クリアは未到達なので向き先が無い)。
                // 2.1 (2026-04-30) 追補: 配色も status で変える。クリア済 = emerald
                // (クリア達成感)、未クリア = violet (進行中・練習感)。これで
                // 一覧上でクリア状況が色だけで一目で判別できる。
                className={
                  "inline-flex items-center gap-1 rounded-sm border px-1.5 py-px font-mono text-[9px] tracking-[0.18em] " +
                  (isCleared
                    ? "border-badge-clear/45 bg-badge-clear/10 text-badge-clear-fg"
                    : "border-badge-progress/45 bg-badge-progress/10 text-badge-progress-fg")
                }
                title={`${challengeTimeLabel}: ${formatDurationLong(challengeTimeSeconds)}${category.manualTimeToClearSeconds !== null ? " (手動入力)" : ""}`}
              >
                <Hourglass className="h-2.5 w-2.5" aria-hidden />
                {isCleared ? "→" : ""}
                {formatDurationShort(challengeTimeSeconds)}
              </span>
            ) : (
              // Hourglass が無いカードでもサイズを揃える placeholder。
              <span
                aria-hidden
                className="invisible inline-flex items-center gap-1 rounded-sm border px-1.5 py-px font-mono text-[9px] tracking-[0.18em]"
              >
                <Hourglass className="h-2.5 w-2.5" aria-hidden />
                →000h
              </span>
            )}
            <div className="flex items-center gap-1">
              {recentImports > 0 ? (
                <span
                  className="inline-flex items-center gap-1 rounded-sm border border-badge-recent/40 bg-badge-recent/10 px-1.5 py-px font-mono text-[9px] tracking-[0.18em] text-badge-recent-fg uppercase"
                  title={`過去7日で Discord から ${recentImports} 件取り込み`}
                >
                  +{recentImports}/wk
                </span>
              ) : (
                // Discord 取り込みが無いカードでも +N/wk と同じ幅を
                // `invisible` で確保し、⋮ の位置がぶれないようにする。
                <span
                  aria-hidden
                  className="invisible inline-flex items-center gap-1 rounded-sm border px-1.5 py-px font-mono text-[9px] tracking-[0.18em] uppercase"
                >
                  +0/wk
                </span>
              )}
              {canEdit && <CategoryMenu onEdit={onEdit} onDelete={onDelete} />}
            </div>
          </div>
        </div>
      </Card>
    </li>
  );
}

/**
 * Always-visible 4-icon shortcut row at the bottom of each category card
 * for direct navigation to mitigation / loot / strategy / videos sub-pages.
 *
 * Why always visible (rather than hover-only):
 *   - Touch devices have no hover state, so a hover-reveal would hide
 *     this navigation completely on mobile
 *   - Icon-row is small enough to not clutter the card
 *   - Hover styling (scale + color shift) still gives desktop users the
 *     "this is interactive" affordance
 */
// タブ定義は `@/lib/sub-tab-defs` に集約 (旧: この 3 ファイルに同じ配列を
// コピーしていたため、タブ追加時にここだけ更新漏れが起きていた)。
const SUB_PAGES = SUB_TAB_DEFS;

function SubPageShortcuts({
  slug,
  tabConfig,
  statusSlot,
}: {
  slug: string;
  /**
   * 2.9 (2026-06-12): カテゴリごとのタブ設定。enabled=false のタブは
   * アイコン行から除外、label が非空なら tooltip / aria-label を上書き
   * (sub-tabs.tsx の描画判定と同一)。
   */
  tabConfig?: Category["tabConfig"];
  /** 2.1 (2026-04-29): 行の右端に StatusBadge を配置するためのスロット。 */
  statusSlot?: React.ReactNode;
}) {
  return (
    <nav
      aria-label="サブページへのショートカット"
      // 2.1 (2026-04-29): 右パディングを `pr-2` (右カラム `p-2` と同値) に
      // 揃え、Status の右端を Trophy/Hourglass の右端と一致させる
      // (= レイアウト変更なし、padding のみ調整)。
      className="flex items-center gap-1 pt-1 pr-2 pb-3 pl-3"
    >
      {SUB_PAGES.map((p) => {
        const cfg = tabConfig?.[p.segment];
        if (cfg?.enabled === false) return null;
        const labelOverride = cfg?.label?.trim();
        const label = labelOverride ? labelOverride : p.label;
        return (
          <Link
            key={p.segment}
            href={`/category/${slug}/${p.segment}`}
            prefetch={false}
            aria-label={label}
            title={label}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border/40 bg-background/30 text-muted-foreground transition-all duration-150 hover:scale-110 hover:border-[var(--neon-violet)]/60 hover:bg-[var(--neon-violet)]/10 hover:text-[var(--neon-violet)] hover:shadow-[0_0_10px_-4px_var(--neon-violet)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--neon-violet)]/60 active:scale-95"
          >
            <p.Icon className="h-3.5 w-3.5" aria-hidden />
          </Link>
        );
      })}
      {statusSlot && <span className="ml-auto">{statusSlot}</span>}
    </nav>
  );
}

function CategoryMenu({
  onEdit,
  onDelete,
}: {
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <span
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <DropdownMenu>
        <DropdownMenuTrigger
          className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-all hover:bg-secondary/60 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-95"
          aria-label="コンテンツメニュー"
        >
          <MoreVertical className="h-3.5 w-3.5" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={4} className="glass-popup min-w-40">
          <DropdownMenuItem
            onClick={onEdit}
            className="flex cursor-pointer items-center gap-2"
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden />
            <span className="text-sm">編集</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={onDelete}
            className="flex cursor-pointer items-center gap-2 text-rose-300 focus:text-rose-200"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
            <span className="text-sm">削除</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}
