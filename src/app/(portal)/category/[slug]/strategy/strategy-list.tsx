"use client";

import { useMemo, useState } from "react";
import { ExternalLink, BookOpen, GripVertical } from "lucide-react";
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
import { LinkFormDialog } from "@/components/portal/link-form-dialog";
import { LinkCardMenu } from "@/components/portal/link-card-menu";
import {
  setCategoryLinkOrder,
  useRealtimeCategoryLinks,
} from "@/lib/category-links-client";
import type { CategoryLink } from "@/lib/supabase/types";

type Props = {
  categoryId: string;
  initial: CategoryLink[];
};

export function StrategyList({ categoryId, initial }: Props) {
  const live = useRealtimeCategoryLinks(categoryId, "strategy", initial);
  const [editTarget, setEditTarget] = useState<CategoryLink | null>(null);
  const [optimistic, setOptimistic] = useState<string[] | null>(null);

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
        <LinkFormDialog categoryId={categoryId} kind="strategy" />
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
  onEdit,
}: {
  link: CategoryLink;
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

  return (
    <li ref={setNodeRef} style={style} {...attributes}>
      <Card className="glass neon-edge group flex items-stretch gap-0 p-0 transition-transform hover:-translate-y-0.5">
        <button
          type="button"
          {...listeners}
          aria-label={`${link.title} の並び替えハンドル`}
          className="flex shrink-0 cursor-grab items-center justify-center rounded-l-lg border-r border-border/40 bg-secondary/30 px-2 text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground active:cursor-grabbing"
        >
          <GripVertical className="h-4 w-4" aria-hidden />
        </button>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-start gap-2 px-3 pt-3 pb-1">
            <a
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex flex-1 items-start gap-2"
            >
              <ExternalLink
                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--neon-magenta)]"
                aria-hidden
              />
              <span className="flex-1 break-words font-display text-sm text-foreground group-hover:text-[var(--neon-cyan)]">
                {link.title}
              </span>
            </a>
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
