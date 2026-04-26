"use client";

import Link from "next/link";
import { useMemo } from "react";
import { GripVertical, Layers } from "lucide-react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
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
import { StatusBadge } from "@/components/portal/status-badge";
import {
  applyCategoryOrder,
  setCategoryOrder,
  useCategoryOrder,
} from "@/lib/category-order-store";
import type { Category } from "@/lib/placeholder-categories";

export function CategoryList({ categories }: { categories: Category[] }) {
  const order = useCategoryOrder();

  // Apply persisted ordering on top of the source list.
  const sorted = useMemo(
    () => applyCategoryOrder(categories, order),
    [categories, order],
  );

  // PointerSensor with a small activation distance so a click on the link
  // isn't accidentally interpreted as a drag.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
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
          <p className="font-display text-foreground text-sm">No categories yet</p>
          <p className="text-muted-foreground text-xs">
            Supabase 連携完了後、ここから追加できるようになります（Phase 3）。
          </p>
        </div>
      </Card>
    );
  }

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = sorted.findIndex((c) => c.slug === active.id);
    const newIndex = sorted.findIndex((c) => c.slug === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(sorted, oldIndex, newIndex).map((c) => c.slug);
    setCategoryOrder(next);
  };

  const slugIds = useMemo(() => sorted.map((c) => c.slug), [sorted]);

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
              <SortableCategoryCard key={cat.slug} category={cat} />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
    </div>
  );
}

function SortableCategoryCard({ category }: { category: Category }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: category.slug });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : "auto",
  };

  return (
    <li ref={setNodeRef} style={style} {...attributes}>
      <Card className="glass neon-edge relative flex items-stretch gap-2 p-0 transition-transform hover:-translate-y-0.5">
        {/* Drag handle — listeners scoped here so the rest of the card stays
            clickable as a plain link. */}
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
          className="flex flex-1 flex-col gap-1 p-4"
        >
          <div className="flex items-start justify-between gap-3">
            <p className="font-display text-foreground text-sm">{category.name}</p>
            <StatusBadge
              slug={category.slug}
              defaultStatus={category.status}
              readOnly
              variant="compact"
            />
          </div>
          <p className="text-muted-foreground mt-1 font-mono text-[11px] tracking-widest uppercase">
            /{category.slug}
          </p>
        </Link>
      </Card>
    </li>
  );
}
