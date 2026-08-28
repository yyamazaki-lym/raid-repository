"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarClock,
  Check,
  CircleDashed,
  ExternalLink,
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
import { LinkSiteIcon } from "@/components/portal/link-site-icon";
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
  updateCategoryBisLinkAction,
} from "@/lib/server/category-bis-actions";

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

  return (
    <section className="flex flex-col gap-3 rounded-md border border-border/40 bg-secondary/10 p-3">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <CalendarClock
            className="h-4 w-4 text-[var(--neon-cyan)]"
            aria-hidden
          />
          <h2 className="font-display text-base">今週の消化</h2>
          <span className="font-mono text-[10px] tracking-[0.14em] text-muted-foreground">
            {weekLabel} / {untilReset}
          </span>
        </div>
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

      {rows.length === 0 ? (
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

  return (
    <section className="flex flex-col gap-3 rounded-md border border-border/40 bg-secondary/10 p-3">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Shirt className="h-4 w-4 text-[var(--neon-violet)]" aria-hidden />
          <h2 className="font-display text-base">最適装備 (BiS)</h2>
          <span className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground">
            {links.length} 件
          </span>
        </div>
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

      {links.length === 0 ? (
        <p className="text-[12px] leading-relaxed text-muted-foreground">
          XivGear などの装備シミュレータで組んだ構成の URL を登録すると、
          このコンテンツの BiS としてここに並びます。
        </p>
      ) : (
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {links.map((l) => {
            const href = safeHref(l.url);
            return (
              <li
                key={l.id}
                className="flex items-center gap-2 rounded-md border border-border/40 bg-background/30 px-2 py-1.5"
              >
                <LinkSiteIcon
                  url={l.url}
                  variant="fine"
                  className="h-3.5 w-3.5 shrink-0"
                />
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-w-0 flex-1"
                  title={l.note ?? l.url}
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-[12px] text-foreground/90">
                      {l.label}
                    </span>
                    {l.job && (
                      <span className="shrink-0 rounded-sm border border-border/50 px-1 font-mono text-[9px] tracking-[0.12em] text-muted-foreground uppercase">
                        {l.job}
                      </span>
                    )}
                    <ExternalLink
                      className="h-2.5 w-2.5 shrink-0 opacity-60"
                      aria-hidden
                    />
                  </span>
                  {l.ownerName && (
                    <span className="block truncate text-[10px] text-muted-foreground">
                      {l.ownerName}
                    </span>
                  )}
                </a>
                {canEdit && (
                  <span className="flex shrink-0 items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => startEdit(l)}
                      aria-label={`${l.label} を編集`}
                      title="編集"
                      className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                    >
                      <Pencil className="h-3 w-3" aria-hidden />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(l)}
                      aria-label={`${l.label} を削除`}
                      title="削除"
                      className="inline-flex h-6 w-6 items-center justify-center rounded text-rose-300 hover:bg-rose-500/15 hover:text-rose-200"
                    >
                      <Trash2 className="h-3 w-3" aria-hidden />
                    </button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
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
              XivGear などで作った構成の共有 URL
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
