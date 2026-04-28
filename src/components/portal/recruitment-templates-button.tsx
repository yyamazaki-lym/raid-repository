"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  ClipboardCopy,
  ExternalLink,
  GripVertical,
  Star,
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
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  setRecruitmentTemplateCategory,
  setRecruitmentTemplateOrder,
  useRealtimeRecruitmentTemplates,
  type RecruitmentTemplate,
} from "@/lib/recruitment-templates-client";
import { cn } from "@/lib/utils";

/**
 * Header button on the schedule page that exposes saved PT-募集 text
 * templates. Always shows the popover (regardless of count) so the user
 * can always see context — fixes the previous UX where 1 template made
 * the whole button collapse to a direct copy.
 *
 * Templates are grouped by category in the popover for readability,
 * since groups commonly maintain 1-N templates per content (e.g. one
 * for each floor of a 4-floor raid).
 *
 * Features (1.9 (2026-04-28)):
 *   - Inline DnD reorder right inside the popover. Drag handle on each
 *     row updates global sort_order via `setRecruitmentTemplateOrder`,
 *     same as the macro page.
 *   - Per-category collapsible sections. Default open: only the section
 *     containing the global top template. Other sections start
 *     collapsed and require a click on the category header to expand.
 *   - Per-category macro-page link (↗ icon next to the category name).
 *     Routes to `/category/{slug}/macros` for full CRUD on that
 *     category's templates (add / edit / delete + 全角→半角 conversion).
 *
 * The previous in-popover "テンプレートを編集 / 並べ替え" button — and
 * the entire `ManageDialog` it opened — were removed: reorder now lives
 * inline, and CRUD lives on the per-category macro page reachable via
 * the new ↗ link icons.
 */

type CategoryOption = {
  id: string;
  name: string;
  /** Used to build per-category macro-page links (`/category/{slug}/macros`) */
  slug: string;
};

type Props = {
  initial: RecruitmentTemplate[];
  /** Categories used to look up slugs for the per-category link icons. */
  categories: CategoryOption[];
};

export function RecruitmentTemplatesButton({ initial, categories }: Props) {
  const templates = useRealtimeRecruitmentTemplates(initial);

  // category id → slug lookup for the per-category ↗ link icons.
  const slugById = useMemo(
    () => new Map(categories.map((c) => [c.id, c.slug] as const)),
    [categories],
  );
  // category id → name lookup. クロスカテゴリドロップ時に optimistic な
  // categoryName を埋めるため (groupByCategory が categoryName でグルー
  // プングするので、override を反映させないと realtime confirm までの
  // 一瞬で旧セクションに残って見える).
  const nameById = useMemo(
    () => new Map(categories.map((c) => [c.id, c.name] as const)),
    [categories],
  );

  // Optimistic local order for instant DnD feedback. Server confirms via
  // realtime refetch; on failure we revert.
  const [optimisticOrder, setOptimisticOrder] = useState<string[] | null>(null);
  // クロスカテゴリドロップを楽観的に反映するための「対象 1 件分の
  // categoryId 上書き」(TODO #16)。`ordered` 計算の頭で `templates` の
  // 該当 id だけ patch して、新セクションに即時表示させる。realtime が
  // DB から最新を取り直したら勝手に追従するので、あとは override を
  // 落とすだけで良い。
  const [optimisticCategoryOverride, setOptimisticCategoryOverride] =
    useState<{ id: string; categoryId: string | null } | null>(null);

  const ordered = useMemo(() => {
    let base = templates;
    if (optimisticCategoryOverride) {
      const ov = optimisticCategoryOverride;
      const newName = ov.categoryId ? nameById.get(ov.categoryId) ?? null : null;
      base = templates.map((t) =>
        t.id === ov.id
          ? { ...t, categoryId: ov.categoryId, categoryName: newName }
          : t,
      );
    }
    if (!optimisticOrder) return base;
    const idx = new Map(optimisticOrder.map((id, i) => [id, i] as const));
    return [...base].sort((a, b) => {
      const ai = idx.get(a.id);
      const bi = idx.get(b.id);
      if (ai === undefined && bi === undefined) return 0;
      if (ai === undefined) return 1;
      if (bi === undefined) return -1;
      return ai - bi;
    });
  }, [templates, optimisticOrder, optimisticCategoryOverride, nameById]);

  const grouped = useMemo(() => groupByCategory(ordered), [ordered]);

  // The first template (sort_order = 0) is what the next-session card's
  // quick-copy button uses. Highlight it in the list and auto-expand its
  // category section.
  const topId = ordered[0]?.id ?? null;
  const topCategoryName = ordered[0]?.categoryName ?? null;

  // Per-category collapsible state. Default: only the section containing
  // the current top is open; others start collapsed for compactness.
  const [openCategories, setOpenCategories] = useState<Set<string>>(() => {
    const init = new Set<string>();
    if (topCategoryName !== null) init.add(topCategoryName);
    else init.add("__none__");
    return init;
  });

  // If the top template's category changes (e.g., after a reorder), make
  // sure the new top's section is expanded so the user can see the new ★
  // without manually opening it.
  useEffect(() => {
    const key = topCategoryName ?? "__none__";
    setOpenCategories((prev) => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  }, [topCategoryName]);

  const toggleCategory = (key: string) => {
    setOpenCategories((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

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
    const activeT = ordered.find((t) => t.id === active.id);
    const overT = ordered.find((t) => t.id === over.id);
    if (!activeT || !overT) return;
    const oldIndex = ordered.findIndex((t) => t.id === active.id);
    const newIndex = ordered.findIndex((t) => t.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(ordered, oldIndex, newIndex).map((t) => t.id);
    setOptimisticOrder(next);

    // TODO #16: drop 先の over template が別カテゴリのものなら、active の
    // category_id も追従させる。これをやらないと sort_order だけ動いて、
    // realtime refetch 後に元のカテゴリセクションに視覚的に戻ってしまう。
    const crossCategory = activeT.categoryId !== overT.categoryId;
    if (crossCategory) {
      setOptimisticCategoryOverride({
        id: activeT.id,
        categoryId: overT.categoryId,
      });
    }

    const ops: Promise<{ ok: true } | { ok: false; reason: string }>[] = [
      setRecruitmentTemplateOrder(next),
    ];
    if (crossCategory) {
      ops.push(
        setRecruitmentTemplateCategory(activeT.id, overT.categoryId),
      );
    }
    const results = await Promise.all(ops);
    const failed = results.find((r) => !r.ok) as
      | { ok: false; reason: string }
      | undefined;
    if (failed) {
      toast.error("並び替え保存失敗: " + failed.reason);
      setOptimisticOrder(null);
      setOptimisticCategoryOverride(null);
      return;
    }
    if (crossCategory) {
      const targetName =
        (overT.categoryId ? nameById.get(overT.categoryId) : null) ??
        overT.categoryName ??
        "未分類";
      toast.success(
        `「${activeT.label || "通常募集"}」を「${targetName}」に移動しました`,
      );
    }
    setTimeout(() => {
      setOptimisticOrder(null);
      setOptimisticCategoryOverride(null);
    }, 1500);
  };

  const copyToClipboard = async (template: RecruitmentTemplate) => {
    try {
      await navigator.clipboard.writeText(template.body);
      toast.success(`「${displayLabel(template)}」をコピーしました`);
    } catch (e) {
      console.warn("[recruitment-templates] clipboard error:", e);
      toast.error("コピー失敗（ブラウザの権限を確認してください）");
    }
  };

  return (
    <Popover>
      <PopoverTrigger
        aria-label={`PT募集文を選択してコピー (${templates.length}件)`}
        title={`PT募集文 ${templates.length}件 — クリックで一覧`}
        className={cn(
          "inline-flex h-8 w-8 items-center justify-center rounded-md border transition-colors",
          // Muted base — keeps the header palette quiet. Hover / open
          // states tint cyan so the active state is unambiguous.
          "border-border/60 text-muted-foreground",
          "hover:border-[var(--neon-cyan)]/60 hover:text-foreground",
          "data-[popup-open]:border-[var(--neon-cyan)]/60 data-[popup-open]:bg-[var(--neon-cyan)]/12 data-[popup-open]:text-[var(--neon-cyan)]",
        )}
      >
        <ClipboardCopy className="h-4 w-4" aria-hidden />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={4}
        className="glass-popup w-[max(20rem,min(calc(100vw-1rem),32rem))] gap-1 p-1.5"
      >
        {templates.length === 0 ? (
          <div className="px-2 py-3 text-center text-[11px] text-muted-foreground">
            テンプレート未登録 — マクロページから登録できます
          </div>
        ) : (
          <>
            <p className="px-1.5 pt-1 pb-1 text-[10px] leading-snug text-muted-foreground/85">
              <span className="font-mono tracking-[0.18em] text-[var(--neon-cyan)]/80 uppercase">
                ★ Top
              </span>
              {" が次回開催日カードのコピー対象。ハンドルをドラッグで並び替え。"}
            </p>
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={onDragEnd}
            >
              <SortableContext
                items={ordered.map((t) => t.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="flex flex-col gap-1">
                  {grouped.map(({ categoryName, items }) => {
                    const key = categoryName ?? "__none__";
                    const isOpen = openCategories.has(key);
                    const containsTop = items.some((t) => t.id === topId);
                    // Use the first template's categoryId to look up the
                    // slug for the macro-page link icon. All items in
                    // this group share categoryId.
                    const categoryId = items[0]?.categoryId ?? null;
                    const slug = categoryId ? slugById.get(categoryId) ?? null : null;
                    return (
                      <div
                        key={key}
                        className="rounded-sm border border-border/40 bg-secondary/15"
                      >
                        <div className="flex items-center justify-between gap-1.5 px-1.5 py-1">
                          <button
                            type="button"
                            onClick={() => toggleCategory(key)}
                            aria-expanded={isOpen}
                            aria-label={`${
                              categoryName ?? "（コンテンツ未設定）"
                            } のテンプレートを${isOpen ? "閉じる" : "開く"}`}
                            className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded px-1 text-left hover:bg-secondary/40"
                          >
                            <ChevronDown
                              className={cn(
                                "h-3 w-3 shrink-0 text-muted-foreground transition-transform",
                                isOpen ? "rotate-0" : "-rotate-90",
                              )}
                              aria-hidden
                            />
                            <span className="truncate font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase">
                              {categoryName ?? "（コンテンツ未設定）"}
                            </span>
                            <span className="font-mono text-[9px] text-muted-foreground/60">
                              {items.length}
                            </span>
                            {containsTop && (
                              <span
                                className="font-mono text-[9px] tracking-[0.18em] text-[var(--neon-cyan)]/85 uppercase"
                                title="このカテゴリに ★ Top のテンプレが含まれる"
                              >
                                ★
                              </span>
                            )}
                          </button>
                          {slug && (
                            <a
                              href={`/category/${slug}/macros`}
                              title={`「${categoryName}」のマクロページを開く (新規 / 編集 / 削除)`}
                              aria-label={`「${categoryName}」のマクロページを開く`}
                              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-secondary/60 hover:text-[var(--neon-cyan)]"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <ExternalLink className="h-3 w-3" aria-hidden />
                            </a>
                          )}
                        </div>
                        {isOpen && (
                          <ul className="flex flex-col gap-0.5 border-t border-border/30 p-1">
                            {items.map((t) => (
                              <SortableTemplateItem
                                key={t.id}
                                template={t}
                                isTop={t.id === topId}
                                onCopy={() => copyToClipboard(t)}
                              />
                            ))}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </div>
              </SortableContext>
            </DndContext>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

/**
 * One row inside the popover's per-category list. Drag handle on the
 * left, click anywhere else to copy the body. ★ when this is the global
 * top template (the one the next-session card's quick-copy button uses).
 */
function SortableTemplateItem({
  template,
  isTop,
  onCopy,
}: {
  template: RecruitmentTemplate;
  isTop: boolean;
  onCopy: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: template.id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : "auto",
  };
  return (
    <li
      ref={setNodeRef}
      style={style}
      {...attributes}
      className={cn(
        "flex items-start gap-1 rounded-sm",
        isTop &&
          "bg-[var(--neon-cyan)]/8 ring-1 ring-inset ring-[var(--neon-cyan)]/30",
      )}
    >
      <button
        type="button"
        {...listeners}
        aria-label={`${template.label || "通常募集"} のドラッグハンドル`}
        title="ドラッグで並び替え (グローバル順序に反映 → トップの「募集」ボタンも自動連動)"
        className="inline-flex h-7 w-5 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground hover:text-foreground active:cursor-grabbing"
      >
        <GripVertical className="h-3 w-3" aria-hidden />
      </button>
      <button
        type="button"
        onClick={onCopy}
        aria-label={`${template.label || "通常募集"} の本文をコピー`}
        title="クリックで本文をコピー"
        className="flex min-w-0 flex-1 cursor-pointer items-start gap-2 rounded px-1 py-1 text-left hover:bg-secondary/40"
      >
        {isTop ? (
          <Star
            className="mt-0.5 h-3.5 w-3.5 shrink-0 fill-[var(--neon-cyan)] text-[var(--neon-cyan)]"
            aria-hidden
          />
        ) : (
          <ClipboardCopy
            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--neon-cyan)]"
            aria-hidden
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm">
            {template.label || "通常募集"}
            {isTop && (
              <span className="ml-1.5 font-mono text-[9px] tracking-[0.18em] text-[var(--neon-cyan)] uppercase">
                Top
              </span>
            )}
          </p>
          <p className="truncate text-[10px] text-muted-foreground/80">
            {template.body.slice(0, 60)}
            {template.body.length > 60 ? "…" : ""}
          </p>
        </div>
      </button>
    </li>
  );
}

/**
 * Lightweight quick-copy button suitable for embedding inline (e.g.
 * the next-session card). Copies the topmost template directly on
 * click; hovering reveals a floating preview of the body so the user
 * can confirm what they're about to copy without firing first.
 *
 * Mobile (no hover) falls through gracefully — the click still copies
 * and the preview never shows. The button's `title` attribute carries
 * the label as a fallback for keyboard / a11y.
 */
export function RecruitmentTopCopyButton({
  initial,
}: {
  initial: RecruitmentTemplate[];
}) {
  const templates = useRealtimeRecruitmentTemplates(initial);
  const [hovered, setHovered] = useState(false);
  // Brief "just copied" state — flips the button to emerald + Check
  // icon for ~1.5s as visual confirmation. Toast is also fired but
  // disappears quickly; the button color change is in the user's
  // direct line of sight.
  const [justCopied, setJustCopied] = useState(false);
  if (templates.length === 0) return null;
  const top = templates[0]!;

  // Display label without the category prefix — the schedule page
  // shows the recruitment button in context of "this is the next
  // session's recruitment text", so the category name is implicit
  // and adding it makes the tooltip / toast feel redundant.
  const subLabel = top.label || "通常募集";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(top.body);
      toast.success(`「${subLabel}」をコピーしました`);
      setJustCopied(true);
      window.setTimeout(() => setJustCopied(false), 1500);
    } catch {
      toast.error("コピー失敗");
    }
  };

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        type="button"
        onClick={copy}
        aria-label={`「${subLabel}」を募集文としてコピー`}
        title={`${subLabel} をコピー`}
        className={
          "inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 font-mono text-[11px] tracking-[0.18em] uppercase transition-colors " +
          (justCopied
            ? "border-emerald-400/60 bg-emerald-400/15 text-emerald-300 shadow-[0_0_10px_-4px_color-mix(in_oklch,oklch(0.78_0.18_155)_50%,transparent)]"
            : "border-[var(--neon-cyan)]/40 bg-[var(--neon-cyan)]/10 text-[var(--neon-cyan)] hover:border-[var(--neon-cyan)]/60 hover:bg-[var(--neon-cyan)]/15")
        }
      >
        {justCopied ? (
          <Check className="h-3.5 w-3.5" aria-hidden />
        ) : (
          <ClipboardCopy className="h-3.5 w-3.5" aria-hidden />
        )}
        {justCopied ? "コピー済" : "募集"}
      </button>
      {hovered && (
        <div
          role="tooltip"
          className="glass-popup pointer-events-none absolute right-0 top-full z-50 mt-1 w-[min(28rem,calc(100vw-2rem))] rounded-md border border-[var(--neon-cyan)]/30 p-2 shadow-[0_8px_24px_-12px_var(--neon-cyan)]"
        >
          {/* Sub-label only — category name is implicit (this is the
              top template; the user picked it as default). */}
          <p className="mb-1 font-mono text-[10px] tracking-[0.2em] text-[var(--neon-cyan)] uppercase">
            ★ {top.label || "通常募集"}
          </p>
          <pre className="max-h-[14rem] overflow-y-auto font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-foreground/90">
            {top.body}
          </pre>
        </div>
      )}
    </span>
  );
}

function displayLabel(t: RecruitmentTemplate): string {
  const cat = t.categoryName ?? "未分類";
  return t.label ? `${cat} / ${t.label}` : cat;
}

function groupByCategory(
  templates: RecruitmentTemplate[],
): Array<{ categoryName: string | null; items: RecruitmentTemplate[] }> {
  // Preserve overall sort_order — bucket each template into its
  // category group in encounter order.
  const seenOrder: (string | null)[] = [];
  const map = new Map<string | null, RecruitmentTemplate[]>();
  for (const t of templates) {
    const key = t.categoryName;
    if (!map.has(key)) {
      map.set(key, []);
      seenOrder.push(key);
    }
    map.get(key)!.push(t);
  }
  return seenOrder.map((k) => ({
    categoryName: k,
    items: map.get(k)!,
  }));
}
