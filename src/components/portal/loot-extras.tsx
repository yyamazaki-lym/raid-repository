"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, rectSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  CalendarClock,
  Check,
  ChevronDown,
  CircleDashed,
  ExternalLink,
  Eye,
  GripVertical,
  Pencil,
  Plus,
  Shirt,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useConfirm } from "@/components/portal/confirm-dialog";
import { useCollapsible } from "@/lib/use-collapsible";
import { LinkSiteIcon } from "@/components/portal/link-site-icon";
import { toXivgearEmbedUrl } from "@/lib/xivgear-url";
import { fetchXivgearSummaryAction } from "@/lib/server/xivgear-actions";
import type { XivgearSheetSummary } from "@/lib/xivgear-set";
import { safeHref } from "@/lib/url-safe";
import { getStoredAuthorName } from "@/lib/schedule-memos-client";
import {
  LOOT_WEEKLY_STATUSES,
  type CategoryBisLink,
  type LootWeeklyRow,
  type LootWeeklyStatus,
} from "@/lib/loot-weekly";
import { setMyLootWeeklyStatusAction } from "@/lib/server/loot-weekly-actions";
import {
  createCategoryBisLinkAction,
  deleteCategoryBisLinkAction,
  setCategoryBisLinkOrderAction,
  updateCategoryBisLinkAction,
} from "@/lib/server/category-bis-actions";
import {
  applyOptimisticOrder,
  useSortableReorder,
} from "@/lib/use-sortable-reorder";

/**
 * ロットタブの上に置く 2 パネル (TODO #94)。
 *
 *   1. 今週の消化チェック (A-4) — 週制限 (火 17:00 JST リセット) を跨ぐ
 *      「今週分を消化したか」だけを持つ。部位ごとのロット表は従来どおり
 *      Google Sheets が正。
 *   2. 最適装備 (BiS) リンク — XivGear などの共有 URL を預かるだけ。
 *
 * 自分の行以外は触れない (client に Discord ID を渡さない設計。誰が誰か
 * の判定は server 側で `isMe` に畳んである)。
 */

const STATUS_STYLE: Record<LootWeeklyStatus, string> = {
  未消化: "border-border/50 bg-secondary/30 text-muted-foreground",
  消化済: "border-emerald-400/45 bg-emerald-400/10 text-emerald-200",
  辞退: "border-amber-400/45 bg-amber-400/10 text-amber-200",
};

export function LootWeeklyPanel({
  categoryId,
  weekStart,
  weekLabel,
  untilReset,
  rows,
}: {
  categoryId: string;
  weekStart: string;
  weekLabel: string;
  untilReset: string;
  rows: LootWeeklyRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const me = rows.find((r) => r.isMe) ?? null;
  const unresolved = rows.filter((r) => r.status === "未消化").length;

  const setMyStatus = (status: LootWeeklyStatus) => {
    startTransition(async () => {
      const result = await setMyLootWeeklyStatusAction({
        categoryId,
        weekStart,
        status,
        // ロスター未登録の固定でも名前が出るように、日付メモと同じ表示名を送る。
        displayName: me?.displayName || getStoredAuthorName(),
      });
      if (!result.ok) {
        toast.error(result.reason);
        return;
      }
      toast.success(`今週を「${status}」にしました`);
      router.refresh();
    });
  };

  // 折りたたみ状態は localStorage で永続 (他セクションと同じ use-collapsible)。
  const [collapsed, setCollapsed] = useCollapsible(
    "raid-repo:loot-weekly-collapsed",
  );

  return (
    <section className="flex flex-col gap-3 rounded-md border border-border/40 bg-secondary/10 p-3">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          aria-expanded={!collapsed}
          className="flex min-w-0 items-center gap-2 rounded px-1 text-left hover:bg-secondary/30"
        >
          <ChevronDown
            className={
              "h-3 w-3 shrink-0 text-muted-foreground transition-transform " +
              (collapsed ? "-rotate-90" : "rotate-0")
            }
            aria-hidden
          />
          <CalendarClock
            className="h-4 w-4 text-[var(--neon-cyan)]"
            aria-hidden
          />
          <h2 className="font-display text-base whitespace-nowrap">今週の消化</h2>
          <span className="flex flex-wrap gap-x-1.5 font-mono text-[10px] tracking-[0.14em] text-muted-foreground">
            {/* 個々の断片が語中で折れないように分割しておく。 */}
            <span className="whitespace-nowrap">{weekLabel}</span>
            <span className="whitespace-nowrap">{untilReset}</span>
          </span>
        </button>
        <span
          className={
            "rounded-sm border px-2 py-1 font-mono text-[10px] tracking-[0.14em] " +
            (unresolved === 0
              ? "border-emerald-400/45 bg-emerald-400/10 text-emerald-200"
              : "border-amber-400/45 bg-amber-400/10 text-amber-200")
          }
        >
          未消化 {unresolved} 名
        </span>
      </header>

      {collapsed ? null : rows.length === 0 ? (
        <p className="text-[12px] leading-relaxed text-muted-foreground">
          メンバー一覧が未登録です。下のボタンで自分の状態を記録すると、この
          コンテンツの今週分としてカウントされます。
        </p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {rows.map((r) => (
            <li
              key={r.id}
              className={
                "inline-flex items-center gap-1.5 rounded-sm border px-2 py-1 text-[11px] " +
                STATUS_STYLE[r.status] +
                (r.isMe ? " ring-1 ring-[var(--neon-cyan)]/50" : "")
              }
              title={r.note ?? undefined}
            >
              {r.status === "消化済" ? (
                <Check className="h-3 w-3" aria-hidden />
              ) : r.status === "辞退" ? (
                <X className="h-3 w-3" aria-hidden />
              ) : (
                <CircleDashed className="h-3 w-3" aria-hidden />
              )}
              <span className="max-w-[9rem] truncate">
                {r.displayName || "(名前未設定)"}
              </span>
              {r.isMe && (
                <span className="font-mono text-[9px] tracking-[0.14em] opacity-70">
                  YOU
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {!collapsed && (
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase">
          自分の状態
        </span>
        {LOOT_WEEKLY_STATUSES.map((s) => (
          <Button
            key={s}
            type="button"
            size="sm"
            variant={me?.status === s ? "default" : "outline"}
            disabled={pending}
            onClick={() => setMyStatus(s)}
            className="h-7 text-[11px] tracking-normal"
            aria-pressed={me?.status === s}
          >
            {s}
          </Button>
        ))}
      </div>
      )}
    </section>
  );
}

// ---------- BiS links ------------------------------------------------------

type BisEditState = {
  id?: string;
  label: string;
  url: string;
  job: string;
  ownerName: string;
  note: string;
} | null;

export function BisLinksPanel({
  categoryId,
  links,
  canEdit,
}: {
  categoryId: string;
  links: CategoryBisLink[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<BisEditState>(null);
  const [busy, setBusy] = useState(false);

  const startNew = () =>
    setEditing({ label: "", url: "", job: "", ownerName: "", note: "" });
  const startEdit = (l: CategoryBisLink) =>
    setEditing({
      id: l.id,
      label: l.label,
      url: l.url,
      job: l.job ?? "",
      ownerName: l.ownerName ?? "",
      note: l.note ?? "",
    });

  const onSave = async () => {
    if (!editing) return;
    setBusy(true);
    const payload = {
      label: editing.label,
      url: editing.url,
      job: editing.job,
      ownerName: editing.ownerName,
      note: editing.note,
    };
    const result = editing.id
      ? await updateCategoryBisLinkAction(editing.id, payload)
      : await createCategoryBisLinkAction({ categoryId, ...payload });
    setBusy(false);
    if (!result.ok) {
      toast.error("保存失敗: " + result.reason);
      return;
    }
    toast.success(editing.id ? "更新しました" : "追加しました");
    setEditing(null);
    router.refresh();
  };

  const onDelete = async (l: CategoryBisLink) => {
    const ok = await confirm({
      title: `「${l.label}」を削除しますか？`,
      confirmText: "削除",
      destructive: true,
    });
    if (!ok) return;
    const result = await deleteCategoryBisLinkAction(l.id);
    if (!result.ok) {
      toast.error("削除失敗: " + result.reason);
      return;
    }
    toast.success("削除しました");
    router.refresh();
  };

  const [collapsed, setCollapsed] = useCollapsible(
    "raid-repo:loot-bis-collapsed",
  );
  // 2026-09-04 実機要望「BiS を並び替え出来るようにしてほしい」。
  // sort_order は追加時に採番されるだけで、後から入れ替える手段が無かった。
  // ウェイマーク / マクロ / 動画と同じ共通フックに乗せる (楽観反映 → 永続化
  // → 失敗時ロールバック)。
  const { optimisticOrder, sensors, handleDragEnd, syncOnSettle } =
    useSortableReorder({ persist: setCategoryBisLinkOrderAction });
  const ordered = useMemo(
    () => applyOptimisticOrder(links, optimisticOrder),
    [links, optimisticOrder],
  );
  useEffect(() => {
    // サーバー由来の確定順が楽観順に追いついたら楽観 state を畳む。
    // このリストは Realtime 購読が無く router.refresh() 経由で更新される。
    syncOnSettle(links.map((l) => l.id));
  }, [links, syncOnSettle]);
  // 2026-08-30: XivGear の埋め込みビューでの装備プレビュー。
  // グリッド内で展開すると 2 列レイアウトが崩れるので、開けるのは
  // 常に 1 件だけ・描画位置はリストの下、という形にする。
  const [previewId, setPreviewId] = useState<string | null>(null);
  const previewLink = links.find((l) => l.id === previewId) ?? null;
  // 2026-08-30: 埋め込みと同時に XivGear API の要約も出す。埋め込みは
  // 見た目の確認、要約は「どの部位がまだ空か」の確認に効く。ボタンを
  // 増やさずに済むよう、プレビューを開いたときにまとめて取得する。
  const [summaryState, setSummaryState] = useState<{
    linkId: string;
    loading: boolean;
    summary: XivgearSheetSummary | null;
    reason: string | null;
  } | null>(null);

  const previewSummary =
    summaryState && previewLink && summaryState.linkId === previewLink.id
      ? summaryState
      : null;
  // 埋め込みは単一セットのみ対応。複数セットのシートは 1 セット目に絞る
  // (2026-08-30 実機報告「Embedding is only supported for a single set」)。
  // 要約が返るまでセット数が分からないので、それまで iframe は出さない —
  // 途中で URL が変わると再読み込みで画面が揺れるため。
  const previewSrc =
    previewLink && previewSummary && !previewSummary.loading
      ? toXivgearEmbedUrl(
          previewLink.url,
          (previewSummary.summary?.sets.length ?? 1) > 1 ? 1 : undefined,
        )
      : null;

  const openPreview = (link: CategoryBisLink) => {
    if (previewId === link.id) {
      setPreviewId(null);
      return;
    }
    setPreviewId(link.id);
    setSummaryState({
      linkId: link.id,
      loading: true,
      summary: null,
      reason: null,
    });
    void fetchXivgearSummaryAction(link.url).then((r) => {
      setSummaryState((cur) =>
        cur && cur.linkId === link.id
          ? {
              linkId: link.id,
              loading: false,
              summary: r.ok ? r.summary : null,
              reason: r.ok ? null : r.reason,
            }
          : cur,
      );
    });
  };

  return (
    <section className="flex flex-col gap-3 rounded-md border border-border/40 bg-secondary/10 p-3">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          aria-expanded={!collapsed}
          className="flex min-w-0 items-center gap-2 rounded px-1 text-left hover:bg-secondary/30"
        >
          <ChevronDown
            className={
              "h-3 w-3 shrink-0 text-muted-foreground transition-transform " +
              (collapsed ? "-rotate-90" : "rotate-0")
            }
            aria-hidden
          />
          <Shirt className="h-4 w-4 text-[var(--neon-violet)]" aria-hidden />
          <h2 className="font-display text-base">最適装備 (BiS)</h2>
          <span className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground">
            {links.length} 件
          </span>
        </button>
        {canEdit && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={startNew}
            className="gap-1.5 text-[11px] tracking-normal"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            BiS 追加
          </Button>
        )}
      </header>

      {collapsed ? null : links.length === 0 ? (
        <p className="text-[12px] leading-relaxed text-muted-foreground">
          <a
            href="https://xivgear.app/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--neon-cyan)] underline underline-offset-2 hover:text-foreground"
          >
            XivGear
          </a>{" "}
          などの装備シミュレータで組んだ構成の URL を登録すると、
          このコンテンツの BiS としてここに並びます。
        </p>
      ) : (
        // `1fr` は `minmax(auto,1fr)` = 最小トラックが min-content なので、
        // 長いラベル 1 件でグリッドがコンテナ幅を超える (モバイルで横スクロール
        // が出る)。最小を 0 に固定して必ず縮むようにする。
        //
        // 2026-09-04: admin のときだけ DnD で並び替えられるようにする。
        // 2 列グリッドなので strategy は rectSortingStrategy (縦一列用の
        // verticalListSortingStrategy では横移動が拾えない)。閲覧者には
        // DndContext を被せず、素の <ul> のまま描く。
        <BisList
          links={ordered}
          canEdit={canEdit}
          sensors={sensors}
          onDragEnd={(e) => handleDragEnd(e, ordered)}
          previewId={previewId}
          onPreview={openPreview}
          onEdit={startEdit}
          onDelete={onDelete}
        />
      )}

      {/* 埋め込みプレビュー: リストの下に 1 枚だけ。高さを固定して
          セクションが伸び続けないようにし、閉じるボタンを必ず出す。 */}
      {!collapsed && previewLink && (
        <div className="flex flex-col gap-1 rounded-md border border-[var(--neon-violet)]/35 bg-background/40 p-1.5">
          <div className="flex items-center justify-between gap-2 px-1">
            <span className="min-w-0 truncate text-[11px] text-foreground/85">
              {previewLink.label}
              {previewLink.job ? ` (${previewLink.job})` : ""}
            </span>
            <button
              type="button"
              onClick={() => {
                setPreviewId(null);
                setSummaryState(null);
              }}
              aria-label="プレビューを閉じる"
              title="閉じる"
              className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
            >
              <X className="h-3 w-3" aria-hidden />
            </button>
          </div>
          {previewSummary && (
            <XivgearSummaryStrip
              loading={previewSummary.loading}
              summary={previewSummary.summary}
              reason={previewSummary.reason}
            />
          )}
          {/* 高さを常に固定して、読み込み前後でページが揺れないようにする
              (2026-08-30 実機報告「スクロールが中途半端な位置のためかブレる」)。 */}
          <div className="h-[26rem] w-full overflow-hidden rounded-sm bg-white/95">
            {previewSrc ? (
              <iframe
                key={previewSrc}
                src={previewSrc}
                title={`${previewLink.label} の装備 (XivGear)`}
                loading="lazy"
                referrerPolicy="no-referrer"
                sandbox="allow-scripts allow-same-origin allow-popups"
                className="h-full w-full border-0"
              />
            ) : (
              <p className="flex h-full items-center justify-center text-[11px] text-muted-foreground">
                読み込み中…
              </p>
            )}
          </div>
        </div>
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
              {editing?.id ? "BiS リンクを編集" : "BiS リンクを追加"}
            </DialogTitle>
            <DialogDescription>
              <a
                href="https://xivgear.app/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--neon-cyan)] underline underline-offset-2 hover:text-foreground"
              >
                XivGear
              </a>{" "}
              などで作った構成の共有 URL
              を登録します。シミュレータ自体は portal では持ちません。
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="bis-label">ラベル</Label>
              <Input
                id="bis-label"
                value={editing?.label ?? ""}
                placeholder="例: 7.5 零式4層 BiS"
                onChange={(e) =>
                  setEditing((v) => (v ? { ...v, label: e.target.value } : v))
                }
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="bis-url">URL</Label>
              <Input
                id="bis-url"
                value={editing?.url ?? ""}
                placeholder="https://xivgear.app/?page=..."
                onChange={(e) =>
                  setEditing((v) => (v ? { ...v, url: e.target.value } : v))
                }
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="bis-job">ジョブ（任意）</Label>
                <Input
                  id="bis-job"
                  value={editing?.job ?? ""}
                  placeholder="例: WAR"
                  onChange={(e) =>
                    setEditing((v) => (v ? { ...v, job: e.target.value } : v))
                  }
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="bis-owner">担当者（任意）</Label>
                <Input
                  id="bis-owner"
                  value={editing?.ownerName ?? ""}
                  placeholder="例: たろう"
                  onChange={(e) =>
                    setEditing((v) =>
                      v ? { ...v, ownerName: e.target.value } : v,
                    )
                  }
                />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="bis-note">メモ（任意）</Label>
              <Input
                id="bis-note"
                value={editing?.note ?? ""}
                placeholder="例: 断章は武器優先"
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

/**
 * BiS 埋め込みの上に出す要約 (2026-08-30)。
 *
 * XivGear の `/fulldata` は item ID しか返さない (装備名も IL も含まない)
 * ため、名前の一覧は出せない。代わりに「組み終わっているか」を判断できる
 * 情報 — 埋まっている部位数・未設定スロット・マテリア数・食事・主要サブステ
 * — に絞る。取得失敗時は 1 行の注記だけで、埋め込み自体は従来どおり出る。
 */
function XivgearSummaryStrip({
  loading,
  summary,
  reason,
}: {
  loading: boolean;
  summary: XivgearSheetSummary | null;
  reason: string | null;
}) {
  // 読み込み前後で高さが変わるとページが揺れるので min-h を確保する。
  if (loading) {
    return (
      <p className="min-h-[1.5rem] px-1 text-[10px] text-muted-foreground/80">
        セット情報を取得中…
      </p>
    );
  }
  if (!summary) {
    return (
      <p className="min-h-[1.5rem] px-1 text-[10px] text-muted-foreground/80">
        {reason ?? "セット情報を取得できませんでした"}
      </p>
    );
  }
  // シートに複数セットが入っている場合があるので先頭 2 件まで出す
  // (それ以上は埋め込み側で見てもらう — 縦に伸ばさない)。
  const sets = summary.sets.slice(0, 2);
  return (
    <div className="flex min-h-[1.5rem] flex-col gap-1 px-1">
      {sets.map((set, i) => {
        const complete = set.missingSlots.length === 0;
        return (
          <div key={i} className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {set.name && (
              <span className="text-[11px] text-foreground/85">{set.name}</span>
            )}
            {set.job && (
              <span className="rounded-sm border border-border/50 px-1 font-mono text-[9px] tracking-[0.12em] text-muted-foreground uppercase">
                {set.job}
                {set.level ? ` Lv${set.level}` : ""}
              </span>
            )}
            <span
              className={
                "rounded-sm border px-1 py-px font-mono text-[10px] tabular-nums " +
                (complete
                  ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-200"
                  : "border-amber-400/40 bg-amber-400/10 text-amber-200")
              }
              title={
                complete
                  ? "全部位が設定されています"
                  : `未設定: ${set.missingSlots.join(", ")}`
              }
            >
              部位 {set.filledSlots}/{set.expectedSlots}
            </span>
            {!complete && (
              <span className="text-[10px] text-amber-200/90">
                未設定: {set.missingSlots.join(", ")}
              </span>
            )}
            <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
              マテリア {set.materiaCount}
            </span>
            <span
              className={
                "font-mono text-[10px] " +
                (set.hasFood ? "text-muted-foreground" : "text-amber-200/90")
              }
            >
              {set.hasFood ? "食事あり" : "食事なし"}
            </span>
            {set.stats.slice(0, 4).map((st) => (
              <span
                key={st.label}
                className="font-mono text-[10px] tabular-nums text-muted-foreground/85"
              >
                {st.label} {st.value}
              </span>
            ))}
          </div>
        );
      })}
      {summary.sets.length > sets.length && (
        <p className="text-[10px] text-muted-foreground/70">
          ほか {summary.sets.length - sets.length} セット
        </p>
      )}
    </div>
  );
}

/**
 * BiS リストの本体 (2026-09-04)。admin のときだけ DnD を被せる。
 *
 * 閲覧者に DndContext を張らない理由は 2 つ: 並び替えを保存できないので
 * 掴めても意味が無いこと、そしてタッチ操作 (長押し 200ms) がリンクの
 * タップと競合すること。
 */
function BisList({
  links,
  canEdit,
  sensors,
  onDragEnd,
  previewId,
  onPreview,
  onEdit,
  onDelete,
}: {
  links: CategoryBisLink[];
  canEdit: boolean;
  sensors: ReturnType<typeof useSortableReorder>["sensors"];
  onDragEnd: (event: DragEndEvent) => void;
  previewId: string | null;
  onPreview: (link: CategoryBisLink) => void;
  onEdit: (link: CategoryBisLink) => void;
  onDelete: (link: CategoryBisLink) => void;
}) {
  const rows = links.map((l) => {
    const rowProps = {
      link: l,
      canEdit,
      previewActive: previewId === l.id,
      onPreview: () => onPreview(l),
      onEdit: () => onEdit(l),
      onDelete: () => onDelete(l),
    };
    // 閲覧者は `useSortable` を **通らない**。dnd-kit のフックは
    // DndContext / SortableContext の内側にあることが前提なので、
    // 被せない側で呼ぶと余計な警告の元になる。
    return canEdit ? (
      <SortableBisRow key={l.id} {...rowProps} />
    ) : (
      <BisRow key={l.id} {...rowProps} />
    );
  });
  const list = (
    <ul className="grid grid-cols-[minmax(0,1fr)] gap-1.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      {rows}
    </ul>
  );
  if (!canEdit) return list;
  return (
    <DndContext
      // dnd-kit の採番 (`DndDescribedBy-<n>`) は SSR とクライアントでずれて
      // hydration mismatch になるため id を明示する (category-list.tsx の注記参照)。
      id="bis-links-dnd"
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
    >
      <SortableContext items={links.map((l) => l.id)} strategy={rectSortingStrategy}>
        {list}
      </SortableContext>
    </DndContext>
  );
}

type BisRowProps = {
  link: CategoryBisLink;
  canEdit: boolean;
  previewActive: boolean;
  onPreview: () => void;
  onEdit: () => void;
  onDelete: () => void;
};

/** admin 用: 行に useSortable を足すだけのラッパ (SortableContext の内側)。 */
function SortableBisRow(props: BisRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: props.link.id });
  return (
    <BisRow
      {...props}
      setNodeRef={setNodeRef}
      attributes={attributes}
      listeners={listeners}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        zIndex: isDragging ? 10 : "auto",
      }}
    />
  );
}

function BisRow({
  link,
  canEdit,
  previewActive,
  onPreview,
  onEdit,
  onDelete,
  setNodeRef,
  attributes,
  listeners,
  style,
}: BisRowProps & {
  setNodeRef?: (node: HTMLElement | null) => void;
  attributes?: React.HTMLAttributes<HTMLElement>;
  listeners?: Record<string, unknown>;
  style?: React.CSSProperties;
}) {
  const href = safeHref(link.url);
  return (
          <li
            ref={setNodeRef}
            style={style}
            {...attributes}
            className="flex items-center gap-2 rounded-md border border-border/40 bg-background/30 px-2 py-1.5"
          >
            {/* ドラッグハンドル。行全体を掴めるようにすると、
                ラベルのリンクをタップしたいだけの操作を奪ってしまう
                (ウェイマーク行と同じ理由でハンドルだけに listeners)。 */}
            {listeners && (
              <span
                {...listeners}
                role="presentation"
                aria-label={`${link.label} のドラッグハンドル`}
                title="ドラッグで並び替え"
                className="-ml-1 inline-flex h-6 w-4 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground/70 hover:bg-secondary/60 hover:text-foreground active:cursor-grabbing"
              >
                <GripVertical className="h-3.5 w-3.5" aria-hidden />
              </span>
            )}
            <LinkSiteIcon
              url={link.url}
              variant="fine"
              className="h-3.5 w-3.5 shrink-0"
            />
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              // `w-0` で幅を確定させ、nowrap な truncate ラベルの
              // min-content 幅が祖先へ伝播するのを止める (ウェイマーク行と同じ)。
              className="w-0 min-w-0 flex-1"
              title={link.note ?? link.url}
            >
              <span className="flex min-w-0 items-center gap-1.5">
                {/* flex item は min-width:auto が既定で縮まないため、
                    truncate を効かせるには自身にも min-w-0 が要る。 */}
                <span className="min-w-0 truncate text-[12px] text-foreground/90">
                  {link.label}
                </span>
                {link.job && (
                  <span className="shrink-0 rounded-sm border border-border/50 px-1 font-mono text-[9px] tracking-[0.12em] text-muted-foreground uppercase">
                    {link.job}
                  </span>
                )}
                <ExternalLink
                  className="h-2.5 w-2.5 shrink-0 opacity-60"
                  aria-hidden
                />
              </span>
              {link.ownerName && (
                <span className="block truncate text-[10px] text-muted-foreground">
                  {link.ownerName}
                </span>
              )}
            </a>
            {toXivgearEmbedUrl(link.url) && (
              <button
                type="button"
                onClick={onPreview}
                aria-pressed={previewActive}
                aria-label={`${link.label} の装備を表示`}
                title="装備をこの画面で見る"
                className={
                  "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded transition-colors " +
                  (previewActive
                    ? "bg-[var(--neon-violet)]/20 text-[var(--neon-violet)]"
                    : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground")
                }
              >
                <Eye className="h-3 w-3" aria-hidden />
              </button>
            )}
            {canEdit && (
              <span className="flex shrink-0 items-center gap-0.5">
                <button
                  type="button"
                  onClick={onEdit}
                  aria-label={`${link.label} を編集`}
                  title="編集"
                  className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                >
                  <Pencil className="h-3 w-3" aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={onDelete}
                  aria-label={`${link.label} を削除`}
                  title="削除"
                  className="inline-flex h-6 w-6 items-center justify-center rounded text-rose-300 hover:bg-rose-500/15 hover:text-rose-200"
                >
                  <Trash2 className="h-3 w-3" aria-hidden />
                </button>
              </span>
            )}
          </li>
  );
}
