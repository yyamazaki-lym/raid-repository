"use client";

import { useEffect, useMemo, useState } from "react";
import {
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
  setRecruitmentTemplateOrder,
  type RecruitmentTemplate,
} from "@/lib/recruitment-templates-client";
import {
  applyOptimisticOrder,
  useSortableReorder,
} from "@/lib/use-sortable-reorder";
import { cn } from "@/lib/utils";

/**
 * 募集テンプレ popover の中身 (2026-07-12 監査 C-1)。
 *
 * `recruitment-templates-button.tsx` から分離した DnD 並び替え + カテゴリ
 * 折りたたみ一式。@dnd-kit (core/sortable/utilities) の唯一の TOP 経路
 * 静的 import 元だったため、`next/dynamic` (button 側) で「popover を
 * 開いた時だけ」ロードされる別 chunk に切り出す。トリガーボタン自体は
 * button 側に静的に残る = 常時表示要素のレイアウトシフトなし
 * (todos/11.md の「常時表示トリガーの dynamic 化禁止」に非抵触)。
 *
 * 機能・構造は移動のみで不変 (v3 の outer/inner DndContext 分離、
 * CSS.Translate、カテゴリ折りたたみ、★Top ハイライト)。
 */

export type CategoryOption = {
  id: string;
  name: string;
  /** Used to build per-category macro-page links (`/category/{slug}/macros`) */
  slug: string;
};

export function RecruitmentTemplatesPopoverBody({
  templates,
  categories,
}: {
  templates: RecruitmentTemplate[];
  categories: CategoryOption[];
}) {
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

  if (templates.length === 0) {
    return (
      <div className="px-2 py-3 text-center text-[11px] text-muted-foreground">
        テンプレート未登録 — マクロページから登録できます
      </div>
    );
  }

  return (
    <>
      <p className="px-1.5 pt-1 pb-1 text-[10px] leading-snug text-muted-foreground/85">
        <span className="font-mono tracking-[0.18em] text-[var(--neon-cyan)]/80 uppercase">
          ★ Top
        </span>
        {" が次回開催日カードのコピー対象。ハンドルをドラッグでコンテンツブロックごと並び替え。"}
      </p>
      <DndContext
        // dnd-kit の採番 (`DndDescribedBy-<n>`) は SSR とクライアントで
        // ずれて hydration mismatch になるため id を明示する
        // (category-list.tsx の詳しい注記を参照)。
        id="dnd-recruitment-sections"
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onCategoryDragEnd}
      >
        <SortableContext items={groupKeys} strategy={verticalListSortingStrategy}>
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
          } のコンテンツブロックをドラッグ`}
          title="ドラッグでこのコンテンツ全体 (中の募集文も全部) を並び替え"
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
          <span className="truncate text-[10px] tracking-normal text-muted-foreground">
            {categoryName ?? "（コンテンツ未設定）"}
          </span>
          <span className="font-mono text-[9px] text-muted-foreground/60">
            {group.items.length}
          </span>
          {containsTop && (
            <span
              className="font-mono text-[9px] tracking-[0.18em] text-[var(--neon-cyan)]/85 uppercase"
              title="このコンテンツに ★ Top のテンプレが含まれる"
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
          // dnd-kit の採番 (`DndDescribedBy-<n>`) は SSR とクライアントで
          // ずれて hydration mismatch になるため id を明示する
          // (category-list.tsx の詳しい注記を参照)。
          // section は同時に複数開けるので、id はセクションキーで一意化する
          // (同一 id の要素が複数できると describedby の参照が壊れる)。
          id={`dnd-recruitment-rows-${groupKey}`}
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
