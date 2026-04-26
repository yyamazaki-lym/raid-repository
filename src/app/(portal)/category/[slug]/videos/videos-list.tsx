"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import {
  ExternalLink,
  Film,
  Play,
  GripVertical,
  MessageCircle,
  Calendar,
  ListOrdered,
  BarChart3,
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
import { LinkFormDialog } from "@/components/portal/link-form-dialog";
import { LinkCardMenu } from "@/components/portal/link-card-menu";
import {
  setCategoryLinkOrder,
  useRealtimeCategoryLinks,
} from "@/lib/category-links-client";
import {
  parseYouTubeId,
  youtubeEmbedUrl,
  youtubeThumbnailUrl,
} from "@/lib/youtube";
import type { CategoryLink } from "@/lib/supabase/types";

type Props = {
  categoryId: string;
  initial: CategoryLink[];
};

type SortMode = "date" | "custom";
const SORT_STORAGE_KEY = "raid-repo:videos-sort-mode";

export function VideosList({ categoryId, initial }: Props) {
  const live = useRealtimeCategoryLinks(categoryId, "video", initial);
  const [editTarget, setEditTarget] = useState<CategoryLink | null>(null);
  const [optimistic, setOptimistic] = useState<string[] | null>(null);
  // Sort mode lives in localStorage so the user's choice survives reloads.
  // Default to date (newest-first) — matches the request to view videos
  // chronologically; switching to custom enables DnD reordering.
  const [sortMode, setSortMode] = useState<SortMode>("date");
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(SORT_STORAGE_KEY);
    if (stored === "custom" || stored === "date") setSortMode(stored);
  }, []);
  const persistSort = (mode: SortMode) => {
    setSortMode(mode);
    try {
      window.localStorage.setItem(SORT_STORAGE_KEY, mode);
    } catch {
      // ignore
    }
  };

  const videos = useMemo(() => {
    if (sortMode === "date") {
      // Newest first by created_at; ties (within the same insert batch from
      // the cron) fall back to sort_order ascending.
      return [...live].sort((a, b) => {
        const cmp = b.createdAt.localeCompare(a.createdAt);
        return cmp !== 0 ? cmp : a.sortOrder - b.sortOrder;
      });
    }
    // Custom mode — apply optimistic order if present, otherwise sort_order.
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
  }, [live, optimistic, sortMode]);

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
    const oldIndex = videos.findIndex((v) => v.id === active.id);
    const newIndex = videos.findIndex((v) => v.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const next = arrayMove(videos, oldIndex, newIndex).map((v) => v.id);
    setOptimistic(next);
    const result = await setCategoryLinkOrder(next);
    if (!result.ok) {
      toast.error("並び替えの保存に失敗: " + result.reason);
      setOptimistic(null);
      return;
    }
    setTimeout(() => setOptimistic(null), 1500);
  };

  const ids = useMemo(() => videos.map((v) => v.id), [videos]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase">
          {videos.length} video{videos.length === 1 ? "" : "s"}
          {videos.length > 1 && sortMode === "custom" && (
            <span className="ml-2 text-muted-foreground/60">
              · ドラッグで並び替え
            </span>
          )}
        </p>
        <div className="flex items-center gap-1.5">
          {/* Sort mode toggle: 日付順 (newest first) or カスタム順 (DnD). */}
          <div
            className="inline-flex items-center rounded-md border border-border/40 bg-background/30 p-0.5 font-mono text-[10px] tracking-widest uppercase"
            role="radiogroup"
            aria-label="並び順"
          >
            <button
              type="button"
              onClick={() => persistSort("date")}
              role="radio"
              aria-checked={sortMode === "date"}
              className={
                "inline-flex items-center gap-1 rounded-sm px-2 py-1 transition-colors " +
                (sortMode === "date"
                  ? "bg-[var(--neon-cyan)]/12 text-[var(--neon-cyan)]"
                  : "text-muted-foreground hover:text-foreground")
              }
            >
              <Calendar className="h-3 w-3" aria-hidden />
              日付順
            </button>
            <button
              type="button"
              onClick={() => persistSort("custom")}
              role="radio"
              aria-checked={sortMode === "custom"}
              className={
                "inline-flex items-center gap-1 rounded-sm px-2 py-1 transition-colors " +
                (sortMode === "custom"
                  ? "bg-[var(--neon-cyan)]/12 text-[var(--neon-cyan)]"
                  : "text-muted-foreground hover:text-foreground")
              }
            >
              <ListOrdered className="h-3 w-3" aria-hidden />
              カスタム
            </button>
          </div>
          <LinkFormDialog categoryId={categoryId} kind="video" />
        </div>
      </div>

      {videos.length === 0 ? (
        <Card className="glass flex flex-col items-center gap-3 p-10 text-center">
          <span className="grid h-10 w-10 place-items-center rounded-md border border-[var(--neon-cyan)]/40 bg-background/40 text-[var(--neon-cyan)]">
            <Film className="h-4 w-4" aria-hidden />
          </span>
          <p className="font-display text-foreground text-sm">動画未登録</p>
          <p className="text-muted-foreground max-w-md text-xs leading-relaxed">
            YouTube の URL を登録するとサムネイル付きで表示されます。
            <br />
            その他の動画サイト URL もリンク表示できます。
          </p>
        </Card>
      ) : sortMode === "custom" ? (
        // Custom (DnD-enabled) layout. Each card carries a drag handle.
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
        >
          <SortableContext items={ids} strategy={rectSortingStrategy}>
            <ul className="grid gap-4 sm:grid-cols-2">
              {videos.map((v) => (
                <SortableVideoCard
                  key={v.id}
                  video={v}
                  onEdit={() => setEditTarget(v)}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      ) : (
        // Date-sorted layout — DnD makes no sense here so render plain cards.
        <ul className="grid gap-4 sm:grid-cols-2">
          {videos.map((v) => (
            <li key={v.id}>
              <VideoCard video={v} onEdit={() => setEditTarget(v)} />
            </li>
          ))}
        </ul>
      )}

      <LinkFormDialog
        categoryId={categoryId}
        kind="video"
        link={editTarget ?? undefined}
        open={editTarget !== null}
        onOpenChange={(o) => {
          if (!o) setEditTarget(null);
        }}
      />
    </div>
  );
}

function SortableVideoCard({
  video,
  onEdit,
}: {
  video: CategoryLink;
  onEdit: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: video.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : "auto",
  };

  return (
    <li ref={setNodeRef} style={style} {...attributes}>
      <VideoCard video={video} onEdit={onEdit} dragListeners={listeners} />
    </li>
  );
}

function VideoCard({
  video,
  onEdit,
  dragListeners,
}: {
  video: CategoryLink;
  onEdit: () => void;
  dragListeners?: ReturnType<typeof useSortable>["listeners"];
}) {
  const ytId = parseYouTubeId(video.url);
  return (
    <Card className="glass neon-edge group flex flex-col gap-2 overflow-hidden p-0 transition-transform hover:-translate-y-0.5">
      <div className="relative">
        {ytId ? (
          <YouTubePreview id={ytId} url={video.url} title={video.title} />
        ) : (
          <a
            href={video.url}
            target="_blank"
            rel="noopener noreferrer"
            className="grid aspect-video place-items-center bg-secondary/30 text-muted-foreground transition-colors hover:bg-secondary/50 hover:text-foreground"
          >
            <div className="flex flex-col items-center gap-2">
              <Film className="h-8 w-8" aria-hidden />
              <span className="font-mono text-[10px] tracking-widest uppercase">
                External Video
              </span>
            </div>
          </a>
        )}

        {/* Drag handle floats over the top-left corner of the thumbnail. */}
        {dragListeners && (
          <button
            type="button"
            {...dragListeners}
            aria-label={`${video.title} の並び替えハンドル`}
            className="absolute top-2 left-2 inline-flex h-7 w-7 cursor-grab items-center justify-center rounded-md bg-black/60 text-white/80 backdrop-blur-sm transition-colors hover:bg-black/80 hover:text-white active:cursor-grabbing"
            onClick={(e) => e.stopPropagation()}
          >
            <GripVertical className="h-3.5 w-3.5" aria-hidden />
          </button>
        )}
      </div>

      <div className="flex items-start gap-2 px-3 pb-1">
        <a
          href={video.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 break-words font-display text-sm text-foreground transition-colors hover:text-[var(--neon-cyan)]"
        >
          {video.title}
        </a>
        {video.source === "discord" && (
          <span
            title="Discord から自動取り込み"
            aria-label="Discord 由来"
            className="grid h-5 w-5 shrink-0 place-items-center rounded-sm border border-indigo-400/40 bg-indigo-400/10 text-indigo-300"
          >
            <MessageCircle className="h-2.5 w-2.5" aria-hidden />
          </span>
        )}
        <LinkCardMenu link={video} onEdit={onEdit} />
      </div>
      {video.description && (
        <p className="px-3 text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap">
          {video.description}
        </p>
      )}
      {video.logsUrl && (
        <div className="px-3">
          <a
            href={video.logsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-sm border border-amber-400/45 bg-amber-400/10 px-2 py-1 font-mono text-[10px] tracking-widest text-amber-200 uppercase transition-colors hover:bg-amber-400/15 hover:text-amber-100"
            title="FFLogs レポートを開く"
          >
            <BarChart3 className="h-3 w-3" aria-hidden />
            FFLogs
            <ExternalLink className="h-2.5 w-2.5 opacity-70" aria-hidden />
          </a>
        </div>
      )}
      <a
        href={video.url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1 px-3 pb-3 font-mono text-[10px] break-all text-muted-foreground/70 hover:text-foreground/80"
      >
        <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
        <span className="break-all">{video.url}</span>
      </a>
    </Card>
  );
}

/**
 * Click-to-load YouTube preview. Avoids embedding N iframes upfront so the
 * page stays fast — only the cards the user clicks become full <iframe>s.
 */
function YouTubePreview({
  id,
  url,
  title,
}: {
  id: string;
  url: string;
  title: string;
}) {
  const [active, setActive] = useState(false);

  if (active) {
    return (
      <div className="relative aspect-video w-full bg-black">
        <iframe
          src={youtubeEmbedUrl(id) + "?autoplay=1"}
          title={title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          className="absolute inset-0 h-full w-full"
        />
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setActive(true)}
      className="group/play relative aspect-video w-full overflow-hidden bg-black"
      aria-label={`${title} を再生`}
    >
      <Image
        src={youtubeThumbnailUrl(id)}
        alt={title}
        fill
        sizes="(min-width: 640px) 50vw, 100vw"
        className="object-cover opacity-90 transition-opacity group-hover/play:opacity-100"
        unoptimized
      />
      <span className="absolute inset-0 grid place-items-center bg-gradient-to-t from-black/60 via-transparent to-transparent">
        <span className="grid h-12 w-12 place-items-center rounded-full bg-black/70 text-white shadow-[0_0_24px_-4px_rgba(255,255,255,0.6)] transition-transform group-hover/play:scale-110">
          <Play className="h-5 w-5 fill-white" aria-hidden />
        </span>
      </span>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="absolute top-2 right-2 inline-flex items-center gap-1 rounded-md bg-black/60 px-1.5 py-1 font-mono text-[9px] tracking-widest text-white/80 uppercase transition-colors hover:text-white"
        aria-label="YouTubeで開く"
      >
        <ExternalLink className="h-3 w-3" aria-hidden />
        YouTube
      </a>
    </button>
  );
}
