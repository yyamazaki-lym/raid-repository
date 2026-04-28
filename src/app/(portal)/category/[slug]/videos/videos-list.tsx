"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
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
  Timer,
  Trophy,
  Trash2,
  CheckSquare,
  Square,
} from "lucide-react";
import { LinkSiteIcon } from "@/components/portal/link-site-icon";
import { LINK_SITE_LABEL, detectLinkSite } from "@/lib/link-site";
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
  deleteCategoryLink,
  setCategoryLinkOrder,
  useRealtimeCategoryLinks,
} from "@/lib/category-links-client";
import {
  parseYouTubeId,
  youtubeEmbedUrl,
  youtubeThumbnailUrl,
} from "@/lib/youtube";
import {
  formatDurationLong,
  formatDurationShort,
  formatFirstClear,
} from "@/lib/duration-format";
import { safeHref } from "@/lib/url-safe";
import { extractDateFromTitle } from "@/lib/title-date";
import type { CategoryLink } from "@/lib/supabase/types";

type Props = {
  categoryId: string;
  initial: CategoryLink[];
  /**
   * Category's first-clear timestamp (auto-detected from a "クリア"-titled
   * video, or manually set). Used in the header to show a クリア badge
   * + the time-to-clear stat alongside the running total.
   */
  firstClearAt?: string | null;
};

type SortMode = "date" | "custom";
const SORT_STORAGE_KEY = "raid-repo:videos-sort-mode";

export function VideosList({ categoryId, initial, firstClearAt }: Props) {
  const live = useRealtimeCategoryLinks(categoryId, "video", initial);
  const [editTarget, setEditTarget] = useState<CategoryLink | null>(null);
  const [optimistic, setOptimistic] = useState<string[] | null>(null);
  // Multi-select state (1.9.15): toggling on switches each card into a
  // selectable mode. Card body click stops opening YouTube; instead it
  // toggles the row's selection. Header gains a delete button when
  // selection is non-empty.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  // ?focus=<videoId> — set when navigating from the schedule page's
  // past date cell. Used to scroll the matching card into view and
  // briefly highlight it.
  // ?focusDate=YYYY-MM-DD — set when navigating from the category
  // list's クリア日 (Trophy) badge. The first video whose
  // title-extracted date OR posted_at / created_at starts with the
  // given YYYY-MM-DD becomes the focus target. (1.9.18)
  const searchParams = useSearchParams();
  const focusId = searchParams.get("focus");
  const focusDate = searchParams.get("focusDate");
  const focusedRef = useRef<HTMLLIElement | null>(null);

  // Resolve focusDate → focused video id by scanning the live list.
  // Title-extracted date (the actual raid day) takes priority over
  // posted_at, matching the same convention as the backfill logic.
  const focusedVideoId = useMemo(() => {
    if (focusId) return focusId;
    if (!focusDate) return null;
    for (const v of live) {
      const fallbackYear = v.postedAt
        ? new Date(v.postedAt).getUTCFullYear()
        : new Date(v.createdAt).getUTCFullYear();
      const titleD = extractDateFromTitle(v.title, fallbackYear);
      if (titleD) {
        const iso = `${titleD.y}-${String(titleD.m).padStart(2, "0")}-${String(titleD.d).padStart(2, "0")}`;
        if (iso === focusDate) return v.id;
      } else if (v.postedAt && v.postedAt.startsWith(focusDate)) {
        return v.id;
      } else if (v.createdAt.startsWith(focusDate)) {
        return v.id;
      }
    }
    return null;
  }, [focusId, focusDate, live]);
  // Sort mode lives in localStorage so the user's choice survives reloads.
  // Default to date (newest-first) — matches the request to view videos
  // chronologically; switching to custom enables DnD reordering.
  const [sortMode, setSortMode] = useState<SortMode>("date");
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(SORT_STORAGE_KEY);
    if (stored === "custom" || stored === "date") setSortMode(stored);
  }, []);

  // Scroll the focused card into view once it mounts. Re-runs when
  // the focusedVideoId changes or when the live list arrives (since
  // the ref is set during render of the matching card). The matching
  // card uses a thin one-shot CSS animation for the highlight.
  useEffect(() => {
    if (!focusedVideoId) return;
    const el = focusedRef.current;
    if (!el) return;
    const id = window.setTimeout(() => {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 50);
    return () => window.clearTimeout(id);
  }, [focusedVideoId, live.length]);
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

  // Cumulative duration across all videos in this category. NULL durations
  // (not yet backfilled) are treated as 0. timeToClear sums only videos
  // posted on/before the first-clear timestamp — same definition as the
  // category list page badge.
  const { totalSeconds, timeToClearSeconds, missingDurationCount } =
    useMemo(() => {
      let total = 0;
      let toClear = 0;
      let missing = 0;
      const clearMs = firstClearAt
        ? new Date(firstClearAt).getTime()
        : null;
      for (const v of live) {
        if (v.durationSeconds === null) {
          missing += 1;
          continue;
        }
        total += v.durationSeconds;
        if (clearMs !== null) {
          const ref = v.postedAt ?? v.createdAt;
          const t = new Date(ref).getTime();
          if (Number.isFinite(t) && t <= clearMs) toClear += v.durationSeconds;
        }
      }
      return {
        totalSeconds: total,
        timeToClearSeconds: toClear,
        missingDurationCount: missing,
      };
    }, [live, firstClearAt]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase">
          <span>
            {videos.length} video{videos.length === 1 ? "" : "s"}
          </span>
          {totalSeconds > 0 && (
            <span
              className="inline-flex items-center gap-1 rounded-sm border border-violet-400/40 bg-violet-400/10 px-1.5 py-px text-[9px] text-violet-200 normal-case"
              title={`累計練習時間: ${formatDurationLong(totalSeconds)}${
                missingDurationCount > 0
                  ? ` (${missingDurationCount} 件は再生時間未取得)`
                  : ""
              }`}
            >
              <Timer className="h-2.5 w-2.5" aria-hidden />
              {formatDurationShort(totalSeconds)}
            </span>
          )}
          {firstClearAt && timeToClearSeconds > 0 && (
            <span
              className="inline-flex items-center gap-1 rounded-sm border border-emerald-400/45 bg-emerald-400/10 px-1.5 py-px text-[9px] text-emerald-200 normal-case"
              title={`クリアまでの累計時間: ${formatDurationLong(timeToClearSeconds)}`}
            >
              →{formatDurationShort(timeToClearSeconds)}
            </span>
          )}
          {firstClearAt && (
            <span
              className="inline-flex items-center gap-1 rounded-sm border border-amber-400/45 bg-amber-400/10 px-1.5 py-px text-[9px] text-amber-200 normal-case"
              title={`初クリア: ${formatFirstClear(firstClearAt, "long")}`}
            >
              <Trophy className="h-2.5 w-2.5" aria-hidden />
              {formatFirstClear(firstClearAt, "short")}
            </span>
          )}
          {videos.length > 1 && sortMode === "custom" && (
            <span className="text-muted-foreground/60">
              · ドラッグで並び替え
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {/* 複数選択モード切替 (1.9.15) — オフ時はカード本体クリックが
              YouTube 再生 / 編集など通常動作。オン時はカード上に
              チェックボックスが現れ、クリックで選択切替。複数選択時は
              ヘッダー右端に「N 件削除」ボタンが追加表示される */}
          <button
            type="button"
            onClick={() => {
              setSelectMode((m) => {
                if (m) setSelectedIds(new Set());
                return !m;
              });
            }}
            className={
              "inline-flex h-7 items-center gap-1 rounded-md border px-2 font-mono text-[10px] tracking-[0.18em] uppercase transition-colors " +
              (selectMode
                ? "border-[var(--neon-cyan)]/60 bg-[var(--neon-cyan)]/12 text-[var(--neon-cyan)]"
                : "border-border/40 bg-background/30 text-muted-foreground hover:text-foreground")
            }
            title={
              selectMode
                ? "選択モードを解除 (選択もリセット)"
                : "複数選択モードに入る"
            }
            aria-pressed={selectMode}
          >
            {selectMode ? (
              <CheckSquare className="h-3 w-3" aria-hidden />
            ) : (
              <Square className="h-3 w-3" aria-hidden />
            )}
            選択
          </button>
          {selectMode && selectedIds.size > 0 && (
            <button
              type="button"
              disabled={bulkDeleting}
              onClick={async () => {
                const count = selectedIds.size;
                if (
                  !window.confirm(
                    `選択した ${count} 件の動画を削除します。元に戻せません。よろしいですか？`,
                  )
                ) {
                  return;
                }
                setBulkDeleting(true);
                const ids = [...selectedIds];
                const results = await Promise.all(
                  ids.map((id) => deleteCategoryLink(id)),
                );
                const failed = results
                  .map((r, i) => ({ r, id: ids[i]! }))
                  .filter((x) => !x.r.ok);
                setBulkDeleting(false);
                if (failed.length === 0) {
                  toast.success(`${count} 件削除しました`);
                  setSelectedIds(new Set());
                  setSelectMode(false);
                } else {
                  const okCount = count - failed.length;
                  toast.error(
                    `${okCount} 件削除、${failed.length} 件失敗: ${failed[0]?.r.ok === false ? failed[0].r.reason : ""}`,
                  );
                  setSelectedIds(
                    new Set(failed.map((x) => x.id)),
                  );
                }
              }}
              className="inline-flex h-7 items-center gap-1 rounded-md border border-rose-400/60 bg-rose-400/10 px-2 font-mono text-[10px] tracking-[0.18em] text-rose-200 uppercase transition-colors hover:border-rose-400/80 hover:bg-rose-400/20 disabled:opacity-50"
              title="選択した動画を削除"
            >
              <Trash2 className="h-3 w-3" aria-hidden />
              {bulkDeleting ? "削除中…" : `${selectedIds.size} 件削除`}
            </button>
          )}
          {/* Sort mode toggle: 日付順 (newest first) or カスタム順 (DnD). */}
          <div
            className="inline-flex items-center rounded-md border border-border/40 bg-background/30 p-0.5 font-mono text-[10px] tracking-[0.18em] uppercase"
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
                  focused={v.id === focusedVideoId}
                  refIfFocused={
                    v.id === focusedVideoId ? focusedRef : null
                  }
                  selectMode={selectMode}
                  selected={selectedIds.has(v.id)}
                  onToggleSelect={() => toggleSelected(v.id)}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      ) : (
        // Date-sorted layout — DnD makes no sense here so render plain cards.
        <ul className="grid gap-4 sm:grid-cols-2">
          {videos.map((v) => (
            <li
              key={v.id}
              ref={v.id === focusedVideoId ? focusedRef : undefined}
              className={
                v.id === focusedVideoId
                  ? "animate-[pulse_1.4s_ease-out_2] rounded-lg ring-2 ring-[var(--neon-cyan)]/60 ring-offset-2 ring-offset-background"
                  : ""
              }
            >
              <VideoCard
                video={v}
                onEdit={() => setEditTarget(v)}
                selectMode={selectMode}
                selected={selectedIds.has(v.id)}
                onToggleSelect={() => toggleSelected(v.id)}
              />
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
  focused = false,
  refIfFocused = null,
  selectMode = false,
  selected = false,
  onToggleSelect,
}: {
  video: CategoryLink;
  onEdit: () => void;
  focused?: boolean;
  refIfFocused?: React.RefObject<HTMLLIElement | null> | null;
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
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

  // Compose dnd-kit's setNodeRef with the optional focus ref so a
  // single <li> can satisfy both. Both functions/objects are called
  // with the DOM node when it mounts.
  const composedRef = (node: HTMLLIElement | null) => {
    setNodeRef(node);
    if (refIfFocused) {
      refIfFocused.current = node;
    }
  };

  return (
    <li
      ref={composedRef}
      style={style}
      {...attributes}
      className={
        focused
          ? "animate-[pulse_1.4s_ease-out_2] rounded-lg ring-2 ring-[var(--neon-cyan)]/60 ring-offset-2 ring-offset-background"
          : ""
      }
    >
      <VideoCard
        video={video}
        onEdit={onEdit}
        dragListeners={listeners}
        selectMode={selectMode}
        selected={selected}
        onToggleSelect={onToggleSelect}
      />
    </li>
  );
}

function VideoCard({
  video,
  onEdit,
  dragListeners,
  selectMode = false,
  selected = false,
  onToggleSelect,
}: {
  video: CategoryLink;
  onEdit: () => void;
  dragListeners?: ReturnType<typeof useSortable>["listeners"];
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}) {
  const ytId = parseYouTubeId(video.url);
  // safeHref returns undefined for non-http(s) values, which renders the
  // anchor as inert (no clickable XSS surface) — defense in depth alongside
  // the form-level + server-action validators.
  const videoHref = safeHref(video.url);
  const logsHref = safeHref(video.logsUrl);
  return (
    <Card
      className={
        "glass neon-edge group flex flex-col gap-1 overflow-hidden p-0 transition-all hover:-translate-y-0.5 " +
        (selected
          ? "ring-2 ring-rose-400/70 ring-offset-2 ring-offset-background"
          : "")
      }
    >
      <div className="relative">
        {ytId ? (
          <YouTubePreview id={ytId} url={video.url} title={video.title} />
        ) : (
          <a
            href={videoHref}
            target="_blank"
            rel="noopener noreferrer"
            className="grid aspect-video place-items-center bg-secondary/30 text-muted-foreground transition-colors hover:bg-secondary/50 hover:text-foreground"
          >
            <div className="flex flex-col items-center gap-2">
              <LinkSiteIcon
                url={video.url}
                variant="fine"
                className="h-8 w-8"
              />
              <span className="font-mono text-[10px] tracking-[0.18em] uppercase">
                {LINK_SITE_LABEL[detectLinkSite(video.url)]}
              </span>
            </div>
          </a>
        )}

        {/* 選択モード中はサムネイル左上に大きめのチェックボックスを
            表示。サムネイル全体をクリックすると選択トグルになる。 */}
        {selectMode && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onToggleSelect?.();
            }}
            aria-pressed={selected}
            aria-label={
              selected
                ? `${video.title} の選択を解除`
                : `${video.title} を選択`
            }
            className={
              "absolute inset-0 z-20 flex items-start justify-end p-3 transition-colors " +
              (selected
                ? "bg-rose-400/15"
                : "bg-black/0 hover:bg-black/20")
            }
          >
            <span
              className={
                "inline-flex h-7 w-7 items-center justify-center rounded-md border-2 backdrop-blur-sm transition-colors " +
                (selected
                  ? "border-rose-400 bg-rose-400/80 text-white"
                  : "border-white/70 bg-black/50 text-white/0")
              }
            >
              {selected ? (
                <CheckSquare className="h-4 w-4" aria-hidden />
              ) : (
                <Square className="h-4 w-4 opacity-90" aria-hidden />
              )}
            </span>
          </button>
        )}

        {/* Drag handle floats over the top-left corner of the thumbnail. */}
        {dragListeners && !selectMode && (
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

      <div className="flex min-h-[2.625rem] items-start gap-2 px-3 pb-1">
        <a
          href={videoHref}
          target="_blank"
          rel="noopener noreferrer"
          title={video.title}
          className="line-clamp-2 min-w-0 flex-1 break-words font-display text-sm text-foreground transition-colors hover:text-[var(--neon-cyan)]"
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
      {/* Description は無くても 1 行分を確保してカード高さを揃える
          (text-xs 0.75rem × leading-relaxed 1.625 = 1.21875rem/line)。
          中身が 2 行に達した場合のみ 2 行分まで伸びる (`line-clamp-2`)。
          1.9 (2026-04-28) の Discord 取り込み〜FFLogs 間の余白圧縮要望に
          合わせ、reservation を 2 行 → 1 行に縮小。 */}
      <p
        title={video.description || undefined}
        className="line-clamp-2 min-h-[1.21875rem] px-3 text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap"
      >
        {video.description || ""}
      </p>
      {/* Badges 行は内容が無くてもカード高さを揃えるため常に配置 (min-h で 1
          行分を確保)。FFLogs と durationSeconds は両方無い動画もある */}
      <div className="flex min-h-[1.75rem] flex-wrap items-center gap-1.5 px-3">
        {logsHref && (
          <a
            href={logsHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-sm border border-amber-400/45 bg-amber-400/10 px-2 py-1 font-mono text-[10px] tracking-[0.18em] text-amber-200 uppercase transition-colors hover:bg-amber-400/15 hover:text-amber-100"
            title="FFLogs レポートを開く"
          >
            <BarChart3 className="h-3 w-3" aria-hidden />
            FFLogs
            <ExternalLink className="h-2.5 w-2.5 opacity-70" aria-hidden />
          </a>
        )}
        {video.durationSeconds !== null && (
          <span
            className="inline-flex items-center gap-1 rounded-sm border border-violet-400/40 bg-violet-400/10 px-1.5 py-1 font-mono text-[10px] tracking-[0.18em] text-violet-200"
            title={`再生時間: ${formatDurationLong(video.durationSeconds)}`}
          >
            <Timer className="h-2.5 w-2.5" aria-hidden />
            {formatDurationShort(video.durationSeconds)}
          </span>
        )}
      </div>
      <a
        href={videoHref}
        target="_blank"
        rel="noopener noreferrer"
        title={video.url}
        className="flex items-center gap-1 px-3 pb-3 font-mono text-[10px] text-muted-foreground/70 hover:text-foreground/80"
      >
        <LinkSiteIcon
          url={video.url}
          variant="fine"
          className="h-3 w-3 shrink-0"
        />
        <span className="min-w-0 flex-1 truncate">{video.url}</span>
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
          // Tighten the embed: don't leak the portal URL as Referer
          // (privacy), and lazy-load when off-screen (perf).
          referrerPolicy="no-referrer"
          loading="lazy"
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
        className="absolute top-2 right-2 inline-flex items-center gap-1 rounded-md bg-black/60 px-1.5 py-1 font-mono text-[9px] tracking-[0.18em] text-white/80 uppercase transition-colors hover:text-white"
        aria-label="YouTubeで開く"
      >
        <ExternalLink className="h-3 w-3" aria-hidden />
        YouTube
      </a>
    </button>
  );
}
