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
  buildWaymarkLayout,
  checkWaymarkPreset,
  isWaymarkStudioUrl,
  MARKER_COLOR,
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
import { useLocale, useMessages } from "@/lib/i18n/client";

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

/**
 * 種別ごとのアイコンと DnD id。文言は辞書 `waymarks.kinds.<kind>` にあり、
 * UI 構造は共通なので表で持つ (コピペしない)。
 */
const KIND_META: Record<
  CategoryWaymarkKind,
  { icon: typeof MapPin; dndId: string }
> = {
  waymark: { icon: MapPin, dndId: "dnd-waymarks" },
  board: { icon: LayoutDashboard, dndId: "dnd-strategy-boards" },
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
  const m = useMessages();
  const copy = m.waymarks.kinds[kind];
  const meta = KIND_META[kind];
  const HeaderIcon = meta.icon;
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
      toast.error(m.waymarks.enterBody(copy.bodyLabel));
      return;
    }
    setBusy(true);
    const result = editing.id
      ? await updateCategoryWaymark(editing.id, { label, body, note })
      : await createCategoryWaymark({ categoryId, kind, label, body, note });
    setBusy(false);
    if (!result.ok) {
      toast.error(m.crud.saveFailed(result.reason));
      return;
    }
    toast.success(editing.id ? m.crud.updated : m.crud.added);
    setEditing(null);
  };

  const onDelete = async (w: CategoryWaymark) => {
    const ok = await confirm({
      title: m.crud.deleteConfirmTitle(w.label || m.crud.unnamed),
      confirmText: m.common.delete,
      destructive: true,
    });
    if (!ok) return;
    const result = await deleteCategoryWaymark(w.id);
    if (!result.ok) {
      toast.error(m.crud.deleteFailed(result.reason));
      return;
    }
    toast.success(m.crud.deleted);
  };

  const onCopy = async (w: CategoryWaymark) => {
    const label =
      w.label || m.waymarks.copyFallbackLabel(categoryName, copy.title);
    try {
      await navigator.clipboard.writeText(w.body);
      toast.success(m.crud.copied(label));
    } catch (e) {
      console.warn("[waymarks] clipboard error:", e);
      toast.error(m.crud.copyFailed);
    }
  };

  return (
    <section className="flex flex-col gap-3">
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <HeaderIcon className="h-4 w-4 text-[var(--neon-cyan)]" aria-hidden />
          <h2 className="font-display text-base">{copy.title}</h2>
          <span className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground">
            {m.crud.count(ordered.length)}
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
          icon={meta.icon}
          title={copy.emptyTitle}
          description={copy.emptyDescription}
        />
      ) : (
        <DndContext
          // dnd-kit の採番 (`DndDescribedBy-<n>`) は SSR とクライアントで
          // ずれて hydration mismatch になるため id を明示する
          // (category-list.tsx の詳しい注記を参照)。
          id={meta.dndId}
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
            <DialogDescription>
              {copy.descA}
              <strong>{copy.descStrong}</strong>
              {copy.descB}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${kind}-label`}>{m.waymarks.labelLabel}</Label>
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
              <Label htmlFor={`${kind}-note`}>{m.waymarks.noteLabel}</Label>
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
              {m.common.cancel}
            </Button>
            <Button type="button" onClick={onSave} disabled={busy}>
              {busy ? m.crud.savingDots : m.common.save}
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
  const m = useMessages();
  const locale = useLocale();
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
    () => (showPresetCheck ? checkWaymarkPreset(waymark.body, locale) : null),
    [showPresetCheck, waymark.body, locale],
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
          aria-label={m.waymarks.toggleAria(name, bodyLabel, expanded)}
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
          {/* `min-w-0` だけでは不十分: `truncate` の `white-space: nowrap` は
              min-content 幅を縮めないため、祖先 (root layout の flex 列) まで
              min-content が伝播してページ全体が横に伸びる。`w-0` で幅を確定
              させると伝播が止まり、`flex-1` で実際の描画幅まで広がる。 */}
          <span className="w-0 min-w-0 flex-1">
            <p className="truncate font-display text-sm">
              {waymark.label || (
                <span className="text-muted-foreground/80">
                  {m.crud.noLabel}
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
                  title={m.waymarks.validTitle}
                >
                  <BadgeCheck className="h-2.5 w-2.5" aria-hidden />
                  {m.waymarks.importable(presetCheck.info.activeCount)}
                </span>
                {presetCheck.info.warnings.map((w) => (
                  <span
                    key={w}
                    className="inline-flex items-center gap-1 rounded-sm border border-amber-400/40 bg-amber-400/10 px-1 py-px font-mono text-[9px] tracking-[0.1em] text-amber-200"
                    title={w}
                  >
                    <AlertTriangle className="h-2.5 w-2.5" aria-hidden />
                    {m.waymarks.needsCheck}
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
              aria-label={m.waymarks.studioAria(name)}
              title={m.waymarks.studioTitle}
              className="inline-flex h-7 w-7 items-center justify-center rounded text-[var(--neon-violet)] hover:bg-[var(--neon-violet)]/15"
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </a>
          )}
          <button
            type="button"
            onClick={onCopy}
            aria-label={m.waymarks.copyAria(name, bodyLabel)}
            title={m.waymarks.copyTitle(bodyLabel)}
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
        <div className="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-start">
          {/* 2026-08-30: 取り込める形式なら 8 点の相対配置を簡易プレビュー。
              アリーナの地形データは持っていないので縁は描かず、点の位置
              関係だけを出す (それらしく描いて実際とずれると誤解を生む)。 */}
          {presetCheck?.kind === "valid" &&
            presetCheck.info.activeCount > 0 && (
              <WaymarkLayoutPreview
                points={presetCheck.info.points}
                label={name}
              />
            )}
          <pre className="max-h-[12rem] min-w-0 flex-1 overflow-y-auto font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-all text-foreground/85">
            {waymark.body}
          </pre>
        </div>
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
  const m = useMessages();
  const locale = useLocale();
  const check = useMemo(() => checkWaymarkPreset(body, locale), [body, locale]);
  const studio = useMemo(() => isWaymarkStudioUrl(body), [body]);
  if (studio) {
    return (
      <p className="rounded-md border border-[var(--neon-violet)]/35 bg-[var(--neon-violet)]/8 px-2.5 py-1.5 text-[11px] leading-relaxed text-[var(--neon-violet)]">
        {m.waymarks.hintStudio}
      </p>
    );
  }
  if (check.kind !== "valid") return null;
  return (
    <div className="flex flex-col gap-1 rounded-md border border-emerald-400/30 bg-emerald-400/5 px-2.5 py-1.5 text-[11px] leading-relaxed">
      <p className="text-emerald-200">
        {m.waymarks.hintValid(
          check.info.activeCount,
          check.info.name ? ` / ${check.info.name}` : "",
        )}
      </p>
      {check.info.warnings.map((w) => (
        <p key={w} className="text-amber-200">
          {m.waymarks.warningPrefix}
          {w}
        </p>
      ))}
    </div>
  );
}

/**
 * ウェイマークの簡易トップダウン表示 (2026-08-30、Tier2-7 follow-up)。
 *
 * 描くのは **8 点の相対配置だけ**。MapID からアリーナ形状を引くデータを
 * 持っていないため、円や床のフチは描かない (実際の地形と食い違う絵は
 * 「合っている」と誤解させるので出さない)。北が上 (Z が増える向きが下)。
 */
function WaymarkLayoutPreview({
  points,
  label,
}: {
  points: Parameters<typeof buildWaymarkLayout>[0];
  label: string;
}) {
  const m = useMessages();
  const layout = useMemo(() => buildWaymarkLayout(points), [points]);
  if (layout.length === 0) return null;
  // viewBox 100x100 に 12 のパディングを取り、マーカー半径 7 で描く。
  const PAD = 12;
  const R = 7;
  const scale = 100 - PAD * 2;
  return (
    <figure className="flex shrink-0 flex-col items-center gap-1">
      <svg
        viewBox="0 0 100 100"
        role="img"
        aria-label={m.waymarks.layoutAria(label)}
        className="h-32 w-32 rounded-md border border-border/40 bg-background/40"
      >
        {/* 中心の十字 (方角の目安。地形ではない) */}
        <line x1="50" y1={PAD} x2="50" y2={100 - PAD} stroke="currentColor" strokeWidth="0.5" className="text-border" />
        <line x1={PAD} y1="50" x2={100 - PAD} y2="50" stroke="currentColor" strokeWidth="0.5" className="text-border" />
        <text x="50" y="8" textAnchor="middle" className="fill-muted-foreground" style={{ fontSize: 7 }}>
          N
        </text>
        {layout.map((p) => {
          const cx = PAD + p.nx * scale;
          const cy = PAD + p.ny * scale;
          const color = MARKER_COLOR[p.key] ?? "#9ca3af";
          const isNumber = /^[1-4]$/.test(p.label);
          return (
            <g key={p.key}>
              {isNumber ? (
                <circle cx={cx} cy={cy} r={R} fill={color} fillOpacity={0.22} stroke={color} strokeWidth="1.2" />
              ) : (
                <rect
                  x={cx - R}
                  y={cy - R}
                  width={R * 2}
                  height={R * 2}
                  rx="2"
                  fill={color}
                  fillOpacity={0.22}
                  stroke={color}
                  strokeWidth="1.2"
                />
              )}
              <text
                x={cx}
                y={cy + 2.6}
                textAnchor="middle"
                fill={color}
                style={{ fontSize: 7, fontWeight: 700 }}
              >
                {p.label}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption className="text-[9px] text-muted-foreground/70">
        {m.waymarks.layoutCaption}
      </figcaption>
    </figure>
  );
}
