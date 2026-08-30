"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BadgeCheck,
  ChevronDown,
  ClipboardCopy,
  ExternalLink,
  GripVertical,
  LayoutDashboard,
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
  checkWaymarkPreset,
  isWaymarkStudioUrl,
} from "@/lib/waymark-preset";
import { safeHref } from "@/lib/url-safe";
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
  type CategoryWaymarkKind,
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
 *
 * 2026-08-30 (調査 第3回 C-6): `kind='board'` で **ストラテジーボード共有
 * コード** (7.4 のゲーム内機能、`[stgy:...]`) も同じ UI で扱う。ウェイマーク
 * JSON と違いプラグイン不要でコンソール勢も取り込めるため、ウェイマークの
 * 1 つ上に配置する。デコード / プレビューは作らない (周辺 OSS が極小で、
 * 機能自体の定着も不透明 — 調査 C-6 の判断)。
 */

/** 種別ごとの文言・アイコン。UI 構造は共通なのでコピペせず表で持つ。 */
const KIND_COPY: Record<
  CategoryWaymarkKind,
  {
    icon: typeof MapPin;
    title: string;
    unit: string;
    addLabel: string;
    bodyLabel: string;
    bodyPlaceholder: string;
    labelPlaceholder: string;
    notePlaceholder: string;
    emptyTitle: string;
    emptyDescription: string;
    dialogTitleNew: string;
    dialogTitleEdit: string;
    dialogDescription: React.ReactNode;
    dndId: string;
    emptyFooter?: React.ReactNode;
  }
> = {
  waymark: {
    icon: MapPin,
    title: "ウェイマーク",
    unit: "マーカー",
    addLabel: "マーカー追加",
    bodyLabel: "markercode",
    bodyPlaceholder:
      '{"Name":"P3","MarkerA":{...}} など、ツールが出力した文字列をそのまま',
    labelPlaceholder: "例: P3 塔 / 基本散開",
    notePlaceholder: "例: 北を D1 側に合わせる",
    emptyTitle: "ウェイマーク未登録",
    emptyDescription:
      "作図ツールが出力する markercode を貼り付けて保存すると、ワンタップでコピーして配れます。",
    dialogTitleNew: "ウェイマークを追加",
    dialogTitleEdit: "ウェイマークを編集",
    // ゲーム内に公式の入出力機能は無く (調査 第3回 B-1)、取り込みには
    // PC + プラグインが要る。ただし設置後のマーカーは PT 全員に見えるので
    // 「PC の 1 人が取り込んで設置」で足りる、という前提を UI にも書く。
    dialogDescription: (
      <>
        ゲーム内にウェイマークの共有機能は無いため、配置データはツールが出力する
        markercode で受け渡します。取り込めるのは PC + プラグイン環境の人だけですが、
        <strong>設置後のマーカーはパーティ全員に見える</strong>ので、1 人が取り込んで
        設置すれば足ります。
      </>
    ),
    dndId: "dnd-waymarks",
  },
  board: {
    icon: LayoutDashboard,
    title: "ストラテジーボード",
    unit: "ボード",
    addLabel: "ボード追加",
    bodyLabel: "共有コード",
    bodyPlaceholder: "[stgy:...] 形式の共有コードをそのまま貼り付け",
    labelPlaceholder: "例: M12S P2 / 頭割り散開",
    notePlaceholder: "例: ゲーム8 式ベース、塔だけ変更",
    emptyTitle: "ストラテジーボード未登録",
    emptyDescription:
      "ゲーム内のストラテジーボードで発行した共有コードを貼り付けて保存すると、ワンタップでコピーして配れます。",
    dialogTitleNew: "ストラテジーボードを追加",
    dialogTitleEdit: "ストラテジーボードを編集",
    dialogDescription: (
      <>
        パッチ 7.4 のストラテジーボードで発行できる共有コードを保管します。
        <strong>プラグイン不要でコンソールからも取り込める</strong>ため、
        図面の共有手段としては最も確実です。
      </>
    ),
    dndId: "dnd-strategy-boards",
  },
};

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
  kind = "waymark",
}: {
  categoryId: string;
  categoryName: string;
  initialWaymarks: CategoryWaymark[];
  /** 2026-08-30: 表示する種別。既定はウェイマーク (従来挙動)。 */
  kind?: CategoryWaymarkKind;
}) {
  const copy = KIND_COPY[kind];
  const HeaderIcon = copy.icon;
  const allWaymarks = useRealtimeCategoryWaymarks(categoryId, initialWaymarks);
  // 1 テーブルを種別で分けて 2 セクションに描くため、ここで絞り込む。
  const waymarks = useMemo(
    () => allWaymarks.filter((w) => w.kind === kind),
    [allWaymarks, kind],
  );
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
      toast.error(`${copy.bodyLabel} を入力してください`);
      return;
    }
    setBusy(true);
    const result = editing.id
      ? await updateCategoryWaymark(editing.id, { label, body, note })
      : await createCategoryWaymark({ categoryId, kind, label, body, note });
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
    const label = w.label || `${categoryName} ${copy.title}`;
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
          <HeaderIcon className="h-4 w-4 text-[var(--neon-cyan)]" aria-hidden />
          <h2 className="font-display text-base">{copy.title}</h2>
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
          {copy.addLabel}
        </Button>
      </header>

      {ordered.length === 0 ? (
        <EmptyState
          icon={copy.icon}
          title={copy.emptyTitle}
          description={copy.emptyDescription}
        />
      ) : (
        <DndContext
          // dnd-kit の採番 (`DndDescribedBy-<n>`) は SSR とクライアントで
          // ずれて hydration mismatch になるため id を明示する
          // (category-list.tsx の詳しい注記を参照)。
          id={copy.dndId}
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
                  bodyLabel={copy.bodyLabel}
                  fallbackName={copy.title}
                  showPresetCheck={kind === "waymark"}
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
              {editing?.id ? copy.dialogTitleEdit : copy.dialogTitleNew}
            </DialogTitle>
            <DialogDescription>{copy.dialogDescription}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${kind}-label`}>ラベル</Label>
              <Input
                id={`${kind}-label`}
                value={editing?.label ?? ""}
                placeholder={copy.labelPlaceholder}
                onChange={(e) =>
                  setEditing((v) => (v ? { ...v, label: e.target.value } : v))
                }
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${kind}-body`}>{copy.bodyLabel}</Label>
              <Textarea
                id={`${kind}-body`}
                value={editing?.body ?? ""}
                rows={6}
                placeholder={copy.bodyPlaceholder}
                className="font-mono text-[11px]"
                onChange={(e) =>
                  setEditing((v) => (v ? { ...v, body: e.target.value } : v))
                }
              />
            </div>
            {/* 2026-08-30: 入力中に形式を検品して、保存前に気づけるようにする
                (取り込めない文字列を配ってから現地で気づく事故を防ぐ)。 */}
            {kind === "waymark" && (editing?.body ?? "").trim() !== "" && (
              <EditorPresetHint body={editing?.body ?? ""} />
            )}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${kind}-note`}>メモ（任意）</Label>
              <Input
                id={`${kind}-note`}
                value={editing?.note ?? ""}
                placeholder={copy.notePlaceholder}
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
  bodyLabel,
  fallbackName,
  showPresetCheck,
  onEdit,
  onDelete,
  onCopy,
}: {
  waymark: CategoryWaymark;
  /** "markercode" / "共有コード" — aria-label と tooltip に使う。 */
  bodyLabel: string;
  fallbackName: string;
  /** ウェイマークのみ: JSON 形式の検品バッジ / 警告を出す。 */
  showPresetCheck: boolean;
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
  const name = waymark.label || fallbackName;
  // 2026-08-30 (Tier2-7): 貼り付けた文字列の検品。取り込める形式かを
  // 配布前に確認でき、場外/空中座標 (いわゆる脱法マーカー) の混入も
  // 粗く弾ける。判定できない形式には何も出さない (誤警告を避ける)。
  const presetCheck = useMemo(
    () => (showPresetCheck ? checkWaymarkPreset(waymark.body) : null),
    [showPresetCheck, waymark.body],
  );
  const studioHref =
    showPresetCheck && isWaymarkStudioUrl(waymark.body)
      ? safeHref(waymark.body.trim())
      : null;
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
          aria-label={`${name} の${bodyLabel}を${expanded ? "閉じる" : "開く"}`}
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
            {presetCheck?.kind === "valid" && (
              <p className="mt-0.5 flex flex-wrap items-center gap-1">
                <span
                  className="inline-flex items-center gap-1 rounded-sm border border-emerald-400/40 bg-emerald-400/10 px-1 py-px font-mono text-[9px] tracking-[0.1em] text-emerald-200"
                  title="ツールに取り込める形式として認識できました"
                >
                  <BadgeCheck className="h-2.5 w-2.5" aria-hidden />
                  取込可 {presetCheck.info.activeCount}点
                </span>
                {presetCheck.info.warnings.map((w) => (
                  <span
                    key={w}
                    className="inline-flex items-center gap-1 rounded-sm border border-amber-400/40 bg-amber-400/10 px-1 py-px font-mono text-[9px] tracking-[0.1em] text-amber-200"
                    title={w}
                  >
                    <AlertTriangle className="h-2.5 w-2.5" aria-hidden />
                    要確認
                  </span>
                ))}
              </p>
            )}
          </span>
        </button>
        <div className="flex items-center gap-1">
          {studioHref && (
            // Waymark Studio の共有 URL は、プラグイン無しでもブラウザで
            // 配置を見られる (調査 第3回 B-3)。閲覧導線として開けるように。
            <a
              href={studioHref}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${name} の配置をブラウザで見る`}
              title="ブラウザで配置を見る (Waymark Studio)"
              className="inline-flex h-7 w-7 items-center justify-center rounded text-[var(--neon-violet)] hover:bg-[var(--neon-violet)]/15"
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </a>
          )}
          <button
            type="button"
            onClick={onCopy}
            aria-label={`${name} の${bodyLabel}をコピー`}
            title={`${bodyLabel}をコピー`}
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

/**
 * 編集ダイアログ内の形式ヒント (2026-08-30)。判定できないときは
 * 何も言わない — 「Waymark Studio の共有 URL を貼る」「メモを書く」等の
 * 正当な使い方を否定しないため。
 */
function EditorPresetHint({ body }: { body: string }) {
  const check = useMemo(() => checkWaymarkPreset(body), [body]);
  const studio = useMemo(() => isWaymarkStudioUrl(body), [body]);
  if (studio) {
    return (
      <p className="rounded-md border border-[var(--neon-violet)]/35 bg-[var(--neon-violet)]/8 px-2.5 py-1.5 text-[11px] leading-relaxed text-[var(--neon-violet)]">
        Waymark Studio の共有 URL として認識しました。プラグインが無い人も
        ブラウザで配置を見られます。
      </p>
    );
  }
  if (check.kind !== "valid") return null;
  return (
    <div className="flex flex-col gap-1 rounded-md border border-emerald-400/30 bg-emerald-400/5 px-2.5 py-1.5 text-[11px] leading-relaxed">
      <p className="text-emerald-200">
        取り込める形式として認識しました (マーカー {check.info.activeCount} 点
        {check.info.name ? ` / ${check.info.name}` : ""})
      </p>
      {check.info.warnings.map((w) => (
        <p key={w} className="text-amber-200">
          ⚠ {w}
        </p>
      ))}
    </div>
  );
}
