"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import {
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
import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
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
import { isOptimizableImageHost, safeHref } from "@/lib/url-safe";
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
  const [optimistic, setOptimistic] = useState<string[] | null>(null);
  const [lightboxId, setLightboxId] = useState<string | null>(null);

  // 「ばら」セクション用: kind=image 全件 + アルバム未所属の gphoto。
  // sortOrder + createdAt で素直に整列したものを基準とし、optimistic 並び
  // 替え中だけ手動 index 順で上書きする。
  const looseLinks = useMemo(() => {
    const base: CategoryLink[] = [
      ...liveImages,
      ...liveGphotos.filter((l) => l.gphotoAlbumId === null),
    ].sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return a.createdAt.localeCompare(b.createdAt);
    });
    if (!optimistic) return base;
    const idx = new Map(optimistic.map((id, i) => [id, i] as const));
    return [...base].sort((a, b) => {
      const ai = idx.get(a.id);
      const bi = idx.get(b.id);
      if (ai === undefined && bi === undefined) return 0;
      if (ai === undefined) return 1;
      if (bi === undefined) return -1;
      return ai - bi;
    });
  }, [liveImages, liveGphotos, optimistic]);

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

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 6 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const onDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = looseLinks.findIndex((l) => l.id === active.id);
    const newIndex = looseLinks.findIndex((l) => l.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const next = arrayMove(looseLinks, oldIndex, newIndex).map((l) => l.id);
    setOptimistic(next);
    const result = await setCategoryLinkOrder(next);
    if (!result.ok) {
      toast.error("並び替えの保存に失敗: " + result.reason);
      setOptimistic(null);
      return;
    }
    setTimeout(() => setOptimistic(null), 1500);
  };

  const looseIds = useMemo(
    () => looseLinks.map((l) => l.id),
    [looseLinks],
  );

  // Lightbox は ばら + アルバム配下 すべての中から id 検索する。
  const lightboxLink = useMemo(() => {
    if (!lightboxId) return null;
    const all: CategoryLink[] = [...liveImages, ...liveGphotos];
    return all.find((l) => l.id === lightboxId) ?? null;
  }, [liveImages, liveGphotos, lightboxId]);

  return (
    <section className="flex flex-col gap-3 border-t border-border/30 pt-4">
      <div className="flex items-center justify-between">
        <p className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase">
          {totalCount} image{totalCount === 1 ? "" : "s"}
          {looseLinks.length > 1 && (
            <span className="ml-2 text-muted-foreground/60">
              · ドラッグで並び替え
            </span>
          )}
        </p>
        {/* SubTabs が stuck 状態になったら ActionSlot 経由で SubTabs 右端に
            portal される (strategy-list の「サムネ + 攻略リンク追加」と同じ
            target を共有。Phase 16 で Google フォト URL 判定を
            ImageFormDialog 内に統合したため、ボタンは 1 つに集約。 */}
        <ActionSlot>
          <ImageFormDialog categoryId={categoryId} />
        </ActionSlot>
      </div>

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
              onDragEnd={onDragEnd}
            >
              <SortableContext items={looseIds} strategy={rectSortingStrategy}>
                <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {looseLinks.map((link) => (
                    <SortableImageCard
                      key={link.id}
                      link={link}
                      onOpen={() => setLightboxId(link.id)}
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
              children={albumChildren.get(album.id) ?? []}
              onOpenImage={(id) => setLightboxId(id)}
              onEditImage={(link) => setEditTarget(link)}
            />
          ))}
        </>
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
        link={lightboxLink}
        onOpenChange={(o) => {
          if (!o) setLightboxId(null);
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
 */
function ImageLightbox({
  link,
  onOpenChange,
}: {
  link: CategoryLink | null;
  onOpenChange: (open: boolean) => void;
}) {
  const open = link !== null;
  const src = link ? safeHref(link.url) : undefined;
  // 余白クリックで閉じる。画像本体は stopPropagation で素通り。
  const onBackdropClick = () => onOpenChange(false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
            onClick={onBackdropClick}
            role="button"
            tabIndex={-1}
            aria-label="画像を閉じる"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt={link?.title ?? ""}
              className="max-h-full max-w-full cursor-default object-contain"
              onClick={(e) => e.stopPropagation()}
              draggable={false}
            />
          </div>
        ) : (
          <div
            className="flex items-center justify-center text-sm text-white/70"
            onClick={onBackdropClick}
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
  children,
  onOpenImage,
  onEditImage,
}: {
  album: CategoryGphotoAlbum;
  children: CategoryLink[];
  onOpenImage: (id: string) => void;
  onEditImage: (link: CategoryLink) => void;
}) {
  const [syncing, setSyncing] = useState(false);
  const [deleting, setDeleting] = useState(false);

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
    if (
      !window.confirm(
        `「${label}」のアルバムと含まれる画像 ${children.length} 枚を削除します。よろしいですか？`,
      )
    ) {
      return;
    }
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
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="truncate font-display text-sm text-foreground">
            {album.title ?? "Google フォト"}
          </p>
          <p className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase">
            {children.length} image{children.length === 1 ? "" : "s"}
            {lastSyncedLabel && (
              <span className="ml-2 text-muted-foreground/60">
                · last sync {lastSyncedLabel}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {shareHref && (
            <a
              href={shareHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase transition-colors hover:bg-secondary/50 hover:text-foreground"
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
            className="gap-1 font-mono text-[10px] tracking-[0.18em] uppercase"
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
            className="gap-1 font-mono text-[10px] tracking-[0.18em] uppercase text-destructive hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
            削除
          </Button>
        </div>
      </div>

      {children.length === 0 ? (
        <p className="px-1 py-3 text-xs text-muted-foreground">
          画像がありません。共有設定 / 同期を確認してください。
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {children.map((link) => (
            <AlbumImageCard
              key={link.id}
              link={link}
              onOpen={() => onOpenImage(link.id)}
              onEdit={() => onEditImage(link)}
            />
          ))}
        </ul>
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
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
  } catch {
    return null;
  }
}
