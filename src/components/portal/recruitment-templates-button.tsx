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
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
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
  setRecruitmentTemplateOrder,
  useRealtimeRecruitmentTemplates,
  type RecruitmentTemplate,
} from "@/lib/recruitment-templates-client";
import {
  applyOptimisticOrder,
  useSortableReorder,
} from "@/lib/use-sortable-reorder";
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

  // DnD 並び替えの共通フック (C-1/C-4)。group / row の 2 ハンドラで 1 つの
  // optimistic state を共有する (どちらもグローバル sort_order を更新)。
  const { optimisticOrder, sensors, commit, handleDragEnd, syncOnSettle } =
    useSortableReorder({ persist: setRecruitmentTemplateOrder });

  const ordered = useMemo(
    () => applyOptimisticOrder(templates, optimisticOrder),
    [templates, optimisticOrder],
  );
  // DB 確定順 (templates) が楽観順に追いついたら畳む (値マッチ)。
  useEffect(() => {
    syncOnSettle(templates.map((t) => t.id));
  }, [templates, syncOnSettle]);

  const grouped = useMemo(() => groupByCategory(ordered), [ordered]);

  // The first template (sort_order = 0) is what the next-session card's
  // quick-copy button uses. Highlight it in the list and auto-expand its
  // category section.
  const topId = ordered[0]?.id ?? null;
  const topCategoryId = ordered[0]?.categoryId ?? null;

  // Per-category collapsible state. Default: only the section containing
  // the current top is open; others start collapsed for compactness.
  // キーは categoryId (null = 未分類セクション = `__none__`)。
  const [openCategories, setOpenCategories] = useState<Set<string>>(() => {
    const init = new Set<string>();
    init.add(topCategoryId ?? "__none__");
    return init;
  });

  // If the top template's category changes (e.g., after a reorder), make
  // sure the new top's section is expanded so the user can see the new ★
  // without manually opening it.
  useEffect(() => {
    const key = topCategoryId ?? "__none__";
    setOpenCategories((prev) => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  }, [topCategoryId]);

  const toggleCategory = (key: string) => {
    setOpenCategories((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // 上位 SortableContext のキー = カテゴリグループキー (categoryId
  // か "__none__")。block 単位の useSortable で section ごと並び替え。
  //
  // 2.1 (2026-04-29) v3: row 単位の DnD を popover 内で可能にする際、
  // 旧 v2 では outer DndContext + nested SortableContext で実装した
  // ところ collisionDetection が category id と template id を混同して
  // 「ドラッグしても追従しない」事象が出ていた (ユーザー報告)。
  // v3 では outer (category) と inner (row) の DndContext を完全分離し、
  // それぞれに独立した onDragEnd を持たせる構造に切替。
  const groupKeys = useMemo(
    () => grouped.map((g) => g.categoryId ?? "__none__"),
    [grouped],
  );

  // section (= category group) 単位の並び替え。grouped を arrayMove して
  // グローバル flat 順に展開し commit (group 単位なので handleDragEnd の
  // 単純 flat reorder には乗らず、専用ロジックで next を組む)。
  const onCategoryDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = groupKeys.indexOf(String(active.id));
    const newIndex = groupKeys.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;

    const reorderedGroups = arrayMove(grouped, oldIndex, newIndex);
    const next = reorderedGroups.flatMap((g) => g.items.map((t) => t.id));
    const srcName = grouped[oldIndex]?.categoryName ?? "未分類";
    const dstName = grouped[newIndex]?.categoryName ?? "未分類";

    const result = await commit(next);
    if (result.ok) {
      toast.success(`「${srcName}」を「${dstName}」の位置に移動しました`);
    }
  };

  // 行並び替えは groupId で限定して同 category 内に閉じる (cross-category
  // drag は groupBy 再描画で結果が直感に反するため)。section ごとの inner
  // DndContext で発火するので、active / over はその section のテンプレ
  // id のみ。
  // 行並び替えは inner DndContext で発火し active/over は section 内テンプレ
  // id のみ。grouped が category 内を連続配置するので、グローバル flat
  // (`ordered`) 上の arrayMove = section 内並び替えと一致する → handleDragEnd
  // (単純 flat reorder) に乗せられる。
  const onRowDragEnd = async (event: DragEndEvent) => {
    const result = await handleDragEnd(event, ordered);
    if (result?.ok) {
      toast.success("並び順を保存しました");
    }
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
              {" が次回開催日カードのコピー対象。ハンドルをドラッグでカテゴリブロックごと並び替え。"}
            </p>
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={onCategoryDragEnd}
            >
              <SortableContext
                items={groupKeys}
                strategy={verticalListSortingStrategy}
              >
                <div className="flex flex-col gap-1">
                  {grouped.map((group) => {
                    const key = group.categoryId ?? "__none__";
                    return (
                      <SortableCategorySection
                        key={key}
                        groupKey={key}
                        group={group}
                        topId={topId}
                        slug={
                          group.categoryId
                            ? slugById.get(group.categoryId) ?? null
                            : null
                        }
                        isOpen={openCategories.has(key)}
                        onToggle={() => toggleCategory(key)}
                        onCopy={copyToClipboard}
                        sensors={sensors}
                        onRowDragEnd={onRowDragEnd}
                      />
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
 * 1 つのカテゴリブロックを sortable 単位として扱う section (TODO #16)。
 *
 * 2.1 (2026-04-29) v2:
 *   - section ヘッダー grip = カテゴリ全体の並び替え (従来通り)
 *   - section 内に nested SortableContext を持ち、各行は個別の row
 *     drag handle を持つ → カテゴリ内の row 単位並び替えが popover 内
 *     から可能 (ユーザー要望)
 *   - transform を `CSS.Translate.toString` に変更。`CSS.Transform`
 *     は scaleX / scaleY を含んでおり、ドラッグ中のセクションが他
 *     セクションのサイズに合わせてスケールしてしまい「文字が拡大縮小
 *     する」見た目バグが出ていた (ユーザー報告)。translate のみ反映
 *     することでこれを解消。
 */
function SortableCategorySection({
  groupKey,
  group,
  topId,
  slug,
  isOpen,
  onToggle,
  onCopy,
  sensors,
  onRowDragEnd,
}: {
  groupKey: string;
  group: TemplateGroup;
  topId: string | null;
  slug: string | null;
  isOpen: boolean;
  onToggle: () => void;
  onCopy: (t: RecruitmentTemplate) => void;
  /** 親と同じ sensor 設定を共有 (距離 / 遅延ガードを揃えるため) */
  sensors: ReturnType<typeof useSortableReorder>["sensors"];
  /** 行並び替えの onDragEnd。section ごとに独立した inner DndContext で発火 */
  onRowDragEnd: (event: DragEndEvent) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: groupKey });
  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 10 : "auto",
  };
  const containsTop = group.items.some((t) => t.id === topId);
  const categoryName = group.categoryName;
  const rowIds = useMemo(
    () => group.items.map((t) => t.id),
    [group.items],
  );
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      className={cn(
        "rounded-sm border border-border/40 bg-secondary/15",
        isDragging && "shadow-[0_8px_24px_-8px_rgba(0,0,0,0.5)]",
      )}
    >
      <div className="flex items-center justify-between gap-1.5 px-1.5 py-1">
        {/* section 全体の drag handle (ヘッダー位置) */}
        <button
          type="button"
          {...listeners}
          aria-label={`${
            categoryName ?? "（コンテンツ未設定）"
          } のカテゴリブロックをドラッグ`}
          title="ドラッグでこのカテゴリ全体 (中の募集文も全部) を並び替え"
          className="inline-flex h-7 w-5 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground hover:text-foreground active:cursor-grabbing"
        >
          <GripVertical className="h-3 w-3" aria-hidden />
        </button>
        <button
          type="button"
          onClick={onToggle}
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
            {group.items.length}
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
        // Inner DndContext: 行並び替え専用、outer (category) と完全分離。
        // 親の DndContext と同居させると collisionDetection が混線して
        // 「ドラッグ追従しない」事象が出る (v2 のバグ報告)。section ごとに
        // 独立 DndContext を立てれば inner の active / over は当該 row
        // 群のみ可視。
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onRowDragEnd}
        >
          <SortableContext
            items={rowIds}
            strategy={verticalListSortingStrategy}
          >
            <ul className="flex flex-col gap-0.5 border-t border-border/30 p-1">
              {group.items.map((t) => (
                <SortableTemplateRow
                  key={t.id}
                  template={t}
                  isTop={t.id === topId}
                  onCopy={() => onCopy(t)}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}

/**
 * 1 行分の募集文 (2.1 v2 で sortable 化)。row 自身が useSortable を
 * 持ち、grip ハンドルで行単位の並び替えが可能。親 section の DnD と
 * 同居するため、上位 onDragEnd で active.id が groupKey か template
 * id かを判別して挙動を分岐させている。
 */
function SortableTemplateRow({
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
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
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
        isDragging && "shadow-[0_4px_12px_-4px_rgba(0,0,0,0.5)]",
      )}
    >
      <button
        type="button"
        {...listeners}
        aria-label={`「${
          template.label || "通常募集"
        }」を行単位でドラッグ並び替え`}
        title="ドラッグでこの行を並び替え"
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

type TemplateGroup = {
  /** カテゴリの識別子。null = 未分類。同名カテゴリの衝突を避けるため
   *  グルーピングは `categoryId` で行い、表示用の `categoryName` は別フィールド。 */
  categoryId: string | null;
  categoryName: string | null;
  items: RecruitmentTemplate[];
};

function groupByCategory(templates: RecruitmentTemplate[]): TemplateGroup[] {
  // Preserve overall sort_order — bucket each template into its
  // category group in encounter order. キーは categoryId (TODO #16:
  // 同名カテゴリ衝突を避けつつブロック単位の並び替えで identity を保つため)。
  const seenOrder: (string | null)[] = [];
  const map = new Map<
    string | null,
    { categoryName: string | null; items: RecruitmentTemplate[] }
  >();
  for (const t of templates) {
    const key = t.categoryId;
    if (!map.has(key)) {
      map.set(key, { categoryName: t.categoryName, items: [] });
      seenOrder.push(key);
    }
    map.get(key)!.items.push(t);
  }
  return seenOrder.map((k) => {
    const g = map.get(k)!;
    return { categoryId: k, categoryName: g.categoryName, items: g.items };
  });
}
