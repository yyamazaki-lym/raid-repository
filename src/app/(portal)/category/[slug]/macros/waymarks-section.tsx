"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ClipboardCopy,
  GripVertical,
  MapPin,
  Pencil,
  Plus,
  Trash2,
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
import { useConfirm } from "@/components/portal/confirm-dialog";
import {
  applyOptimisticOrder,
  useSortableReorder,
} from "@/lib/use-sortable-reorder";
import {
  createCategoryWaymark,
  deleteCategoryWaymark,
  setCategoryWaymarkOrder,
  updateCategoryWaymark,
  useRealtimeCategoryWaymarks,
  type CategoryWaymark,
} from "@/lib/category-waymarks-client";

/**
 * ウェイマーク (markercode) 配布セクション — TODO #94 / A-5。
 *
 * マクロは portal で配れるのに、ウェイマークだけ Discord のログを遡る
 * 必要がある、という空白を埋める (調査ノート §2 空白 06)。UI/権限モデルは
 * マクロセクションと同じで、違いは「メモ (どの配置か)」欄があることだけ。
 *
 * body には EchoPlan / Waymark Preset などが吐く markercode をそのまま貼る。
 * portal は中身を解釈しない。
 */

type EditState = {
  id?: string;
  label: string;
  body: string;
  note: string;
} | null;

export function WaymarksSection({
  categoryId,
  categoryName,
  initialWaymarks,
}: {
  categoryId: string;
  categoryName: string;
  initialWaymarks: CategoryWaymark[];
}) {
  const waymarks = useRealtimeCategoryWaymarks(categoryId, initialWaymarks);
  const [editing, setEditing] = useState<EditState>(null);
  const [busy, setBusy] = useState(false);
  const { optimisticOrder, sensors, handleDragEnd, syncOnSettle } =
    useSortableReorder({ persist: setCategoryWaymarkOrder });
  const confirm = useConfirm();

  const ordered = useMemo(
    () => applyOptimisticOrder(waymarks, optimisticOrder),
    [waymarks, optimisticOrder],
  );
  useEffect(() => {
    syncOnSettle(waymarks.map((w) => w.id));
  }, [waymarks, syncOnSettle]);

  const ids = useMemo(() => ordered.map((w) => w.id), [ordered]);

  const startNew = () => setEditing({ label: "", body: "", note: "" });
  const startEdit = (w: CategoryWaymark) =>
    setEditing({ id: w.id, label: w.label, body: w.body, note: w.note ?? "" });

  const onSave = async () => {
    if (!editing) return;
    const label = editing.label.trim();
    const body = editing.body.trim();
    const note = editing.note.trim() || null;
    if (!body) {
      toast.error("markercode を入力してください");
      return;
    }
    setBusy(true);
    const result = editing.id
      ? await updateCategoryWaymark(editing.id, { label, body, note })
      : await createCategoryWaymark({ categoryId, label, body, note });
    setBusy(false);
    if (!result.ok) {
      toast.error("保存失敗: " + result.reason);
      return;
    }
    toast.success(editing.id ? "更新しました" : "追加しました");
    setEditing(null);
  };

  const onDelete = async (w: CategoryWaymark) => {
    const ok = await confirm({
      title: `「${w.label || "（未命名）"}」を削除しますか？`,
      confirmText: "削除",
      destructive: true,
    });
    if (!ok) return;
    const result = await deleteCategoryWaymark(w.id);
    if (!result.ok) {
      toast.error("削除失敗: " + result.reason);
      return;
    }
    toast.success("削除しました");
  };

  const onCopy = async (w: CategoryWaymark) => {
    const label = w.label || `${categoryName} ウェイマーク`;
    try {
      await navigator.clipboard.writeText(w.body);
      toast.success(`「${label}」をコピーしました`);
    } catch (e) {
      console.warn("[waymarks] clipboard error:", e);
      toast.error("コピー失敗（ブラウザの権限を確認してください）");
    }
  };

  return (
    <section className="flex flex-col gap-3">
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 text-[var(--neon-cyan)]" aria-hidden />
          <h2 className="font-display text-base">ウェイマーク</h2>
          <span className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground">
            {ordered.length} 件
          </span>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={startNew}
          className="gap-1.5 text-[11px] tracking-normal"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          マーカー追加
        </Button>
      </header>

      {ordered.length === 0 ? (
        <EmptyState
          icon={MapPin}
          title="ウェイマーク未登録"
          description="EchoPlan / Waymark Preset などが出力する markercode を貼り付けて保存すると、ワンタップでコピーして配れます。"
        />
      ) : (
        <DndContext
          // dnd-kit の採番 (`DndDescribedBy-<n>`) は SSR とクライアントで
          // ずれて hydration mismatch になるため id を明示する
          // (category-list.tsx の詳しい注記を参照)。
          id="dnd-waymarks"
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={(e) => handleDragEnd(e, ordered)}
        >
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <ul className="flex flex-col gap-2">
              {ordered.map((w) => (
                <SortableWaymarkRow
                  key={w.id}
                  waymark={w}
                  onEdit={() => startEdit(w)}
                  onDelete={() => onDelete(w)}
                  onCopy={() => onCopy(w)}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editing?.id ? "ウェイマークを編集" : "ウェイマークを追加"}
            </DialogTitle>
            <DialogDescription>
              ゲーム内のフィールドマーカーはコンテンツごとに 5
              枠までしか保存できません。配置の markercode
              をここに置いておくと、必要な人が必要なときにコピーできます。
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="waymark-label">ラベル</Label>
              <Input
                id="waymark-label"
                value={editing?.label ?? ""}
                placeholder="例: P3 塔 / 基本散開"
                onChange={(e) =>
                  setEditing((v) => (v ? { ...v, label: e.target.value } : v))
                }
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="waymark-body">markercode</Label>
              <Textarea
                id="waymark-body"
                value={editing?.body ?? ""}
                rows={6}
                placeholder='{"Name":"P3","MarkerA":{...}} など、ツールが出力した文字列をそのまま'
                className="font-mono text-[11px]"
                onChange={(e) =>
                  setEditing((v) => (v ? { ...v, body: e.target.value } : v))
                }
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="waymark-note">メモ（任意）</Label>
              <Input
                id="waymark-note"
                value={editing?.note ?? ""}
                placeholder="例: 北を D1 側に合わせる"
                onChange={(e) =>
                  setEditing((v) => (v ? { ...v, note: e.target.value } : v))
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setEditing(null)}
              disabled={busy}
            >
              キャンセル
            </Button>
            <Button type="button" onClick={onSave} disabled={busy}>
              {busy ? "保存中..." : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function SortableWaymarkRow({
  waymark,
  onEdit,
  onDelete,
  onCopy,
}: {
  waymark: CategoryWaymark;
  onEdit: () => void;
  onDelete: () => void;
  onCopy: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: waymark.id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : "auto",
  };
  const [expanded, setExpanded] = useState(false);
  const name = waymark.label || "ウェイマーク";
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
          aria-label={`${name} の markercode を${expanded ? "閉じる" : "開く"}`}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded px-1 text-left hover:bg-secondary/40"
        >
          <span
            {...listeners}
            role="presentation"
            aria-label={`${name} のドラッグハンドル`}
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
          {/* `min-w-0` だけでは不十分: `truncate` の `white-space: nowrap` は
              min-content 幅を縮めないため、祖先 (root layout の flex 列) まで
              min-content が伝播してページ全体が横に伸びる。`w-0` で幅を確定
              させると伝播が止まり、`flex-1` で実際の描画幅まで広がる。 */}
          <span className="w-0 min-w-0 flex-1">
            <p className="truncate font-display text-sm">
              {waymark.label || (
                <span className="text-muted-foreground/80">
                  （ラベル未設定）
                </span>
              )}
            </p>
            {waymark.note && (
              <p className="truncate text-[11px] text-muted-foreground">
                {waymark.note}
              </p>
            )}
          </span>
        </button>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onCopy}
            aria-label={`${name} の markercode をコピー`}
            title="markercode をコピー"
            className="inline-flex h-7 w-7 items-center justify-center rounded text-[var(--neon-cyan)] hover:bg-[var(--neon-cyan)]/15"
          >
            <ClipboardCopy className="h-3.5 w-3.5" aria-hidden />
          </button>
          <button
            type="button"
            onClick={onEdit}
            aria-label={`${name} を編集`}
            title="編集"
            className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden />
          </button>
          <button
            type="button"
            onClick={onDelete}
            aria-label={`${name} を削除`}
            title="削除"
            className="inline-flex h-7 w-7 items-center justify-center rounded text-rose-300 hover:bg-rose-500/15 hover:text-rose-200"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      </div>
      {expanded && (
        <pre className="max-h-[12rem] overflow-y-auto px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-all text-foreground/85">
          {waymark.body}
        </pre>
      )}
    </li>
  );
}
