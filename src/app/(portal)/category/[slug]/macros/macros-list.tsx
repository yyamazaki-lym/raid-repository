"use client";

import { useMemo, useState } from "react";
import {
  CaseSensitive,
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

/**
 * Macro & template page for a single category. Two sections:
 *
 *   1. マクロ — fully CRUD'able list of in-game text macros that the
 *      group uses for this content. Drag to reorder, copy buttons on
 *      each, label + body fields.
 *   2. 募集文テンプレート — read-only listing of recruitment templates
 *      already filtered to this category. Copy-only; full management
 *      remains on the schedule page (single source of truth).
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
        categoryName={categoryName}
        templates={initialTemplates}
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
  const cancelEdit = () => setEditing(null);

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
          <span className="font-mono text-[10px] tracking-widest text-muted-foreground">
            {ordered.length}件
          </span>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={startNew}
          className="gap-1.5 font-mono text-[11px] tracking-widest uppercase"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          追加
        </Button>
      </header>

      {ordered.length === 0 && !editing ? (
        <Card className="glass flex flex-col items-center gap-3 p-10 text-center">
          <span className="grid h-10 w-10 place-items-center rounded-md border border-[var(--neon-violet)]/40 bg-background/40 text-[var(--neon-violet)]">
            <Terminal className="h-4 w-4" aria-hidden />
          </span>
          <p className="font-display text-foreground text-sm">マクロ未登録</p>
          <p className="text-muted-foreground max-w-md text-xs leading-relaxed">
            戦闘中に使う `/p` `/say` 系のマクロや、戦術コールのテンプレ等を
            ここに保存できます。
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

      {editing && (
        <Card className="glass border-[var(--neon-violet)]/40 p-4">
          <EditForm
            value={editing}
            onChange={setEditing}
            onCancel={cancelEdit}
            onSave={onSave}
            busy={busy}
            isEdit={!!editing.id}
          />
        </Card>
      )}
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
  return (
    <li
      ref={setNodeRef}
      style={style}
      {...attributes}
      className="rounded-md border border-border/40 bg-secondary/20"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border/30 px-2 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            {...listeners}
            aria-label={`${macro.label || "マクロ"} のドラッグハンドル`}
            className="inline-flex h-6 w-6 cursor-grab items-center justify-center rounded text-muted-foreground hover:bg-secondary/60 hover:text-foreground active:cursor-grabbing"
            title="ドラッグで並び替え"
          >
            <GripVertical className="h-3.5 w-3.5" aria-hidden />
          </button>
          <p className="truncate font-display text-sm">
            {macro.label || (
              <span className="text-muted-foreground/80">（ラベル未設定）</span>
            )}
          </p>
        </div>
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
      <pre className="max-h-[12rem] overflow-y-auto px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-foreground/85">
        {macro.body}
      </pre>
    </li>
  );
}

function EditForm({
  value,
  onChange,
  onCancel,
  onSave,
  busy,
  isEdit,
}: {
  value: { id?: string; label: string; body: string };
  onChange: (
    next: { id?: string; label: string; body: string } | null,
  ) => void;
  onCancel: () => void;
  onSave: () => void;
  busy: boolean;
  isEdit: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] tracking-[0.22em] text-[var(--neon-violet)] uppercase">
          {isEdit ? "Edit" : "New"} Macro
        </span>
        <button
          type="button"
          onClick={onCancel}
          aria-label="フォームを閉じる"
          className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="macro-label" className="text-xs text-foreground/80">
          ラベル（任意）
        </Label>
        <Input
          id="macro-label"
          value={value.label}
          onChange={(e) => onChange({ ...value, label: e.target.value })}
          spellCheck={false}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Label htmlFor="macro-body" className="text-xs text-foreground/80">
            本文
          </Label>
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
            className="inline-flex items-center gap-1 rounded-sm border border-[var(--neon-cyan)]/40 bg-[var(--neon-cyan)]/8 px-2 py-0.5 font-mono text-[10px] tracking-widest text-[var(--neon-cyan)] uppercase transition-colors hover:bg-[var(--neon-cyan)]/15"
            title="全角→半角"
          >
            <CaseSensitive className="h-3 w-3" aria-hidden />
            全角→半角
          </button>
        </div>
        <Textarea
          id="macro-body"
          value={value.body}
          onChange={(e) => onChange({ ...value, body: e.target.value })}
          rows={8}
          className="text-[12px] leading-relaxed font-mono"
          spellCheck={false}
        />
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onCancel}
          disabled={busy}
          className="font-mono text-[11px] tracking-widest uppercase"
        >
          キャンセル
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={onSave}
          disabled={busy}
          className="gap-1.5 font-mono text-[11px] tracking-widest uppercase"
        >
          <Save className="h-3.5 w-3.5" aria-hidden />
          {busy ? "保存中..." : isEdit ? "更新" : "追加"}
        </Button>
      </div>
    </div>
  );
}

// ---------- Templates section ---------------------------------------------

function TemplatesSection({
  categoryName,
  templates,
}: {
  categoryName: string;
  templates: RecruitmentTemplateLite[];
}) {
  return (
    <section className="flex flex-col gap-3">
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-[var(--neon-cyan)]" aria-hidden />
          <h2 className="font-display text-base">募集文テンプレート</h2>
          <span className="font-mono text-[10px] tracking-widest text-muted-foreground">
            {templates.length}件
          </span>
        </div>
        <p className="font-mono text-[10px] tracking-widest text-muted-foreground/80 uppercase">
          read-only · 編集はトップから
        </p>
      </header>

      {templates.length === 0 ? (
        <Card className="glass flex flex-col items-center gap-2 p-6 text-center">
          <p className="text-muted-foreground text-xs leading-relaxed">
            このカテゴリーに紐づく募集文テンプレートはまだ登録されていません。
            <br />
            スケジュールページの「募集文」ボタンから {categoryName} を選んで追加できます。
          </p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {templates.map((t) => (
            <li
              key={t.id}
              className="rounded-md border border-border/40 bg-secondary/20"
            >
              <div className="flex items-center justify-between gap-2 border-b border-border/30 px-2 py-2">
                <p className="truncate font-display text-sm">
                  {t.label || (
                    <span className="text-muted-foreground/80">通常募集</span>
                  )}
                </p>
                <button
                  type="button"
                  onClick={() => copyText(t.body, t.label || categoryName)}
                  aria-label="本文をコピー"
                  title="本文をコピー"
                  className="inline-flex h-7 w-7 items-center justify-center rounded text-[var(--neon-cyan)] hover:bg-[var(--neon-cyan)]/15"
                >
                  <ClipboardCopy className="h-3.5 w-3.5" aria-hidden />
                </button>
              </div>
              <pre className="max-h-[10rem] overflow-y-auto px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-foreground/85">
                {t.body}
              </pre>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
