"use client";

import { useMemo, useState } from "react";
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
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import { MirrorActionSlot } from "@/components/portal/action-slot";

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
};

function toHalfWidth(s: string): string {
  return s
    .replace(/[！-～]/g, (c) =>
      String.fromCharCode(c.charCodeAt(0) - 0xfee0),
    )
    .replace(/　/g, " ");
}

async function copyText(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`「${label}」をコピーしました`);
  } catch (e) {
    console.warn("[macros] clipboard error:", e);
    toast.error("コピー失敗（ブラウザの権限を確認してください）");
  }
}

export function MacrosList({
  categoryId,
  categoryName,
  initialMacros,
  initialTemplates,
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
  const [editing, setEditing] = useState<{
    id?: string;
    label: string;
    body: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [optimistic, setOptimistic] = useState<string[] | null>(null);

  const ordered = useMemo(() => {
    if (!optimistic) return macros;
    const idx = new Map(optimistic.map((id, i) => [id, i] as const));
    return [...macros].sort((a, b) => {
      const ai = idx.get(a.id);
      const bi = idx.get(b.id);
      if (ai === undefined && bi === undefined) return 0;
      if (ai === undefined) return 1;
      if (bi === undefined) return -1;
      return ai - bi;
    });
  }, [macros, optimistic]);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 6 },
    }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = ordered.findIndex((m) => m.id === active.id);
    const newIndex = ordered.findIndex((m) => m.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(ordered, oldIndex, newIndex).map((m) => m.id);
    setOptimistic(next);
    const result = await setCategoryMacroOrder(next);
    if (!result.ok) {
      toast.error("並び替え保存失敗: " + result.reason);
      setOptimistic(null);
      return;
    }
    setTimeout(() => setOptimistic(null), 1500);
  };

  const startNew = () => setEditing({ label: "", body: "" });
  const startEdit = (m: CategoryMacro) =>
    setEditing({ id: m.id, label: m.label, body: m.body });

  const onSave = async () => {
    if (!editing) return;
    const label = editing.label.trim();
    const body = editing.body.trim();
    if (!body) {
      toast.error("本文を入力してください");
      return;
    }
    setBusy(true);
    const result = editing.id
      ? await updateCategoryMacro(editing.id, { label, body })
      : await createCategoryMacro({ categoryId, label, body });
    setBusy(false);
    if (!result.ok) {
      toast.error("保存失敗: " + result.reason);
      return;
    }
    toast.success(editing.id ? "更新しました" : "追加しました");
    setEditing(null);
  };

  const onDelete = async (m: CategoryMacro) => {
    if (!window.confirm(`「${m.label || "（未命名）"}」を削除しますか？`)) return;
    const result = await deleteCategoryMacro(m.id);
    if (!result.ok) {
      toast.error("削除失敗: " + result.reason);
      return;
    }
    toast.success("削除しました");
  };

  const ids = useMemo(() => ordered.map((m) => m.id), [ordered]);

  return (
    <section className="flex flex-col gap-3">
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-[var(--neon-violet)]" aria-hidden />
          <h2 className="font-display text-base">マクロ</h2>
          <span className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground">
            {ordered.length}件
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
          className="gap-1.5 font-mono text-[11px] tracking-[0.18em] uppercase"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          マクロ追加
        </Button>
        <MirrorActionSlot>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={startNew}
            className="gap-1.5 font-mono text-[11px] tracking-[0.18em] uppercase"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            マクロ追加
          </Button>
        </MirrorActionSlot>
      </header>

      {ordered.length === 0 ? (
        <Card className="glass flex flex-col items-center gap-3 p-10 text-center">
          <span className="grid h-10 w-10 place-items-center rounded-md border border-[var(--neon-violet)]/40 bg-background/40 text-[var(--neon-violet)]">
            <Terminal className="h-4 w-4" aria-hidden />
          </span>
          <p className="font-display text-foreground text-sm">マクロ未登録</p>
          <p className="text-muted-foreground max-w-md text-xs leading-relaxed">
            攻略に用いる戦術のテンプレ等をここに保存できます。
          </p>
        </Card>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
        >
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <ul className="flex flex-col gap-2">
              {ordered.map((m) => (
                <SortableMacroRow
                  key={m.id}
                  macro={m}
                  onEdit={() => startEdit(m)}
                  onDelete={() => onDelete(m)}
                  onCopy={() =>
                    copyText(m.body, m.label || `${categoryName} マクロ`)
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
  return (
    <li
      ref={setNodeRef}
      style={style}
      {...attributes}
      className="rounded-md border border-border/40 bg-secondary/20"
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
          aria-label={`${macro.label || "マクロ"} の本文を${expanded ? "閉じる" : "開く"}`}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded px-1 text-left hover:bg-secondary/40"
        >
          <span
            {...listeners}
            role="presentation"
            aria-label={`${macro.label || "マクロ"} のドラッグハンドル`}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex h-6 w-6 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground hover:bg-secondary/60 hover:text-foreground active:cursor-grabbing"
            title="ドラッグで並び替え"
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
              <span className="text-muted-foreground/80">（ラベル未設定）</span>
            )}
          </p>
        </button>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onCopy}
            aria-label={`${macro.label || "マクロ"} の本文をコピー`}
            title="本文をコピー"
            className="inline-flex h-7 w-7 items-center justify-center rounded text-[var(--neon-cyan)] hover:bg-[var(--neon-cyan)]/15"
          >
            <ClipboardCopy className="h-3.5 w-3.5" aria-hidden />
          </button>
          <button
            type="button"
            onClick={onEdit}
            aria-label={`${macro.label || "マクロ"} を編集`}
            title="編集"
            className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden />
          </button>
          <button
            type="button"
            onClick={onDelete}
            aria-label={`${macro.label || "マクロ"} を削除`}
            title="削除"
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

  // DnD 並び替え用 — 楽観反映でドラッグ直後に UI 即時更新、失敗時 revert
  const [optimisticOrder, setOptimisticOrder] = useState<string[] | null>(null);
  const orderedTemplates = useMemo(() => {
    if (!optimisticOrder) return templates;
    const idx = new Map(optimisticOrder.map((id, i) => [id, i] as const));
    return [...templates].sort((a, b) => {
      const ai = idx.get(a.id);
      const bi = idx.get(b.id);
      if (ai === undefined && bi === undefined) return 0;
      if (ai === undefined) return 1;
      if (bi === undefined) return -1;
      return ai - bi;
    });
  }, [templates, optimisticOrder]);

  const dndSensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 6 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  /**
   * このカテゴリ内でのドラッグを「グローバル sort_order」に反映する。
   *
   * macro page はカテゴリで filter したテンプレしか表示しないが、
   * `recruitment_templates.sort_order` 自体はグローバルに連番。
   * トップ (スケジュール) ページの「募集」ボタンはグローバル
   * `templates[0]` をコピー対象にしているため、このカテゴリ内で
   * 上に動かしたテンプレが偶々グローバル先頭になればトップ表示も
   * 自動で切り替わる仕組み。
   *
   * 並び替えアルゴリズム:
   *   1. このカテゴリ内の新順 (`newFiltered`) を arrayMove で算出
   *   2. グローバル全体 (`allLive`) を頭から走査し、要素がこのカテゴリの
   *      ものなら `newFiltered` の対応位置の id に置換、それ以外は据え置き
   *   → 他カテゴリ要素の絶対位置は変わらず、このカテゴリの slot 内でのみ
   *      順序が入れ替わる
   */
  const onDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = orderedTemplates.findIndex((t) => t.id === active.id);
    const newIndex = orderedTemplates.findIndex((t) => t.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const newFiltered = arrayMove(orderedTemplates, oldIndex, newIndex);
    let cursor = 0;
    const newGlobal = allLive.map((t) =>
      t.categoryId === categoryId ? newFiltered[cursor++]!.id : t.id,
    );

    setOptimisticOrder(newFiltered.map((t) => t.id));
    const result = await setRecruitmentTemplateOrder(newGlobal);
    if (!result.ok) {
      toast.error("並び替え保存失敗: " + result.reason);
      setOptimisticOrder(null);
      return;
    }
    setTimeout(() => setOptimisticOrder(null), 1500);
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
      toast.error("本文を入力してください");
      return;
    }
    setBusy(true);
    const result = editing.id
      ? await updateRecruitmentTemplate(editing.id, { label, body })
      : await createRecruitmentTemplate({ categoryId, label, body });
    setBusy(false);
    if (!result.ok) {
      toast.error("保存失敗: " + result.reason);
      return;
    }
    toast.success(editing.id ? "更新しました" : "追加しました");
    setEditing(null);
  };

  const onDelete = async (t: RecruitmentTemplate) => {
    if (!window.confirm(`「${t.label || "通常募集"}」を削除しますか？`)) return;
    const result = await deleteRecruitmentTemplate(t.id);
    if (!result.ok) {
      toast.error("削除失敗: " + result.reason);
      return;
    }
    toast.success("削除しました");
  };

  return (
    <section className="flex flex-col gap-3">
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-[var(--neon-cyan)]" aria-hidden />
          <h2 className="font-display text-base">募集文テンプレート</h2>
          <span className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground">
            {templates.length}件
          </span>
        </div>
        {/* TODO #58 part2: 元位置 in-flow + stuck 時 SubTabs 右端に複製ボタン。
            macros section と同方針 (元位置のボタンは常時表示 / 複製を上部に追加)。 */}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={startNew}
          className="gap-1.5 font-mono text-[11px] tracking-[0.18em] uppercase"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          募集文追加
        </Button>
        <MirrorActionSlot>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={startNew}
            className="gap-1.5 font-mono text-[11px] tracking-[0.18em] uppercase"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            募集文追加
          </Button>
        </MirrorActionSlot>
      </header>

      {orderedTemplates.length === 0 ? (
        <Card className="glass flex flex-col items-center gap-2 p-6 text-center">
          <p className="text-muted-foreground text-xs leading-relaxed">
            このコンテンツに紐づく募集文テンプレートはまだ登録されていません。
            <br />
            上の「+ 追加」ボタンから登録できます。
          </p>
        </Card>
      ) : (
        <DndContext
          sensors={dndSensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
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
                  onCopy={() => copyText(t.body, t.label || categoryName)}
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
  // Templates default to expanded — bodies are typically one-line PT
  // 募集 text, short enough that hiding them costs more than it saves.
  // Macros stay collapsed-by-default (multi-line `/p` payloads).
  const [expanded, setExpanded] = useState(true);
  const heading = template.label || "通常募集";

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
        "rounded-md border bg-secondary/20 " +
        (isGlobalTop
          ? "border-[var(--neon-cyan)]/50 ring-1 ring-inset ring-[var(--neon-cyan)]/30"
          : "border-border/40")
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
          aria-label={`${heading} のドラッグハンドル`}
          title="ドラッグで並び替え (グローバル順序に反映)"
          className="inline-flex h-6 w-6 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground hover:bg-secondary/60 hover:text-foreground active:cursor-grabbing"
        >
          <GripVertical className="h-3.5 w-3.5" aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-label={`${heading} の本文を${expanded ? "閉じる" : "開く"}`}
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
              <span className="text-muted-foreground/80">通常募集</span>
            )}
            {isGlobalTop && (
              <span
                className="ml-1.5 font-mono text-[9px] tracking-[0.18em] text-[var(--neon-cyan)] uppercase"
                title="トップページ「募集」ボタンのコピー対象"
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
            aria-label={`${template.label || fallbackLabel} の本文をコピー`}
            title="本文をコピー"
            className="inline-flex h-7 w-7 items-center justify-center rounded text-[var(--neon-cyan)] hover:bg-[var(--neon-cyan)]/15"
          >
            <ClipboardCopy className="h-3.5 w-3.5" aria-hidden />
          </button>
          <button
            type="button"
            onClick={onEdit}
            aria-label={`${heading} を編集`}
            title="編集"
            className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden />
          </button>
          <button
            type="button"
            onClick={onDelete}
            aria-label={`${heading} を削除`}
            title="削除"
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
  const open = value !== null;
  const setOpen = (next: boolean) => {
    if (!next) onChange(null);
  };
  const isEdit = !!value?.id;
  const titleText =
    kind === "macro"
      ? isEdit
        ? "マクロを編集"
        : "マクロを追加"
      : isEdit
        ? "募集文を編集"
        : "募集文を追加";
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
              {kind === "macro"
                ? "戦闘中の `/p` 系コール / 戦術メモなど"
                : "PT募集サイト・Discord 用の募集テキスト"}
            </DialogDescription>
          </div>
        </DialogHeader>

        <div className="flex max-h-[70svh] flex-col gap-4 overflow-y-auto p-5">
          {value && (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="edit-label" className="text-xs text-foreground/80">
                  {kind === "macro" ? "ラベル（任意）" : "サブラベル（任意）"}
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
                    コンテンツ内で複数テンプレを使い分ける時の小見出し。1つだけなら空でOK。
                  </p>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Label htmlFor="edit-body" className="text-xs text-foreground/80">
                    本文
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
                          toast.info("変換対象の全角文字なし");
                          return;
                        }
                        onChange({ ...value, body: next });
                        toast.success("全角を半角に変換しました");
                      }}
                      className="inline-flex items-center gap-1 rounded-sm border border-[var(--neon-cyan)]/40 bg-[var(--neon-cyan)]/8 px-2 py-0.5 font-mono text-[10px] tracking-[0.18em] text-[var(--neon-cyan)] uppercase transition-colors hover:bg-[var(--neon-cyan)]/15"
                      title="全角→半角"
                    >
                      <CaseSensitive className="h-3 w-3" aria-hidden />
                      全角→半角
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
            className="font-mono text-[11px] tracking-[0.18em] uppercase"
          >
            <X className="h-3.5 w-3.5 mr-1" aria-hidden />
            キャンセル
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={onSave}
            disabled={busy}
            className="gap-1.5 font-mono text-[11px] tracking-[0.18em] uppercase"
          >
            <Save className="h-3.5 w-3.5" aria-hidden />
            {busy ? "保存中..." : isEdit ? "更新" : "追加"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
