"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CaseSensitive,
  ChevronDown,
  ClipboardCopy,
  ClipboardList,
  GripVertical,
  Pencil,
  Plus,
  Save,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { DndContext, closestCenter } from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/portal/empty-state";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  createCategoryMacro,
  deleteCategoryMacro,
  setCategoryMacroOrder,
  updateCategoryMacro,
  useRealtimeCategoryMacros,
  type CategoryMacro,
} from "@/lib/category-macros-client";
import {
  createRecruitmentTemplate,
  deleteRecruitmentTemplate,
  setRecruitmentTemplateOrder,
  updateRecruitmentTemplate,
  useRealtimeRecruitmentTemplates,
  type RecruitmentTemplate,
} from "@/lib/recruitment-templates-client";
import {
  applyOptimisticOrder,
  useSortableReorder,
} from "@/lib/use-sortable-reorder";
import { useConfirm } from "@/components/portal/confirm-dialog";
import { MirrorActionSlot } from "@/components/portal/action-slot";
import { WaymarksSection } from "./waymarks-section";
import type { CategoryWaymark } from "@/lib/category-waymarks-client";
import { useMessages } from "@/lib/i18n/client";
import type { Messages } from "@/lib/i18n/messages";

/**
 * Macro & template page for a single category. Two sections, both
 * fully CRUD via popup dialogs (no inline forms — keeps the eye
 * focused on the list while editing happens in a sheet).
 *
 *   1. マクロ — `category_macros` rows, drag-reorder + label + body
 *   2. 募集文テンプレート — `recruitment_templates` rows filtered to
 *      this category. Full add/edit/delete here too; drag reorder
 *      remains on the schedule page (the global one) since
 *      sort_order is shared across categories.
 */

type RecruitmentTemplateLite = {
  id: string;
  label: string;
  body: string;
  sortOrder: number;
};

type Props = {
  categoryId: string;
  categoryName: string;
  initialMacros: CategoryMacro[];
  initialTemplates: RecruitmentTemplateLite[];
  /** TODO #94 / A-5: 同タブに並べるウェイマーク (markercode) 一覧。 */
  initialWaymarks: CategoryWaymark[];
};

function toHalfWidth(s: string): string {
  return s
    .replace(/[！-～]/g, (c) =>
      String.fromCharCode(c.charCodeAt(0) - 0xfee0),
    )
    .replace(/　/g, " ");
}

async function copyText(text: string, label: string, m: Messages) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(m.crud.copied(label));
  } catch (e) {
    console.warn("[macros] clipboard error:", e);
    toast.error(m.crud.copyFailed);
  }
}

export function MacrosList({
  categoryId,
  categoryName,
  initialMacros,
  initialTemplates,
  initialWaymarks,
}: Props) {
  const macros = useRealtimeCategoryMacros(categoryId, initialMacros);

  return (
    <div className="flex flex-col gap-6">
      <MacrosSection
        categoryId={categoryId}
        categoryName={categoryName}
        macros={macros}
      />
      <TemplatesSection
        categoryId={categoryId}
        categoryName={categoryName}
        initialTemplates={initialTemplates}
      />
      {/* 2026-08-28 ユーザー指摘: ウェイマークは募集文テンプレより使用頻度が
          低いので末尾に置く。
          2026-08-30 (調査 第3回 C-6): ストラテジーボード共有コードは
          プラグイン不要でコンソール勢も取り込めるため、ウェイマークの
          1 つ上に置く。 */}
      <WaymarksSection
        categoryId={categoryId}
        categoryName={categoryName}
        initialWaymarks={initialWaymarks}
        kind="board"
      />
      <WaymarksSection
        categoryId={categoryId}
        categoryName={categoryName}
        initialWaymarks={initialWaymarks}
        kind="waymark"
      />
    </div>
  );
}

// ---------- Macros section -------------------------------------------------

function MacrosSection({
  categoryId,
  categoryName,
  macros,
}: {
  categoryId: string;
  categoryName: string;
  macros: CategoryMacro[];
}) {
  const m = useMessages();
  const [editing, setEditing] = useState<{
    id?: string;
    label: string;
    body: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  // DnD 並び替えの共通フック (C-1/C-4)。
  const { optimisticOrder, sensors, handleDragEnd, syncOnSettle } =
    useSortableReorder({ persist: setCategoryMacroOrder });
  const confirm = useConfirm();

  const ordered = useMemo(
    () => applyOptimisticOrder(macros, optimisticOrder),
    [macros, optimisticOrder],
  );
  // DB 確定順が楽観順に追いついたら畳む (値マッチ)。
  useEffect(() => {
    syncOnSettle(macros.map((m) => m.id));
  }, [macros, syncOnSettle]);

  const startNew = () => setEditing({ label: "", body: "" });
  const startEdit = (m: CategoryMacro) =>
    setEditing({ id: m.id, label: m.label, body: m.body });

  const onSave = async () => {
    if (!editing) return;
    const label = editing.label.trim();
    const body = editing.body.trim();
    if (!body) {
      toast.error(m.macros.enterBody);
      return;
    }
    setBusy(true);
    const result = editing.id
      ? await updateCategoryMacro(editing.id, { label, body })
      : await createCategoryMacro({ categoryId, label, body });
    setBusy(false);
    if (!result.ok) {
      toast.error(m.crud.saveFailed(result.reason));
      return;
    }
    toast.success(editing.id ? m.crud.updated : m.crud.added);
    setEditing(null);
  };

  const onDelete = async (macro: CategoryMacro) => {
    const ok = await confirm({
      title: m.crud.deleteConfirmTitle(macro.label || m.crud.unnamed),
      confirmText: m.common.delete,
      destructive: true,
    });
    if (!ok) return;
    const result = await deleteCategoryMacro(macro.id);
    if (!result.ok) {
      toast.error(m.crud.deleteFailed(result.reason));
      return;
    }
    toast.success(m.crud.deleted);
  };

  const ids = useMemo(() => ordered.map((x) => x.id), [ordered]);

  return (
    <section className="flex flex-col gap-3">
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-[var(--neon-violet)]" aria-hidden />
          <h2 className="font-display text-base">{m.macros.title}</h2>
          <span className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground">
            {m.crud.count(ordered.length)}
          </span>
        </div>
        {/* TODO #58 part2 (2026-05-01): macros は量が少なく中途半端なスクロール
            位置で元位置のボタンが見える状態が起こり得るため、stuck 時に元位置から
            消す (移動) のではなく、元位置はそのまま + 上部 SubTabs 右端に同じ
            アクションの「複製ボタン」を追加表示する形に変更。両ボタンとも startNew
            を発火するため state は親の `editing` で一元管理される。 */}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={startNew}
          className="gap-1.5 text-[11px] tracking-normal"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          {m.macros.addMacro}
        </Button>
        <MirrorActionSlot>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={startNew}
            className="gap-1.5 text-[11px] tracking-normal"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {m.macros.addMacro}
          </Button>
        </MirrorActionSlot>
      </header>

      {ordered.length === 0 ? (
        <EmptyState
          icon={Terminal}
          title={m.macros.emptyTitle}
          description={m.macros.emptyBody}
        />
      ) : (
        <DndContext
          // dnd-kit の採番 (`DndDescribedBy-<n>`) は SSR とクライアントで
          // ずれて hydration mismatch になるため id を明示する
          // (category-list.tsx の詳しい注記を参照)。
          id="dnd-macros"
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={(e) => handleDragEnd(e, ordered)}
        >
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <ul className="flex flex-col gap-2">
              {ordered.map((macro) => (
                <SortableMacroRow
                  key={macro.id}
                  macro={macro}
                  onEdit={() => startEdit(macro)}
                  onDelete={() => onDelete(macro)}
                  onCopy={() =>
                    copyText(
                      macro.body,
                      macro.label || m.macros.categoryMacro(categoryName),
                      m,
                    )
                  }
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      <EditDialog
        kind="macro"
        value={editing}
        onChange={setEditing}
        onSave={onSave}
        busy={busy}
      />
    </section>
  );
}

function SortableMacroRow({
  macro,
  onEdit,
  onDelete,
  onCopy,
}: {
  macro: CategoryMacro;
  onEdit: () => void;
  onDelete: () => void;
  onCopy: () => void;
}) {
  const m = useMessages();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: macro.id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : "auto",
  };
  // Collapsed by default — body is only revealed when the user
  // explicitly opens the row. Reduces vertical scroll when many
  // macros are registered.
  const [expanded, setExpanded] = useState(false);
  const name = macro.label || m.macros.macroFallback;
  return (
    <li
      ref={setNodeRef}
      style={style}
      {...attributes}
      className="rounded-md border border-border/40 bg-secondary/20 transition-colors hover:border-border/80"
    >
      <div
        className={
          "flex items-center justify-between gap-2 px-2 py-2 " +
          (expanded ? "border-b border-border/30" : "")
        }
      >
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-label={m.macros.toggleBodyAria(name, expanded)}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded px-1 text-left hover:bg-secondary/40"
        >
          <span
            {...listeners}
            role="presentation"
            aria-label={m.crud.dragHandleAria(name)}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex h-6 w-6 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground hover:bg-secondary/60 hover:text-foreground active:cursor-grabbing"
            title={m.crud.dragToReorder}
          >
            <GripVertical className="h-3.5 w-3.5" aria-hidden />
          </span>
          <ChevronDown
            className={
              "h-3 w-3 shrink-0 text-muted-foreground transition-transform " +
              (expanded ? "rotate-0" : "-rotate-90")
            }
            aria-hidden
          />
          <p className="truncate font-display text-sm">
            {macro.label || (
              <span className="text-muted-foreground/80">{m.crud.noLabel}</span>
            )}
          </p>
        </button>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onCopy}
            aria-label={m.macros.copyBodyAria(name)}
            title={m.macros.copyBodyTitle}
            className="inline-flex h-7 w-7 items-center justify-center rounded text-[var(--neon-cyan)] hover:bg-[var(--neon-cyan)]/15"
          >
            <ClipboardCopy className="h-3.5 w-3.5" aria-hidden />
          </button>
          <button
            type="button"
            onClick={onEdit}
            aria-label={m.crud.editAria(name)}
            title={m.common.edit}
            className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden />
          </button>
          <button
            type="button"
            onClick={onDelete}
            aria-label={m.crud.deleteAria(name)}
            title={m.common.delete}
            className="inline-flex h-7 w-7 items-center justify-center rounded text-rose-300 hover:bg-rose-500/15 hover:text-rose-200"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      </div>
      {expanded && (
        <pre className="max-h-[12rem] overflow-y-auto px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-foreground/85">
          {macro.body}
        </pre>
      )}
    </li>
  );
}

// ---------- Templates section (now editable too) --------------------------

function TemplatesSection({
  categoryId,
  categoryName,
  initialTemplates,
}: {
  categoryId: string;
  categoryName: string;
  initialTemplates: RecruitmentTemplateLite[];
}) {
  const m = useMessages();
  // Hydrate from initial server-fetched data, then live-track via the
  // realtime hook (which gets ALL templates) and filter back down to
  // this category. Keeps the per-page list in sync with edits made
  // on the schedule page's global manager.
  //
  // Bug fix: `initialAll` MUST be memoized. The realtime hook uses
  // reference equality to detect when `initial` was replaced by the
  // parent (e.g. after router.refresh) — without useMemo a fresh
  // array on every render kept overwriting the live-tracked state
  // with the original server payload, so additions made from this
  // page didn't appear until a hard reload.
  const initialAll = useMemo<RecruitmentTemplate[]>(
    () =>
      initialTemplates.map((t) => ({
        id: t.id,
        label: t.label,
        body: t.body,
        sortOrder: t.sortOrder,
        categoryId,
        categoryName,
      })),
    [initialTemplates, categoryId, categoryName],
  );
  const allLive = useRealtimeRecruitmentTemplates(initialAll);
  const templates = useMemo(
    () => allLive.filter((t) => t.categoryId === categoryId),
    [allLive, categoryId],
  );

  const [editing, setEditing] = useState<{
    id?: string;
    label: string;
    body: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  // DnD 並び替えの共通フック (C-1/C-4)。
  const {
    optimisticOrder,
    sensors: dndSensors,
    handleDragEnd,
    syncOnSettle,
  } = useSortableReorder({ persist: setRecruitmentTemplateOrder });
  const confirm = useConfirm();

  const orderedTemplates = useMemo(
    () => applyOptimisticOrder(templates, optimisticOrder),
    [templates, optimisticOrder],
  );
  // DB 確定順 (templates) が楽観順に追いついたら畳む (値マッチ)。
  useEffect(() => {
    syncOnSettle(templates.map((t) => t.id));
  }, [templates, syncOnSettle]);

  /**
   * このカテゴリ内のドラッグを「グローバル sort_order」に反映する変換。
   * macro page はカテゴリ filter 後のテンプレしか表示しないが
   * `recruitment_templates.sort_order` はグローバル連番。`allLive` を頭から
   * 走査し、このカテゴリ要素を新順 (`filteredIds`) の対応位置の id に置換、
   * 他カテゴリ要素は据え置き → このカテゴリの slot 内でのみ順序が入れ替わる。
   * トップ「募集」ボタンはグローバル先頭をコピー対象にするため、この slot 内
   * 並び替えがグローバル先頭に波及し得る。handleDragEnd の toPersistIds に渡す。
   */
  const toGlobalOrder = (filteredIds: string[]) => {
    let cursor = 0;
    return allLive.map((t) =>
      t.categoryId === categoryId ? filteredIds[cursor++]! : t.id,
    );
  };

  // Top (グローバル先頭) のテンプレ id — トップページの「募集」ボタンが
  // コピー対象にしているテンプレ。このカテゴリにあれば badge を出して
  // 「これがトップ表示と連動」と分かるようにする
  const globalTopId = allLive[0]?.id ?? null;

  const startNew = () => setEditing({ label: "", body: "" });
  const startEdit = (t: RecruitmentTemplate) =>
    setEditing({ id: t.id, label: t.label, body: t.body });

  const onSave = async () => {
    if (!editing) return;
    const label = editing.label.trim();
    const body = editing.body.trim();
    if (!body) {
      toast.error(m.macros.enterBody);
      return;
    }
    setBusy(true);
    const result = editing.id
      ? await updateRecruitmentTemplate(editing.id, { label, body })
      : await createRecruitmentTemplate({ categoryId, label, body });
    setBusy(false);
    if (!result.ok) {
      toast.error(m.crud.saveFailed(result.reason));
      return;
    }
    toast.success(editing.id ? m.crud.updated : m.crud.added);
    setEditing(null);
  };

  const onDelete = async (t: RecruitmentTemplate) => {
    const ok = await confirm({
      title: m.crud.deleteConfirmTitle(t.label || m.recruitment.defaultLabel),
      confirmText: m.common.delete,
      destructive: true,
    });
    if (!ok) return;
    const result = await deleteRecruitmentTemplate(t.id);
    if (!result.ok) {
      toast.error(m.crud.deleteFailed(result.reason));
      return;
    }
    toast.success(m.crud.deleted);
  };

  return (
    <section className="flex flex-col gap-3">
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-[var(--neon-cyan)]" aria-hidden />
          <h2 className="font-display text-base">{m.macros.templatesTitle}</h2>
          <span className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground">
            {m.crud.count(templates.length)}
          </span>
        </div>
        {/* TODO #58 part2: 元位置 in-flow + stuck 時 SubTabs 右端に複製ボタン。
            macros section と同方針 (元位置のボタンは常時表示 / 複製を上部に追加)。 */}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={startNew}
          className="gap-1.5 text-[11px] tracking-normal"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          {m.macros.addTemplate}
        </Button>
        <MirrorActionSlot>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={startNew}
            className="gap-1.5 text-[11px] tracking-normal"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {m.macros.addTemplate}
          </Button>
        </MirrorActionSlot>
      </header>

      {orderedTemplates.length === 0 ? (
        <EmptyState
          description={
            <>
              {m.macros.templatesEmpty1}
              <br />
              {m.macros.templatesEmpty2}
            </>
          }
        />
      ) : (
        <DndContext
          // dnd-kit の採番 (`DndDescribedBy-<n>`) は SSR とクライアントで
          // ずれて hydration mismatch になるため id を明示する
          // (category-list.tsx の詳しい注記を参照)。
          id="dnd-macro-templates"
          sensors={dndSensors}
          collisionDetection={closestCenter}
          onDragEnd={(e) => handleDragEnd(e, orderedTemplates, toGlobalOrder)}
        >
          <SortableContext
            items={orderedTemplates.map((t) => t.id)}
            strategy={verticalListSortingStrategy}
          >
            <ul className="flex flex-col gap-2">
              {orderedTemplates.map((t) => (
                <SortableTemplateRow
                  key={t.id}
                  template={t}
                  fallbackLabel={categoryName}
                  isGlobalTop={t.id === globalTopId}
                  onCopy={() => copyText(t.body, t.label || categoryName, m)}
                  onEdit={() => startEdit(t)}
                  onDelete={() => onDelete(t)}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      <EditDialog
        kind="template"
        value={editing}
        onChange={setEditing}
        onSave={onSave}
        busy={busy}
      />
    </section>
  );
}

function SortableTemplateRow({
  template,
  fallbackLabel,
  isGlobalTop,
  onCopy,
  onEdit,
  onDelete,
}: {
  template: RecruitmentTemplate;
  fallbackLabel: string;
  /** `recruitment_templates` グローバル先頭 (sort_order 最小) のテンプレ
      で、トップページの「募集」ボタンがコピー対象にしているもの */
  isGlobalTop: boolean;
  onCopy: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const m = useMessages();
  // Templates default to expanded — bodies are typically one-line PT
  // 募集 text, short enough that hiding them costs more than it saves.
  // Macros stay collapsed-by-default (multi-line `/p` payloads).
  const [expanded, setExpanded] = useState(true);
  const heading = template.label || m.recruitment.defaultLabel;

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: template.id });
  const dragStyle: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : "auto",
  };

  return (
    <li
      ref={setNodeRef}
      style={dragStyle}
      {...attributes}
      className={
        "rounded-md border bg-secondary/20 transition-colors " +
        (isGlobalTop
          ? "border-[var(--neon-cyan)]/50 ring-1 ring-inset ring-[var(--neon-cyan)]/30"
          : "border-border/40 hover:border-border/80")
      }
    >
      <div
        className={
          "flex items-center justify-between gap-2 px-2 py-2 " +
          (expanded ? "border-b border-border/30" : "")
        }
      >
        {/* Drag handle — クリックターゲットを expand toggle と分離 */}
        <button
          type="button"
          {...listeners}
          aria-label={m.crud.dragHandleAria(heading)}
          title={m.macros.templateHandleTitle}
          className="inline-flex h-6 w-6 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground hover:bg-secondary/60 hover:text-foreground active:cursor-grabbing"
        >
          <GripVertical className="h-3.5 w-3.5" aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-label={m.macros.toggleBodyAria(heading, expanded)}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded px-1 text-left hover:bg-secondary/40"
        >
          <ChevronDown
            className={
              "h-3 w-3 shrink-0 text-muted-foreground transition-transform " +
              (expanded ? "rotate-0" : "-rotate-90")
            }
            aria-hidden
          />
          {/* Plain body font for the sub-label — `font-display` was
              rendering ASCII lowercase letters in a stylized form that
              read as uppercase. Body font preserves user-typed casing. */}
          <p className="truncate text-sm">
            {template.label || (
              <span className="text-muted-foreground/80">
                {m.recruitment.defaultLabel}
              </span>
            )}
            {isGlobalTop && (
              <span
                className="ml-1.5 font-mono text-[9px] tracking-[0.18em] text-[var(--neon-cyan)] uppercase"
                title={m.macros.topTitle}
              >
                ★ Top
              </span>
            )}
          </p>
        </button>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onCopy}
            aria-label={m.macros.copyBodyAria(template.label || fallbackLabel)}
            title={m.macros.copyBodyTitle}
            className="inline-flex h-7 w-7 items-center justify-center rounded text-[var(--neon-cyan)] hover:bg-[var(--neon-cyan)]/15"
          >
            <ClipboardCopy className="h-3.5 w-3.5" aria-hidden />
          </button>
          <button
            type="button"
            onClick={onEdit}
            aria-label={m.crud.editAria(heading)}
            title={m.common.edit}
            className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden />
          </button>
          <button
            type="button"
            onClick={onDelete}
            aria-label={m.crud.deleteAria(heading)}
            title={m.common.delete}
            className="inline-flex h-7 w-7 items-center justify-center rounded text-rose-300 hover:bg-rose-500/15 hover:text-rose-200"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      </div>
      {expanded && (
        <pre className="max-h-[10rem] overflow-y-auto px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-foreground/85">
          {template.body}
        </pre>
      )}
    </li>
  );
}

// ---------- Shared edit dialog --------------------------------------------

/**
 * Modal edit form used for both macros and recruitment templates.
 * Open state is driven by `value !== null`; closing the dialog calls
 * onChange(null) so the same handler manages both cases.
 */
function EditDialog({
  kind,
  value,
  onChange,
  onSave,
  busy,
}: {
  kind: "macro" | "template";
  value: { id?: string; label: string; body: string } | null;
  onChange: (
    next: { id?: string; label: string; body: string } | null,
  ) => void;
  onSave: () => void;
  busy: boolean;
}) {
  const m = useMessages();
  const open = value !== null;
  const setOpen = (next: boolean) => {
    if (!next) onChange(null);
  };
  const isEdit = !!value?.id;
  const titleText =
    kind === "macro"
      ? isEdit
        ? m.macros.dialogMacroEdit
        : m.macros.dialogMacroNew
      : isEdit
        ? m.macros.dialogTemplateEdit
        : m.macros.dialogTemplateNew;
  const accentClass =
    kind === "macro"
      ? "border-[var(--neon-violet)]/40 text-[var(--neon-violet)] shadow-[0_0_18px_-6px_var(--neon-violet)]"
      : "border-[var(--neon-cyan)]/40 text-[var(--neon-cyan)] shadow-[0_0_18px_-6px_var(--neon-cyan)]";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="glass top-[8svh] max-w-[calc(100%-1.5rem)] translate-y-0 gap-0 p-0 sm:top-20 sm:max-w-2xl">
        <DialogHeader className="flex-row items-start gap-3 border-b border-border/40 p-5">
          <span
            className={
              "grid h-9 w-9 shrink-0 place-items-center rounded-md border bg-background/40 " +
              accentClass
            }
          >
            {kind === "macro" ? (
              <Terminal className="h-4 w-4" aria-hidden />
            ) : (
              <ClipboardList className="h-4 w-4" aria-hidden />
            )}
          </span>
          <div className="flex flex-col gap-0.5">
            <DialogTitle className="font-display text-base tracking-[0.16em] uppercase">
              {titleText}
            </DialogTitle>
            <DialogDescription className="text-xs">
              {kind === "macro" ? m.macros.descMacro : m.macros.descTemplate}
            </DialogDescription>
          </div>
        </DialogHeader>

        <div className="flex max-h-[70svh] flex-col gap-4 overflow-y-auto p-5">
          {value && (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="edit-label" className="text-xs text-foreground/80">
                  {kind === "macro"
                    ? m.macros.labelOptional
                    : m.macros.subLabelOptional}
                </Label>
                <Input
                  id="edit-label"
                  value={value.label}
                  onChange={(e) => onChange({ ...value, label: e.target.value })}
                  spellCheck={false}
                  autoFocus
                />
                {kind === "template" && (
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                    {m.macros.subLabelHelp}
                  </p>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Label htmlFor="edit-body" className="text-xs text-foreground/80">
                    {m.macros.body}
                  </Label>
                  {/* 全角→半角 button only useful for PT-募集 text where
                      Japanese-IME 全角 chars sneak in. Macros are
                      typically mostly Japanese so the button just
                      adds noise — hidden for kind="macro". */}
                  {kind === "template" && (
                    <button
                      type="button"
                      onClick={() => {
                        const next = toHalfWidth(value.body);
                        if (next === value.body) {
                          toast.info(m.macros.noFullWidth);
                          return;
                        }
                        onChange({ ...value, body: next });
                        toast.success(m.macros.convertedHalfWidth);
                      }}
                      className="inline-flex items-center gap-1 rounded-sm border border-[var(--neon-cyan)]/40 bg-[var(--neon-cyan)]/8 px-2 py-0.5 text-[10px] tracking-normal text-[var(--neon-cyan)] transition-colors hover:bg-[var(--neon-cyan)]/15"
                      title={m.macros.toHalfWidth}
                    >
                      <CaseSensitive className="h-3 w-3" aria-hidden />
                      {m.macros.toHalfWidth}
                    </button>
                  )}
                </div>
                <Textarea
                  id="edit-body"
                  value={value.body}
                  onChange={(e) => onChange({ ...value, body: e.target.value })}
                  rows={kind === "macro" ? 8 : 6}
                  className="text-[12px] leading-relaxed font-mono"
                  spellCheck={false}
                />
              </div>
            </>
          )}
        </div>

        <DialogFooter className="-mx-0 -mb-0 mt-0 flex-row items-center justify-end gap-2 rounded-b-xl border-t border-border/40 bg-secondary/30 p-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setOpen(false)}
            disabled={busy}
            className="text-[11px] tracking-normal"
          >
            <X className="h-3.5 w-3.5 mr-1" aria-hidden />
            {m.common.cancel}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={onSave}
            disabled={busy}
            className="gap-1.5 text-[11px] tracking-normal"
          >
            <Save className="h-3.5 w-3.5" aria-hidden />
            {busy ? m.common.saving : isEdit ? m.crud.update : m.common.add}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
