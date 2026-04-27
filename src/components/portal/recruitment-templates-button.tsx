"use client";

import { useMemo, useState } from "react";
import {
  CaseSensitive,
  ClipboardCopy,
  ClipboardList,
  ExternalLink,
  GripVertical,
  Pencil,
  Plus,
  Save,
  Star,
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  createRecruitmentTemplate,
  deleteRecruitmentTemplate,
  setRecruitmentTemplateOrder,
  updateRecruitmentTemplate,
  useRealtimeRecruitmentTemplates,
  type RecruitmentTemplate,
} from "@/lib/recruitment-templates-client";
import { cn } from "@/lib/utils";

/**
 * Header button on the schedule page that exposes saved PT-募集 text
 * templates. Always shows a dropdown menu (regardless of count) so the
 * user can always reach the management dialog — fixes the previous
 * UX where 1 template made the whole button collapse to "Copy".
 *
 * Templates are grouped by category in the dropdown for readability,
 * since groups commonly maintain 1-N templates per content (e.g. one
 * for each floor of a 4-floor raid).
 */

type CategoryOption = { id: string; name: string };

type Props = {
  initial: RecruitmentTemplate[];
  /** Categories to choose from in the management dialog. */
  categories: CategoryOption[];
};

export function RecruitmentTemplatesButton({ initial, categories }: Props) {
  const templates = useRealtimeRecruitmentTemplates(initial);
  const [manageOpen, setManageOpen] = useState(false);

  const copyToClipboard = async (template: RecruitmentTemplate) => {
    try {
      await navigator.clipboard.writeText(template.body);
      toast.success(`「${displayLabel(template)}」をコピーしました`);
    } catch (e) {
      console.warn("[recruitment-templates] clipboard error:", e);
      toast.error("コピー失敗（ブラウザの権限を確認してください）");
    }
  };

  const grouped = useMemo(() => groupByCategory(templates), [templates]);
  // The first template (sort_order = 0) is what the next-session
  // card's quick-copy button uses. Highlight it in the dropdown so
  // users can confirm "this is what gets copied".
  const topId = templates[0]?.id ?? null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`PT募集文を選択してコピー (${templates.length}件)`}
          title={`PT募集文 ${templates.length}件 — クリックで一覧`}
          className={cn(
            "inline-flex h-8 w-8 items-center justify-center rounded-md border transition-colors",
            templates.length > 0
              ? "border-[var(--neon-cyan)]/40 bg-[var(--neon-cyan)]/8 text-[var(--neon-cyan)] hover:border-[var(--neon-cyan)]/60 hover:bg-[var(--neon-cyan)]/12"
              : "border-border/60 text-muted-foreground hover:border-[var(--neon-cyan)]/60 hover:text-foreground",
          )}
        >
          <ClipboardCopy className="h-4 w-4" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          sideOffset={4}
          className="glass-popup w-[max(18rem,min(calc(100vw-1rem),28rem))]"
        >
          {templates.length === 0 ? (
            <div className="px-2 py-3 text-center text-[11px] text-muted-foreground">
              テンプレート未登録
            </div>
          ) : (
            <>
              <p className="px-1.5 pt-1 pb-1 text-[10px] leading-snug text-muted-foreground/85">
                <span className="font-mono tracking-widest text-[var(--neon-cyan)]/80 uppercase">★ Top</span>
                {" "}が次回開催日カードのコピーボタンの対象。
              </p>
              {grouped.map(({ categoryName, items }) => (
                <div key={categoryName ?? "__none__"} className="mb-1 last:mb-0">
                  <div className="px-1.5 pt-1 pb-0.5 font-mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase truncate">
                    {categoryName ?? "（カテゴリー未設定）"}
                  </div>
                  {items.map((t) => {
                    const isTop = t.id === topId;
                    return (
                      <DropdownMenuItem
                        key={t.id}
                        onClick={() => copyToClipboard(t)}
                        className={cn(
                          "flex cursor-pointer items-start gap-2",
                          isTop &&
                            "bg-[var(--neon-cyan)]/8 ring-1 ring-inset ring-[var(--neon-cyan)]/30",
                        )}
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
                            {t.label || "通常募集"}
                            {isTop && (
                              <span className="ml-1.5 font-mono text-[9px] tracking-widest text-[var(--neon-cyan)] uppercase">
                                Top
                              </span>
                            )}
                          </p>
                          <p className="truncate text-[10px] text-muted-foreground/80">
                            {t.body.slice(0, 60)}
                            {t.body.length > 60 ? "…" : ""}
                          </p>
                        </div>
                      </DropdownMenuItem>
                    );
                  })}
                </div>
              ))}
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => setManageOpen(true)}
            className="flex cursor-pointer items-center gap-2 text-muted-foreground focus:text-foreground"
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden />
            <span className="text-sm">
              {templates.length === 0
                ? "テンプレートを追加"
                : "テンプレートを編集 / 並べ替え"}
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ManageDialog
        open={manageOpen}
        onOpenChange={setManageOpen}
        templates={templates}
        categories={categories}
      />
    </>
  );
}

/**
 * Lightweight quick-copy button suitable for embedding inline (e.g.
 * the next-session card). Copies the topmost template directly. When
 * no template is registered, renders nothing.
 */
export function RecruitmentTopCopyButton({
  initial,
}: {
  initial: RecruitmentTemplate[];
}) {
  const templates = useRealtimeRecruitmentTemplates(initial);
  if (templates.length === 0) return null;
  const top = templates[0]!;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(top.body);
      toast.success(`「${displayLabel(top)}」をコピーしました`);
    } catch {
      toast.error("コピー失敗");
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`「${displayLabel(top)}」を募集文としてコピー`}
      title={`${displayLabel(top)} をコピー`}
      className="inline-flex h-6 items-center gap-1 rounded-sm border border-[var(--neon-cyan)]/40 bg-[var(--neon-cyan)]/10 px-1.5 font-mono text-[10px] tracking-widest text-[var(--neon-cyan)] uppercase transition-colors hover:border-[var(--neon-cyan)]/60 hover:bg-[var(--neon-cyan)]/15"
    >
      <ClipboardCopy className="h-3 w-3" aria-hidden />
      募集
    </button>
  );
}

function displayLabel(t: RecruitmentTemplate): string {
  const cat = t.categoryName ?? "未分類";
  return t.label ? `${cat} / ${t.label}` : cat;
}

/**
 * Convert full-width ASCII characters (digits, Latin letters, and the
 * `！` 〜 `～` punctuation block) to their half-width equivalents.
 * Common pain point in PT募集文 — text typed via a Japanese IME often
 * sneaks in 全角 chars (`１`, `（`, `／`, `＞`) that the user actually
 * wanted as half-width. Surfaced as a manual "全角→半角" button so
 * the conversion is opt-in, not a silent rewrite.
 *
 * Algorithm: every full-width ASCII char from U+FF01 to U+FF5E maps
 * to its half-width counterpart by subtracting 0xFEE0. The 全角 space
 * U+3000 is converted separately to a regular space.
 */
function toHalfWidth(s: string): string {
  return s
    .replace(/[！-～]/g, (c) =>
      String.fromCharCode(c.charCodeAt(0) - 0xfee0),
    )
    .replace(/　/g, " ");
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

// ---------- Management dialog ----------------------------------------------

function ManageDialog({
  open,
  onOpenChange,
  templates,
  categories,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  templates: RecruitmentTemplate[];
  categories: CategoryOption[];
}) {
  const [editing, setEditing] = useState<{
    id?: string;
    categoryId: string;
    label: string;
    body: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  // Optimistic local order so drag-feedback is instant.
  const [optimisticOrder, setOptimisticOrder] = useState<string[] | null>(null);

  const ordered = useMemo(() => {
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
    const oldIndex = ordered.findIndex((t) => t.id === active.id);
    const newIndex = ordered.findIndex((t) => t.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(ordered, oldIndex, newIndex).map((t) => t.id);
    setOptimisticOrder(next);
    const result = await setRecruitmentTemplateOrder(next);
    if (!result.ok) {
      toast.error("並び替え保存失敗: " + result.reason);
      setOptimisticOrder(null);
      return;
    }
    setTimeout(() => setOptimisticOrder(null), 1500);
  };

  const startNew = () => {
    if (categories.length === 0) {
      toast.error("先にカテゴリーを登録してください");
      return;
    }
    setEditing({
      categoryId: categories[0]!.id,
      label: "",
      body: "",
    });
  };
  const startEdit = (t: RecruitmentTemplate) =>
    setEditing({
      id: t.id,
      categoryId: t.categoryId ?? (categories[0]?.id ?? ""),
      label: t.label,
      body: t.body,
    });
  const cancelEdit = () => setEditing(null);

  const onSave = async () => {
    if (!editing) return;
    if (!editing.categoryId) {
      toast.error("カテゴリーを選択してください");
      return;
    }
    const label = editing.label.trim();
    const body = editing.body.trim();
    if (!body) {
      toast.error("本文を入力してください");
      return;
    }
    setBusy(true);
    const result = editing.id
      ? await updateRecruitmentTemplate(editing.id, {
          categoryId: editing.categoryId,
          label,
          body,
        })
      : await createRecruitmentTemplate({
          categoryId: editing.categoryId,
          label,
          body,
        });
    setBusy(false);
    if (!result.ok) {
      toast.error("保存失敗: " + result.reason);
      return;
    }
    toast.success(editing.id ? "更新しました" : "追加しました");
    setEditing(null);
  };

  const onDelete = async (t: RecruitmentTemplate) => {
    if (!window.confirm(`「${displayLabel(t)}」を削除しますか？`)) return;
    const result = await deleteRecruitmentTemplate(t.id);
    if (!result.ok) {
      toast.error("削除失敗: " + result.reason);
      return;
    }
    toast.success("削除しました");
  };

  const ids = useMemo(() => ordered.map((t) => t.id), [ordered]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass top-[8svh] max-w-[calc(100%-1.5rem)] translate-y-0 gap-0 p-0 sm:top-20 sm:max-w-2xl">
        <DialogHeader className="flex-row items-start gap-3 border-b border-border/40 p-5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-[var(--neon-cyan)]/40 bg-background/40 text-[var(--neon-cyan)] shadow-[0_0_18px_-6px_var(--neon-cyan)]">
            <ClipboardList className="h-4 w-4" aria-hidden />
          </span>
          <div className="flex flex-col gap-0.5">
            <DialogTitle className="font-display text-base tracking-[0.16em] uppercase">
              PT募集文 Templates
            </DialogTitle>
            <DialogDescription className="text-xs">
              カテゴリー別に募集文を保存。先頭のテンプレが「次回開催日」カードのコピーボタンに出ます。
            </DialogDescription>
          </div>
        </DialogHeader>

        <div className="flex max-h-[70svh] flex-col gap-4 overflow-y-auto p-5">
          {/* List */}
          {ordered.length === 0 ? (
            <p className="rounded-md border border-dashed border-border/40 px-4 py-6 text-center text-xs text-muted-foreground">
              テンプレート未登録 — 下の「+ 新規追加」から1つ目を作成
            </p>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={onDragEnd}
            >
              <SortableContext items={ids} strategy={verticalListSortingStrategy}>
                <ul className="flex flex-col gap-2">
                  {ordered.map((t, i) => (
                    <SortableTemplateRow
                      key={t.id}
                      template={t}
                      isFirst={i === 0}
                      onEdit={() => startEdit(t)}
                      onDelete={() => onDelete(t)}
                    />
                  ))}
                </ul>
              </SortableContext>
            </DndContext>
          )}

          {/* Edit / Create form */}
          {editing ? (
            <section className="flex flex-col gap-2 rounded-md border border-[var(--neon-cyan)]/40 bg-[var(--neon-cyan)]/4 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[10px] tracking-[0.22em] text-[var(--neon-cyan)] uppercase">
                  {editing.id ? "Edit" : "New"} Template
                </span>
                <button
                  type="button"
                  onClick={cancelEdit}
                  aria-label="フォームを閉じる"
                  className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="rt-category" className="text-xs text-foreground/80">
                  カテゴリー
                </Label>
                <select
                  id="rt-category"
                  value={editing.categoryId}
                  onChange={(e) =>
                    setEditing((cur) =>
                      cur ? { ...cur, categoryId: e.target.value } : cur,
                    )
                  }
                  className="rounded-md border border-input bg-background/30 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--neon-cyan)]/40"
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="rt-label" className="text-xs text-foreground/80">
                  サブラベル（任意）
                </Label>
                <Input
                  id="rt-label"
                  value={editing.label}
                  onChange={(e) =>
                    setEditing((cur) =>
                      cur ? { ...cur, label: e.target.value } : cur,
                    )
                  }
                  spellCheck={false}
                />
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  カテゴリー内で複数テンプレを使い分ける時の小見出し。1つだけなら空でOK。
                </p>
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Label htmlFor="rt-body" className="text-xs text-foreground/80">
                    本文
                  </Label>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        const next = toHalfWidth(editing.body);
                        if (next === editing.body) {
                          toast.info("変換対象の全角文字なし");
                          return;
                        }
                        setEditing((cur) =>
                          cur ? { ...cur, body: next } : cur,
                        );
                        toast.success("全角を半角に変換しました");
                      }}
                      className="inline-flex items-center gap-1 rounded-sm border border-[var(--neon-cyan)]/40 bg-[var(--neon-cyan)]/8 px-2 py-0.5 font-mono text-[10px] tracking-widest text-[var(--neon-cyan)] uppercase transition-colors hover:bg-[var(--neon-cyan)]/15"
                      title="全角の数字・英字・記号を半角に変換"
                      aria-label="全角を半角に変換"
                    >
                      <CaseSensitive className="h-3 w-3" aria-hidden />
                      全角→半角
                    </button>
                    <a
                      href="https://knt-a.com/pt-msg/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-sm border border-border/60 bg-background/40 px-2 py-0.5 font-mono text-[10px] tracking-widest text-muted-foreground uppercase transition-colors hover:border-foreground/40 hover:text-foreground"
                      title="募集文テンプレート作成サイト (knt-a.com) を開く"
                      aria-label="募集文テンプレート作成サイトを開く"
                    >
                      <ExternalLink className="h-3 w-3" aria-hidden />
                      作成サイト
                    </a>
                  </div>
                </div>
                <Textarea
                  id="rt-body"
                  value={editing.body}
                  onChange={(e) =>
                    setEditing((cur) =>
                      cur ? { ...cur, body: e.target.value } : cur,
                    )
                  }
                  rows={6}
                  className="text-[12px] leading-relaxed font-mono"
                  spellCheck={false}
                />
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={cancelEdit}
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
                  {busy ? "保存中..." : editing.id ? "更新" : "追加"}
                </Button>
              </div>
            </section>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={startNew}
              className="self-start gap-1.5 font-mono text-[11px] tracking-widest uppercase"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              新規追加
            </Button>
          )}
        </div>

        <DialogFooter className="-mx-0 -mb-0 mt-0 flex-row items-center justify-end gap-2 rounded-b-xl border-t border-border/40 bg-secondary/30 p-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="font-mono text-[11px] tracking-widest uppercase"
          >
            閉じる
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SortableTemplateRow({
  template,
  isFirst,
  onEdit,
  onDelete,
}: {
  template: RecruitmentTemplate;
  isFirst: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: template.id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : "auto",
  };
  const heading =
    (template.categoryName ?? "（未分類）") +
    (template.label ? ` / ${template.label}` : "");
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
            aria-label={`${heading} のドラッグハンドル`}
            className="inline-flex h-6 w-6 cursor-grab items-center justify-center rounded text-muted-foreground hover:bg-secondary/60 hover:text-foreground active:cursor-grabbing"
            title="ドラッグで並び替え"
          >
            <GripVertical className="h-3.5 w-3.5" aria-hidden />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-sm">{heading}</p>
            {isFirst && (
              <p className="font-mono text-[9px] tracking-widest text-[var(--neon-cyan)] uppercase">
                Top — 開催日カードのコピー対象
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
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
      <pre className="max-h-[8rem] overflow-y-auto px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-foreground/85">
        {template.body}
      </pre>
    </li>
  );
}
