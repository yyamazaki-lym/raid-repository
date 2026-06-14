"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  GripVertical,
  ImagePlus,
  Loader2,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { DndContext, closestCenter } from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Card } from "@/components/ui/card";
// Phase 15 (2026-05-13): 攻略タブの「画像」セクション。
// strategy-list.tsx の SortableStrategyCard を model にしつつ、画像表示
// 専用に簡素化。クリックで Lightbox を開き、編集 / 削除は既存の
// LinkCardMenu を再利用 (kind に依存しない title/url/description のみ操作)。
// Phase 16 (2026-05-13): kind='gphoto' (Google フォト) も同セクションに統合。
// アルバム所属分のみアルバム単位でセクション分け、それ以外は image と
// 同じ「ばら」grid に並ぶ。
import { ImageFormDialog } from "@/components/portal/image-form-dialog-lazy";
import { LinkCardMenu } from "@/components/portal/link-card-menu-lazy";
import { ActionSlot } from "@/components/portal/action-slot";
import {
  deleteGphotoAlbum,
  setCategoryLinkOrder,
  syncGphotoAlbum,
  useRealtimeCategoryLinks,
  useRealtimeGphotoAlbums,
} from "@/lib/category-links-client";
import {
  applyOptimisticOrder,
  useSortableReorder,
} from "@/lib/use-sortable-reorder";
import { useConfirm } from "@/components/portal/confirm-dialog";
import { isOptimizableImageHost, safeHref } from "@/lib/url-safe";
import { jstDateTimeString } from "@/lib/jst-date";
import { useCollapsible } from "@/lib/use-collapsible";
import type {
  CategoryGphotoAlbum,
  CategoryLink,
} from "@/lib/supabase/types";

type Props = {
  categoryId: string;
  initialImages: CategoryLink[];
  initialGphotos: CategoryLink[];
  initialAlbums: CategoryGphotoAlbum[];
};

export function StrategyImagesList({
  categoryId,
  initialImages,
  initialGphotos,
  initialAlbums,
}: Props) {
  const liveImages = useRealtimeCategoryLinks(
    categoryId,
    "image",
    initialImages,
  );
  const liveGphotos = useRealtimeCategoryLinks(
    categoryId,
    "gphoto",
    initialGphotos,
  );
  const albums = useRealtimeGphotoAlbums(categoryId, initialAlbums);

  const [editTarget, setEditTarget] = useState<CategoryLink | null>(null);
  // DnD 並び替えの共通フック (C-1/C-4)。
  const { optimisticOrder, sensors, handleDragEnd, syncOnSettle } =
    useSortableReorder({ persist: setCategoryLinkOrder });
  // Phase 17 (2026-05-13): Lightbox を「集合 + 現在 id」モデルに拡張。
  // 同じ集合の中で左右に前後画像へ遷移できるようにするため、Lightbox を
  // 開いた時点でどのリスト (loose or album:<id>) を集合とするかを保持する。
  const [lightbox, setLightbox] = useState<{
    setKey: "loose" | `album:${string}`;
    currentId: string;
  } | null>(null);

  // 「ばら」セクション用: kind=image 全件 + アルバム未所属の gphoto。
  // sortOrder + createdAt で素直に整列したものを基準とし、optimistic 並び
  // 替え中だけ手動 index 順で上書きする。
  // sortOrder + createdAt で整列した DB 確定順 (optimistic 適用前)。
  const looseBase = useMemo<CategoryLink[]>(() => {
    return [
      ...liveImages,
      ...liveGphotos.filter((l) => l.gphotoAlbumId === null),
    ].sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return a.createdAt.localeCompare(b.createdAt);
    });
  }, [liveImages, liveGphotos]);

  // optimistic 並び替え中だけ手動 index 順で上書きする。
  const looseLinks = useMemo(
    () => applyOptimisticOrder(looseBase, optimisticOrder),
    [looseBase, optimisticOrder],
  );
  // DB 確定順 (looseBase) が楽観順に追いついたら畳む (値マッチ)。
  useEffect(() => {
    syncOnSettle(looseBase.map((l) => l.id));
  }, [looseBase, syncOnSettle]);

  // アルバム所属 gphoto を albumId 別にグループ化。
  const albumChildren = useMemo(() => {
    const m = new Map<string, CategoryLink[]>();
    for (const link of liveGphotos) {
      if (!link.gphotoAlbumId) continue;
      const list = m.get(link.gphotoAlbumId) ?? [];
      list.push(link);
      m.set(link.gphotoAlbumId, list);
    }
    for (const list of m.values()) {
      list.sort((a, b) => {
        if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
        return a.createdAt.localeCompare(b.createdAt);
      });
    }
    return m;
  }, [liveGphotos]);

  const totalCount =
    liveImages.length + liveGphotos.length;

  const looseIds = useMemo(
    () => looseLinks.map((l) => l.id),
    [looseLinks],
  );

  // Lightbox 表示中の集合 (ばら全件 or 特定アルバム配下) を、現在のリスト
  // 状態から都度再計算する。集合が空になっていたら閉じる扱いにする。
  const lightboxLinks = useMemo<CategoryLink[]>(() => {
    if (!lightbox) return [];
    if (lightbox.setKey === "loose") return looseLinks;
    const albumId = lightbox.setKey.slice("album:".length);
    return albumChildren.get(albumId) ?? [];
  }, [lightbox, looseLinks, albumChildren]);

  const onOpenLooseLightbox = (id: string) =>
    setLightbox({ setKey: "loose", currentId: id });
  const onOpenAlbumLightbox = (albumId: string, id: string) =>
    setLightbox({ setKey: `album:${albumId}`, currentId: id });

  // Phase 17: セクション折りたたみ。strategy-list と同じ localStorage 命名規則。
  const [collapsed, setCollapsed] = useCollapsible(
    "raid-repo:strategy-section-collapsed:images",
    false,
  );

  return (
    <section className="flex flex-col gap-3 border-t border-border/30 pt-4">
      {/* TODO #7 (2026-06-10): strategy-list と同型のモバイル幅対策
          (flex-wrap + whitespace-nowrap + ドラッグヒント sm 未満非表示)。 */}
      <div className="flex flex-wrap items-center justify-between gap-y-1.5">
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          aria-expanded={!collapsed}
          aria-controls="strategy-images-body"
          className="inline-flex items-center gap-1 font-mono text-[10px] tracking-[0.2em] whitespace-nowrap text-muted-foreground uppercase transition-colors hover:text-foreground"
        >
          {collapsed ? (
            <ChevronRight className="h-3 w-3" aria-hidden />
          ) : (
            <ChevronDown className="h-3 w-3" aria-hidden />
          )}
          <span>
            Images · {totalCount} image{totalCount === 1 ? "" : "s"}
          </span>
          {!collapsed && looseLinks.length > 1 && (
            <span className="ml-2 hidden text-muted-foreground/60 sm:inline">
              · ドラッグで並び替え
            </span>
          )}
        </button>
        {/* SubTabs が stuck 状態になったら ActionSlot 経由で SubTabs 右端に
            portal される (strategy-list の「サムネ + 攻略リンク追加」と同じ
            target を共有。Phase 16 で Google フォト URL 判定を
            ImageFormDialog 内に統合したため、ボタンは 1 つに集約。 */}
        <ActionSlot>
          <ImageFormDialog categoryId={categoryId} />
        </ActionSlot>
      </div>

      {!collapsed && (
        <div id="strategy-images-body" className="flex flex-col gap-3">
          {totalCount === 0 && albums.length === 0 ? (
        <Card className="glass flex flex-col items-center gap-3 p-10 text-center">
          <span className="grid h-10 w-10 place-items-center rounded-md border border-[var(--neon-magenta)]/40 bg-background/40 text-[var(--neon-magenta)]">
            <ImagePlus className="h-4 w-4" aria-hidden />
          </span>
          <p className="font-display text-foreground text-sm">画像未登録</p>
          <p className="text-muted-foreground max-w-md text-xs leading-relaxed">
            散開図 / スクリーンショット / 図解画像をアップロード・URL 指定、または
            Google フォト共有 URL で一括登録できます。
          </p>
        </Card>
      ) : (
        <>
          {looseLinks.length > 0 && (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={(e) => handleDragEnd(e, looseLinks)}
            >
              <SortableContext items={looseIds} strategy={rectSortingStrategy}>
                <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {looseLinks.map((link) => (
                    <SortableImageCard
                      key={link.id}
                      link={link}
                      onOpen={() => onOpenLooseLightbox(link.id)}
                      onEdit={() => setEditTarget(link)}
                    />
                  ))}
                </ul>
              </SortableContext>
            </DndContext>
          )}

          {albums.map((album) => (
            <AlbumSection
              key={album.id}
              album={album}
              links={albumChildren.get(album.id) ?? []}
              onOpenImage={(id) => onOpenAlbumLightbox(album.id, id)}
              onEditImage={(link) => setEditTarget(link)}
            />
          ))}
        </>
      )}
        </div>
      )}

      <ImageFormDialog
        categoryId={categoryId}
        link={editTarget ?? undefined}
        open={editTarget !== null}
        onOpenChange={(o) => {
          if (!o) setEditTarget(null);
        }}
      />

      <ImageLightbox
        links={lightboxLinks}
        currentId={lightbox?.currentId ?? null}
        onCurrentIdChange={(nextId) => {
          if (!lightbox) return;
          if (nextId === null) setLightbox(null);
          else setLightbox({ ...lightbox, currentId: nextId });
        }}
      />
    </section>
  );
}

function SortableImageCard({
  link,
  onOpen,
  onEdit,
}: {
  link: CategoryLink;
  onOpen: () => void;
  onEdit: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: link.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : "auto",
  };

  const src = safeHref(link.url);

  return (
    <li ref={setNodeRef} style={style} {...attributes}>
      <Card className="glass neon-edge group flex items-stretch gap-0 overflow-hidden p-0 transition-transform hover:-translate-y-0.5">
        <button
          type="button"
          {...listeners}
          aria-label={`${link.title} の並び替えハンドル`}
          className="flex shrink-0 cursor-grab items-center justify-center border-r border-border/40 bg-secondary/30 px-2 text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground active:cursor-grabbing"
        >
          <GripVertical className="h-4 w-4" aria-hidden />
        </button>

        <div className="flex min-w-0 flex-1 flex-col">
          {src ? (
            <button
              type="button"
              onClick={onOpen}
              aria-label={`${link.title} を拡大表示`}
              className="relative block aspect-video overflow-hidden bg-secondary/30 cursor-zoom-in"
            >
              <Image
                src={src}
                alt={link.title}
                fill
                sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                className="object-cover transition-transform group-hover:scale-105"
                loading="lazy"
                unoptimized={!isOptimizableImageHost(src)}
              />
            </button>
          ) : (
            <div className="flex aspect-video items-center justify-center bg-secondary/30 text-xs text-muted-foreground">
              画像URL不正
            </div>
          )}
          <div className="flex items-start gap-2 px-3 pt-2 pb-1">
            <span className="flex-1 break-words font-display text-sm text-foreground">
              {link.title}
            </span>
            <LinkCardMenu link={link} onEdit={onEdit} />
          </div>
          {link.description && (
            <p className="px-3 pb-3 text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap">
              {link.description}
            </p>
          )}
        </div>
      </Card>
    </li>
  );
}

/**
 * Lightbox modal. base-ui Dialog のオーバーレイ + 中央配置をフルサイズに
 * 上書きし、画像を `object-contain` で原比率表示。閉じる手段:
 *   - 右上 ✕ ボタン
 *   - esc キー (Dialog primitive 標準)
 *   - 画像外の黒い余白クリック / タップ (画像本体クリックは閉じない)
 *
 * 画像本体は素の `<img>` を使う。`<Image fill>` だと img element が親
 * box 全域を覆い、object-contain の透明 letterbox 領域もクリック判定が
 * img になってしまうため「画像外」が成立しなかった。`<img>` + max-h/max-w
 * full + object-contain なら img の box が画像の natural aspect に絞られ、
 * 周囲の余白は親 div のクリック判定になる (= 閉じる)。
 * Lightbox は拡大用なので Next.js Image Optimization は捨てて問題なし。
 *
 * Phase 17 (2026-05-13): 集合 + 現在 id モデルに拡張。複数枚あるアルバム /
 * セクションで「左右クリック」「←→ キー」「スワイプ」による前後遷移を
 * サポート。集合が空 / currentId が見つからない場合は閉じる扱い。
 * 端到達時は循環 (wrap) する。
 */
function ImageLightbox({
  links,
  currentId,
  onCurrentIdChange,
}: {
  links: CategoryLink[];
  currentId: string | null;
  onCurrentIdChange: (nextId: string | null) => void;
}) {
  const idx = currentId
    ? links.findIndex((l) => l.id === currentId)
    : -1;
  const open = currentId !== null && idx >= 0;
  const link = open ? links[idx] : null;
  const src = link ? safeHref(link.url) : undefined;
  const hasMultiple = links.length > 1;

  const close = () => onCurrentIdChange(null);
  const goPrev = () => {
    if (!hasMultiple) return;
    const next = links[(idx - 1 + links.length) % links.length];
    if (next) onCurrentIdChange(next.id);
  };
  const goNext = () => {
    if (!hasMultiple) return;
    const next = links[(idx + 1) % links.length];
    if (next) onCurrentIdChange(next.id);
  };

  // キーボード ← → で前後移動。Esc は Dialog primitive 側が拾うのでここでは扱わない。
  // base-ui の DialogContent は bubble 段階で keydown を捕まえて
  // stopPropagation するため window への伝播が起きないケースがある。
  // capture phase で先取りすることで Dialog primitive の挙動に依らず動かす。
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goNext();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // goPrev/goNext は idx 依存で毎レンダー新規だが、最新を見ればよいので
    // 依存配列に含めず eslint-disable で済ます (key 押下時の closure が
    // 古くても 1 step 分しかズレないため UX 上問題なし)。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, idx, links.length]);

  // 集合が空 / currentId が消えた場合は閉じる (削除や同期で消えたケース)。
  useEffect(() => {
    if (currentId !== null && idx < 0) {
      onCurrentIdChange(null);
    }
  }, [currentId, idx, onCurrentIdChange]);

  // タッチスワイプで前後移動。最終 X 差分が ±50px 超なら遷移。
  const touchStartX = useRef<number | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0]?.clientX ?? null;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touchStartX.current;
    touchStartX.current = null;
    if (start === null) return;
    const end = e.changedTouches[0]?.clientX ?? start;
    const diff = end - start;
    if (Math.abs(diff) < 50) return;
    if (diff > 0) goPrev();
    else goNext();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) close();
      }}
    >
      <DialogContent
        className="grid h-[100svh] max-h-none w-screen max-w-[100vw] -translate-x-1/2 -translate-y-1/2 grid-rows-[1fr_auto] gap-0 rounded-none border-0 bg-black/85 p-0 ring-0 sm:max-w-[100vw]"
        showCloseButton={true}
      >
        {/* sr-only タイトル — Dialog の a11y 警告対策 */}
        <DialogTitle className="sr-only">
          {link?.title ?? "画像"}
        </DialogTitle>
        {src ? (
          <div
            className="relative flex min-h-0 cursor-zoom-out items-center justify-center overflow-hidden"
            onClick={close}
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
            role="button"
            tabIndex={-1}
            aria-label="画像を閉じる"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt={link?.title ?? ""}
              className={
                "max-h-full max-w-full object-contain select-none " +
                (hasMultiple ? "cursor-pointer" : "cursor-default")
              }
              // Phase 17 (2026-05-13): 画像本体クリックでも左右半分判定で
              // 前後遷移できるようにする。stopPropagation で背景クリック
              // (= 閉じる) は発火させず、img bounding rect 内の clientX 位置で
              // 前 / 次を決める。単独画像のときは clickable 化しない。
              onClick={(e) => {
                e.stopPropagation();
                if (!hasMultiple) return;
                const rect = (
                  e.currentTarget as HTMLImageElement
                ).getBoundingClientRect();
                const x = e.clientX - rect.left;
                if (x < rect.width / 2) goPrev();
                else goNext();
              }}
              draggable={false}
            />
            {hasMultiple && (
              <>
                <button
                  type="button"
                  aria-label="前の画像"
                  onClick={(e) => {
                    e.stopPropagation();
                    goPrev();
                  }}
                  className="absolute top-1/2 left-2 -translate-y-1/2 rounded-full bg-black/40 p-2 text-white/80 transition-colors hover:bg-black/70 hover:text-white sm:left-4"
                >
                  <ChevronLeft className="h-6 w-6" aria-hidden />
                </button>
                <button
                  type="button"
                  aria-label="次の画像"
                  onClick={(e) => {
                    e.stopPropagation();
                    goNext();
                  }}
                  className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full bg-black/40 p-2 text-white/80 transition-colors hover:bg-black/70 hover:text-white sm:right-4"
                >
                  <ChevronRight className="h-6 w-6" aria-hidden />
                </button>
                <span
                  aria-hidden
                  className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/50 px-3 py-1 font-mono text-[10px] tracking-[0.18em] text-white/70 uppercase"
                >
                  {idx + 1} / {links.length}
                </span>
              </>
            )}
          </div>
        ) : (
          <div
            className="flex items-center justify-center text-sm text-white/70"
            onClick={close}
          >
            画像を読み込めませんでした
          </div>
        )}
        {(link?.title || link?.description) && (
          <div className="flex flex-col gap-1 border-t border-white/10 bg-black/50 px-4 py-3 text-white">
            {link?.title && (
              <p className="font-display text-sm">{link.title}</p>
            )}
            {link?.description && (
              <p className="text-xs text-white/70 whitespace-pre-wrap">
                {link.description}
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Phase 16 (2026-05-13): 1 つの Google フォトアルバムを 1 セクションとして
 * 描画。ヘッダにアルバムメタと「同期 / 削除 / 共有元を開く」操作、本体に
 * 子画像 grid (DnD なし、アルバム内並び替えは同期で振り直されるため初期版
 * では機能を出さない)。
 */
function AlbumSection({
  album,
  links,
  onOpenImage,
  onEditImage,
}: {
  album: CategoryGphotoAlbum;
  links: CategoryLink[];
  onOpenImage: (id: string) => void;
  onEditImage: (link: CategoryLink) => void;
}) {
  const [syncing, setSyncing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const confirm = useConfirm();
  // Phase 17 (2026-05-13): アルバム単位の折りたたみ。localStorage key は
  // album.id を含めて個別保持 (削除されたアルバムの key はそのまま残置 = 害なし)。
  const [collapsed, setCollapsed] = useCollapsible(
    `raid-repo:gphoto-album-collapsed:${album.id}`,
    false,
  );

  const onSync = async () => {
    if (syncing) return;
    setSyncing(true);
    const result = await syncGphotoAlbum(album.id);
    setSyncing(false);
    if (!result.ok) {
      toast.error("同期に失敗: " + result.reason);
      return;
    }
    if (result.added === 0 && result.removed === 0) {
      toast.success(`変更なし (${result.total} 枚)`);
    } else {
      toast.success(
        `同期完了: +${result.added} / -${result.removed} (合計 ${result.total} 枚)`,
      );
    }
  };

  const onDelete = async () => {
    if (deleting) return;
    const label = album.title ?? "Google フォト";
    const ok = await confirm({
      title: `「${label}」のアルバムを削除しますか？`,
      description: `含まれる画像 ${links.length} 枚も削除されます。`,
      confirmText: "削除",
      destructive: true,
    });
    if (!ok) return;
    setDeleting(true);
    const result = await deleteGphotoAlbum(album.id);
    setDeleting(false);
    if (!result.ok) {
      toast.error("削除に失敗: " + result.reason);
      return;
    }
    toast.success("アルバムを削除しました");
  };

  const lastSyncedLabel = formatLastSynced(album.lastSyncedAt);
  const shareHref = safeHref(album.shareUrl);

  return (
    <section className="flex flex-col gap-2 rounded-md border border-border/40 bg-secondary/10 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          aria-expanded={!collapsed}
          aria-controls={`gphoto-album-body-${album.id}`}
          className="flex min-w-0 flex-1 items-start gap-2 text-left transition-colors hover:text-foreground"
        >
          <span className="mt-0.5 shrink-0 text-muted-foreground">
            {collapsed ? (
              <ChevronRight className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" aria-hidden />
            )}
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate font-display text-sm text-foreground">
              {album.title ?? "Google フォト"}
            </span>
            <span className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase">
              {links.length} image{links.length === 1 ? "" : "s"}
              {lastSyncedLabel && (
                <span className="ml-2 text-muted-foreground/60">
                  · last sync {lastSyncedLabel}
                </span>
              )}
            </span>
          </span>
        </button>
        <div className="flex items-center gap-1.5">
          {shareHref && (
            <a
              href={shareHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] tracking-normal text-muted-foreground transition-colors hover:bg-secondary/50 hover:text-foreground"
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              共有元
            </a>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onSync}
            disabled={syncing}
            className="gap-1 text-[10px] tracking-normal"
          >
            {syncing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            )}
            同期
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onDelete}
            disabled={deleting}
            className="gap-1 text-[10px] tracking-normal text-destructive hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
            削除
          </Button>
        </div>
      </div>

      {!collapsed && (
        <div id={`gphoto-album-body-${album.id}`}>
          {links.length === 0 ? (
            <p className="px-1 py-3 text-xs text-muted-foreground">
              画像がありません。共有設定 / 同期を確認してください。
            </p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {links.map((link) => (
                <AlbumImageCard
                  key={link.id}
                  link={link}
                  onOpen={() => onOpenImage(link.id)}
                  onEdit={() => onEditImage(link)}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function AlbumImageCard({
  link,
  onOpen,
  onEdit,
}: {
  link: CategoryLink;
  onOpen: () => void;
  onEdit: () => void;
}) {
  const src = safeHref(link.url);
  return (
    <li>
      <Card className="glass neon-edge group flex flex-col gap-0 overflow-hidden p-0 transition-transform hover:-translate-y-0.5">
        {src ? (
          <button
            type="button"
            onClick={onOpen}
            aria-label={`${link.title} を拡大表示`}
            className="relative block aspect-video overflow-hidden bg-secondary/30 cursor-zoom-in"
          >
            <Image
              src={src}
              alt={link.title}
              fill
              sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
              className="object-cover transition-transform group-hover:scale-105"
              loading="lazy"
              unoptimized={!isOptimizableImageHost(src)}
            />
          </button>
        ) : (
          <div className="flex aspect-video items-center justify-center bg-secondary/30 text-xs text-muted-foreground">
            画像URL不正
          </div>
        )}
        <div className="flex items-start gap-2 px-3 pt-2 pb-1">
          <span className="flex-1 break-words font-display text-xs text-foreground">
            {link.title}
          </span>
          <LinkCardMenu link={link} onEdit={onEdit} />
        </div>
      </Card>
    </li>
  );
}

function formatLastSynced(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  // 閲覧者の壁時計ではなく JST 表示で統一する。
  return jstDateTimeString(d);
}
