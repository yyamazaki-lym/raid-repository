"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  GripVertical,
  Layers,
  MoreVertical,
  Trash2,
  Pencil,
  Trophy,
  Timer,
} from "lucide-react";
import { toast } from "sonner";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { StatusBadge } from "@/components/portal/status-badge";
import { CategoryFormDialog } from "@/components/portal/category-form-dialog";
import {
  deleteCategory,
  setCategoryOrder,
  updateCategoryStatus,
  useRealtimeCategories,
} from "@/lib/categories-client";
import type { Category, CategoryStatus } from "@/lib/supabase/types";

type Props = {
  initialCategories: Category[];
  /** Map of category.id → number of Discord-imported links in the last 7d. */
  recentImportCounts?: Record<string, number>;
  /** Map of category.id → sum of all video durations in seconds. */
  practiceSecondsByCategory?: Record<string, number>;
};

export function CategoryList({
  initialCategories,
  recentImportCounts = {},
  practiceSecondsByCategory = {},
}: Props) {
  // Realtime hook keeps the list in sync with DB changes from any client.
  const live = useRealtimeCategories(initialCategories);
  // Local mirror so DnD can rearrange optimistically without waiting on
  // round-trip+realtime — Realtime overwrites once the server confirms.
  const [optimisticOrder, setOptimisticOrder] = useState<string[] | null>(null);
  // Single edit dialog controlled at the list level. Lifting state here
  // (rather than embedding the dialog inside the per-card menu) avoids the
  // focus collision where a DropdownMenuItem closing immediately re-closes
  // the dialog it just opened.
  const [editTarget, setEditTarget] = useState<Category | null>(null);

  const sorted = useMemo(() => {
    if (!optimisticOrder) return live;
    const idx = new Map(optimisticOrder.map((id, i) => [id, i] as const));
    return [...live].sort((a, b) => {
      const ai = idx.get(a.id);
      const bi = idx.get(b.id);
      if (ai === undefined && bi === undefined) return 0;
      if (ai === undefined) return 1;
      if (bi === undefined) return -1;
      return ai - bi;
    });
  }, [live, optimisticOrder]);

  // Sensor strategy:
  // - MouseSensor: distance-based activation so a click on the link inside the
  //   card isn't interpreted as a drag.
  // - TouchSensor: delay-based (long-press) so the user can scroll the page
  //   normally; pressing-and-holding on the grip starts the drag.
  // - KeyboardSensor: arrow-key reorder for accessibility.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 6 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  if (sorted.length === 0) {
    return (
      <Card className="glass flex flex-col items-center gap-4 p-10 text-center">
        <span className="grid h-12 w-12 place-items-center rounded-full border border-[var(--neon-violet)]/30 bg-background/60 text-[var(--neon-violet)] shadow-[0_0_24px_-6px_var(--neon-violet)]">
          <Layers className="h-5 w-5" aria-hidden />
        </span>
        <div className="space-y-1">
          <p className="font-display text-foreground text-sm">
            カテゴリーがありません
          </p>
          <p className="text-muted-foreground text-xs">
            右上の「カテゴリー追加」ボタンから登録できます。
          </p>
        </div>
      </Card>
    );
  }

  const onDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = sorted.findIndex((c) => c.id === active.id);
    const newIndex = sorted.findIndex((c) => c.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const next = arrayMove(sorted, oldIndex, newIndex).map((c) => c.id);
    setOptimisticOrder(next);

    const result = await setCategoryOrder(next);
    if (!result.ok) {
      toast.error("並び替えの保存に失敗しました: " + result.reason);
      setOptimisticOrder(null);
    }
    // On success, Realtime broadcasts and overwrites with DB values; clear
    // optimistic state so future changes start from the DB-confirmed order.
    setTimeout(() => setOptimisticOrder(null), 1500);
  };

  const onChangeStatus = async (id: string, status: CategoryStatus) => {
    const result = await updateCategoryStatus(id, status);
    if (!result.ok) toast.error("ステータス更新失敗: " + result.reason);
  };

  const onDelete = async (cat: Category) => {
    if (
      !window.confirm(
        `「${cat.name}」を削除しますか？\nロット・軽減・攻略情報もすべて削除されます。`,
      )
    ) {
      return;
    }
    const result = await deleteCategory(cat.id);
    if (!result.ok) toast.error("削除失敗: " + result.reason);
    else toast.success(`「${cat.name}」を削除しました`);
  };

  const slugIds = useMemo(() => sorted.map((c) => c.id), [sorted]);

  return (
    <div className="flex flex-col gap-2">
      <p className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase">
        Drag to reorder · ドラッグで並び替え
      </p>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
      >
        <SortableContext items={slugIds} strategy={rectSortingStrategy}>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {sorted.map((cat) => (
              <SortableCategoryCard
                key={cat.id}
                category={cat}
                recentImports={recentImportCounts[cat.id] ?? 0}
                practiceSeconds={practiceSecondsByCategory[cat.id] ?? 0}
                onChangeStatus={(s) => onChangeStatus(cat.id, s)}
                onEdit={() => setEditTarget(cat)}
                onDelete={() => onDelete(cat)}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>

      {/* Single edit dialog — opens for whichever category was clicked. */}
      <CategoryFormDialog
        category={editTarget ?? undefined}
        open={editTarget !== null}
        onOpenChange={(o) => {
          if (!o) setEditTarget(null);
        }}
      />
    </div>
  );
}

function SortableCategoryCard({
  category,
  recentImports,
  practiceSeconds,
  onChangeStatus,
  onEdit,
  onDelete,
}: {
  category: Category;
  recentImports: number;
  practiceSeconds: number;
  onChangeStatus: (s: CategoryStatus) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
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

  // "Practice time" badge — only meaningful for categories that the
  // group has actually engaged with. 未着手 has no practice time by
  // definition; the other three statuses show the cumulative video
  // total when there's data to show.
  const showPracticeTime =
    practiceSeconds > 0 &&
    (category.status === "練習中" ||
      category.status === "休止中" ||
      category.status === "クリア済");

  return (
    <li ref={setNodeRef} style={style} {...attributes}>
      <Card className="glass neon-edge relative flex items-stretch gap-2 p-0 transition-transform hover:-translate-y-0.5">
        <button
          type="button"
          {...listeners}
          aria-label={`${category.name} の並び替えハンドル`}
          className="flex shrink-0 cursor-grab items-center justify-center rounded-l-lg border-r border-border/40 bg-secondary/30 px-2 text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground active:cursor-grabbing"
        >
          <GripVertical className="h-4 w-4" aria-hidden />
        </button>

        <Link
          href={`/category/${category.slug}/mitigation`}
          prefetch
          className="flex flex-1 flex-col gap-1 p-4 pr-2"
        >
          <div className="flex items-start justify-between gap-2">
            <p className="font-display text-foreground text-sm leading-tight">
              {category.name}
            </p>
          </div>
          <div className="mt-1 flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] tracking-widest uppercase">
            <p className="text-muted-foreground">/{category.slug}</p>
            <div className="flex flex-wrap items-center gap-1">
              {showPracticeTime && (
                <span
                  className="inline-flex items-center gap-1 rounded-sm border border-violet-400/40 bg-violet-400/10 px-1.5 py-px text-[9px] text-violet-200"
                  title={`累計練習時間: ${formatDurationLong(practiceSeconds)}`}
                >
                  <Timer className="h-2.5 w-2.5" aria-hidden />
                  {formatDurationShort(practiceSeconds)}
                </span>
              )}
              {category.firstClearAt && (
                <span
                  className="inline-flex items-center gap-1 rounded-sm border border-amber-400/45 bg-amber-400/10 px-1.5 py-px text-[9px] text-amber-200"
                  title={`初クリア: ${formatFirstClear(category.firstClearAt, "long")}`}
                >
                  <Trophy className="h-2.5 w-2.5" aria-hidden />
                  {formatFirstClear(category.firstClearAt, "short")}
                </span>
              )}
              {recentImports > 0 && (
                <span
                  className="inline-flex items-center gap-1 rounded-sm border border-indigo-400/40 bg-indigo-400/10 px-1.5 py-px text-[9px] text-indigo-300"
                  title={`過去7日で Discord から ${recentImports} 件取り込み`}
                >
                  +{recentImports}/wk
                </span>
              )}
            </div>
          </div>
        </Link>

        <div className="flex flex-col items-end justify-between gap-1 p-2">
          {/* Status badge — stops propagation so clicking it doesn't navigate. */}
          <span
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <StatusBadge
              status={category.status}
              onChange={onChangeStatus}
              variant="compact"
            />
          </span>

          <CategoryMenu onEdit={onEdit} onDelete={onDelete} />
        </div>
      </Card>
    </li>
  );
}

/**
 * Compact duration label for the practice-time badge.
 *   <  1h: `45m`
 *   <100h: `12h30m`
 *   ≥100h: `120h` (drop minutes once total dwarfs them)
 */
function formatDurationShort(seconds: number): string {
  const totalMinutes = Math.floor(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (hours >= 100) return `${hours}h`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h${minutes}m`;
}

/**
 * Verbose duration for the hover tooltip — Japanese readable form.
 */
function formatDurationLong(seconds: number): string {
  const totalMinutes = Math.floor(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}分`;
  if (minutes === 0) return `${hours}時間`;
  return `${hours}時間${minutes}分`;
}

/**
 * Format the first-clear timestamp for the badge:
 *   "short" → `12/15` (M/D in local TZ)
 *   "long"  → `2025-12-15 (月)` for the hover tooltip
 */
function formatFirstClear(iso: string, mode: "short" | "long"): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  if (mode === "short") {
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const wd = ["日", "月", "火", "水", "木", "金", "土"][d.getDay()];
  return `${y}-${m}-${day} (${wd})`;
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
          className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
          aria-label="カテゴリーメニュー"
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
