"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import {
  BookOpen,
  GripVertical,
  Image as ImageIcon,
  ImageOff,
  MessageCircle,
} from "lucide-react";
import { toast } from "sonner";
import { LinkSiteIcon } from "@/components/portal/link-site-icon";
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
// 1.9 (2026-04-28) TODO #11: lazy 化で初期 client bundle から外す
import { LinkFormDialog } from "@/components/portal/link-form-dialog-lazy";
import { LinkCardMenu } from "@/components/portal/link-card-menu-lazy";
import { ActionSlot } from "@/components/portal/action-slot";
import {
  setCategoryLinkOrder,
  useRealtimeCategoryLinks,
} from "@/lib/category-links-client";
import { updateCategory } from "@/lib/categories-client";
import { safeHref } from "@/lib/url-safe";
import type { CategoryLink } from "@/lib/supabase/types";

type Props = {
  categoryId: string;
  initial: CategoryLink[];
  /**
   * カテゴリ側に保存された「攻略リンクのサムネイル表示」初期値
   * (Phase 14, 2026-05-13)。ON のとき thumbnail_url が入っている
   * リンクのカード上部に og:image / YouTube サムネイルを表示する。
   */
  initialShowThumbnails: boolean;
};

export function StrategyList({
  categoryId,
  initial,
  initialShowThumbnails,
}: Props) {
  const live = useRealtimeCategoryLinks(categoryId, "strategy", initial);
  const [editTarget, setEditTarget] = useState<CategoryLink | null>(null);
  const [optimistic, setOptimistic] = useState<string[] | null>(null);
  // Phase 14: サムネイル表示 ON/OFF。カテゴリ単位の共有設定 (DB) を
  // local mirror して optimistic に反映。toggle 失敗時に元に戻す。
  // initial が変わった時 (router.refresh 等) は state を再同期。
  const [showThumbnails, setShowThumbnails] = useState(initialShowThumbnails);
  const [togglingThumbs, setTogglingThumbs] = useState(false);
  useEffect(() => {
    setShowThumbnails(initialShowThumbnails);
  }, [initialShowThumbnails]);

  const links = useMemo(() => {
    if (!optimistic) return live;
    const idx = new Map(optimistic.map((id, i) => [id, i] as const));
    return [...live].sort((a, b) => {
      const ai = idx.get(a.id);
      const bi = idx.get(b.id);
      if (ai === undefined && bi === undefined) return 0;
      if (ai === undefined) return 1;
      if (bi === undefined) return -1;
      return ai - bi;
    });
  }, [live, optimistic]);

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
    const oldIndex = links.findIndex((l) => l.id === active.id);
    const newIndex = links.findIndex((l) => l.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const next = arrayMove(links, oldIndex, newIndex).map((l) => l.id);
    setOptimistic(next);
    const result = await setCategoryLinkOrder(next);
    if (!result.ok) {
      toast.error("並び替えの保存に失敗: " + result.reason);
      setOptimistic(null);
      return;
    }
    setTimeout(() => setOptimistic(null), 1500);
  };

  const ids = useMemo(() => links.map((l) => l.id), [links]);

  // Phase 14: サムネイル表示 ON/OFF を server に反映。non-admin が押した場合
  // updateCategory が `ADMIN ロールが必要です` 等の reason を返す → 元に戻す。
  const onToggleThumbnails = async () => {
    const next = !showThumbnails;
    setShowThumbnails(next);
    setTogglingThumbs(true);
    const result = await updateCategory(categoryId, {
      show_strategy_thumbnails: next,
    });
    setTogglingThumbs(false);
    if (!result.ok) {
      setShowThumbnails(!next);
      // updateCategoryAction は admin 不可時 reason="not_admin" を返すので
      // ユーザー向けに日本語へ翻訳。それ以外は DB エラー文をそのまま表示。
      const msg =
        result.reason === "not_admin"
          ? "ADMIN ロールが必要です"
          : result.reason;
      toast.error("サムネイル表示の切替に失敗: " + msg);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase">
          {links.length} link{links.length === 1 ? "" : "s"}
          {links.length > 1 && (
            <span className="ml-2 text-muted-foreground/60">
              · ドラッグで並び替え
            </span>
          )}
        </p>
        {/* TODO #58: stuck 時のみ SubTabs 右端へ portal、それ以外は元位置 in-flow。 */}
        <ActionSlot>
          <div className="flex items-center gap-1.5">
            {/* Phase 14: サムネイル表示 ON/OFF。
                videos-list の favoritesOnly ボタンに揃えた style。
                押下時 server action が admin gate するので、非 admin の
                クリックは toast でエラーになり state が revert される。 */}
            <button
              type="button"
              onClick={onToggleThumbnails}
              disabled={togglingThumbs}
              aria-pressed={showThumbnails}
              title={
                showThumbnails
                  ? "サムネイル表示をオフ"
                  : "サムネイル表示をオン"
              }
              className={
                "inline-flex h-7 items-center gap-1 rounded-md border px-2 font-mono text-[10px] tracking-[0.18em] uppercase transition-colors disabled:opacity-50 " +
                (showThumbnails
                  ? "border-[var(--neon-cyan)]/60 bg-[var(--neon-cyan)]/12 text-[var(--neon-cyan)]"
                  : "border-border/40 bg-background/30 text-muted-foreground hover:text-foreground")
              }
            >
              {showThumbnails ? (
                <ImageIcon className="h-3 w-3" aria-hidden />
              ) : (
                <ImageOff className="h-3 w-3" aria-hidden />
              )}
              サムネ
            </button>
            <LinkFormDialog categoryId={categoryId} kind="strategy" />
          </div>
        </ActionSlot>
      </div>

      {links.length === 0 ? (
        <Card className="glass flex flex-col items-center gap-3 p-10 text-center">
          <span className="grid h-10 w-10 place-items-center rounded-md border border-[var(--neon-magenta)]/40 bg-background/40 text-[var(--neon-magenta)]">
            <BookOpen className="h-4 w-4" aria-hidden />
          </span>
          <p className="font-display text-foreground text-sm">
            攻略リンク未登録
          </p>
          <p className="text-muted-foreground max-w-md text-xs leading-relaxed">
            wiki / 攻略ブログ / Twitter (X) などの URL を登録できます。
          </p>
        </Card>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
        >
          <SortableContext items={ids} strategy={rectSortingStrategy}>
            <ul className="grid gap-3 sm:grid-cols-2">
              {links.map((link) => (
                <SortableStrategyCard
                  key={link.id}
                  link={link}
                  showThumbnail={showThumbnails}
                  onEdit={() => setEditTarget(link)}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      <LinkFormDialog
        categoryId={categoryId}
        kind="strategy"
        link={editTarget ?? undefined}
        open={editTarget !== null}
        onOpenChange={(o) => {
          if (!o) setEditTarget(null);
        }}
      />
    </div>
  );
}

function SortableStrategyCard({
  link,
  showThumbnail,
  onEdit,
}: {
  link: CategoryLink;
  showThumbnail: boolean;
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

  // Phase 14: showThumbnail=true かつ DB に保存された thumbnail_url が
  // 安全な http(s) 絶対 URL のときだけサムネイル表示。新規追加分でしか
  // og:image を取りに行かないので、既存リンクや og:image 未設定サイトは
  // NULL → ここで undefined → 描画しない (= 従来のテキストカードのまま)。
  const thumbHref = showThumbnail ? safeHref(link.thumbnailUrl) : undefined;

  return (
    <li ref={setNodeRef} style={style} {...attributes}>
      <Card className="glass neon-edge group flex items-stretch gap-0 p-0 transition-transform hover:-translate-y-0.5">
        <button
          type="button"
          {...listeners}
          aria-label={`${link.title} の並び替えハンドル`}
          className="flex shrink-0 cursor-grab items-center justify-center border-r border-border/40 bg-secondary/30 px-2 text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground active:cursor-grabbing"
        >
          <GripVertical className="h-4 w-4" aria-hidden />
        </button>

        <div className="flex min-w-0 flex-1 flex-col">
          {thumbHref && (
            // next/image unoptimized: og:image は任意 host なので Vercel
            // Image Optimization を通さず素通し。aspect-video で枠を確保し
            // CLS を抑える。クリックで外部リンクへ。
            <a
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="relative block aspect-video overflow-hidden bg-secondary/30"
              aria-label={`${link.title} を新規タブで開く`}
            >
              <Image
                src={thumbHref}
                alt=""
                fill
                sizes="(min-width: 640px) 50vw, 100vw"
                className="object-cover"
                loading="lazy"
                unoptimized
              />
            </a>
          )}
          <div className="flex items-start gap-2 px-3 pt-3 pb-1">
            <a
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex flex-1 items-start gap-2"
            >
              <LinkSiteIcon
                url={link.url}
                variant="coarse"
                className="mt-0.5 h-3.5 w-3.5 shrink-0"
              />
              <span className="flex-1 break-words font-display text-sm text-foreground group-hover:text-[var(--neon-cyan)]">
                {link.title}
              </span>
            </a>
            {link.source === "discord" && (
              <span
                title="Discord から自動取り込み"
                aria-label="Discord 由来"
                className="grid h-5 w-5 shrink-0 place-items-center rounded-sm border border-indigo-400/40 bg-indigo-400/10 text-indigo-300"
              >
                <MessageCircle className="h-2.5 w-2.5" aria-hidden />
              </span>
            )}
            <LinkCardMenu link={link} onEdit={onEdit} />
          </div>
          {link.description && (
            <p className="px-3 text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap">
              {link.description}
            </p>
          )}
          <p className="px-3 pt-1 pb-3 font-mono text-[10px] break-all text-muted-foreground/70">
            {link.url}
          </p>
        </div>
      </Card>
    </li>
  );
}
