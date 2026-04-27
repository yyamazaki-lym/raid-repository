"use client";

import { useState } from "react";
import {
  ClipboardCopy,
  ClipboardList,
  Pencil,
  Plus,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
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
  updateRecruitmentTemplate,
  useRealtimeRecruitmentTemplates,
  type RecruitmentTemplate,
} from "@/lib/recruitment-templates-client";

/**
 * Header button on the schedule page that exposes the saved PT-募集
 * text templates. Three behaviors based on stored count:
 *   0 templates  → button opens the management dialog directly so
 *                  the user can add their first template.
 *   1 template   → click copies its body to clipboard immediately.
 *   2+ templates → dropdown menu lists each label; clicking copies
 *                  that template's body. A "..." footer item opens
 *                  the management dialog for editing.
 */

type Props = {
  initial: RecruitmentTemplate[];
};

export function RecruitmentTemplatesButton({ initial }: Props) {
  const templates = useRealtimeRecruitmentTemplates(initial);
  const [manageOpen, setManageOpen] = useState(false);

  const copyToClipboard = async (template: RecruitmentTemplate) => {
    try {
      await navigator.clipboard.writeText(template.body);
      toast.success(`「${template.label}」をコピーしました`);
    } catch (e) {
      console.warn("[recruitment-templates] clipboard error:", e);
      toast.error("コピー失敗（ブラウザの権限を確認してください）");
    }
  };

  // Zero templates: button opens management dialog directly.
  if (templates.length === 0) {
    return (
      <>
        <button
          type="button"
          onClick={() => setManageOpen(true)}
          aria-label="PT募集文テンプレートを設定"
          title="PT募集文テンプレートを設定"
          className="inline-flex h-8 items-center justify-center gap-1 rounded-md border border-border/60 px-2 font-mono text-[11px] tracking-widest text-muted-foreground uppercase transition-colors hover:border-[var(--neon-cyan)]/60 hover:text-foreground"
        >
          <ClipboardList className="h-3.5 w-3.5" aria-hidden />
          <span className="hidden sm:inline">募集文</span>
          <Plus className="h-3 w-3 opacity-70" aria-hidden />
        </button>
        <ManageDialog
          open={manageOpen}
          onOpenChange={setManageOpen}
          templates={templates}
        />
      </>
    );
  }

  // Single template: button copies on click.
  if (templates.length === 1) {
    const t = templates[0]!;
    return (
      <>
        <button
          type="button"
          onClick={() => copyToClipboard(t)}
          onContextMenu={(e) => {
            e.preventDefault();
            setManageOpen(true);
          }}
          aria-label={`「${t.label}」を募集文としてコピー`}
          title={`クリックでコピー / 右クリックで編集`}
          className="inline-flex h-8 items-center justify-center gap-1 rounded-md border border-[var(--neon-cyan)]/40 bg-[var(--neon-cyan)]/8 px-2 font-mono text-[11px] tracking-widest text-[var(--neon-cyan)] uppercase transition-colors hover:border-[var(--neon-cyan)]/60 hover:bg-[var(--neon-cyan)]/12"
        >
          <ClipboardCopy className="h-3.5 w-3.5" aria-hidden />
          <span className="hidden sm:inline">募集文</span>
        </button>
        <ManageDialog
          open={manageOpen}
          onOpenChange={setManageOpen}
          templates={templates}
        />
      </>
    );
  }

  // Multiple templates: dropdown to pick one.
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="PT募集文を選択してコピー"
          title="募集文を選択してコピー"
          className="inline-flex h-8 items-center justify-center gap-1 rounded-md border border-[var(--neon-cyan)]/40 bg-[var(--neon-cyan)]/8 px-2 font-mono text-[11px] tracking-widest text-[var(--neon-cyan)] uppercase transition-colors hover:border-[var(--neon-cyan)]/60 hover:bg-[var(--neon-cyan)]/12"
        >
          <ClipboardCopy className="h-3.5 w-3.5" aria-hidden />
          <span className="hidden sm:inline">募集文</span>
          <span className="font-mono text-[10px] tracking-widest tabular-nums">
            {templates.length}
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          sideOffset={4}
          className="glass-popup w-[max(16rem,min(calc(100vw-1rem),24rem))]"
        >
          <div className="px-1.5 pt-1 pb-1 font-mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase">
            Templates
          </div>
          {templates.map((t) => (
            <DropdownMenuItem
              key={t.id}
              onClick={() => copyToClipboard(t)}
              className="flex cursor-pointer items-start gap-2"
            >
              <ClipboardCopy className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--neon-cyan)]" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{t.label}</p>
                <p className="truncate text-[10px] text-muted-foreground/80">
                  {t.body.slice(0, 60)}
                  {t.body.length > 60 ? "…" : ""}
                </p>
              </div>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => setManageOpen(true)}
            className="flex cursor-pointer items-center gap-2 text-muted-foreground focus:text-foreground"
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden />
            <span className="text-sm">テンプレートを編集</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ManageDialog
        open={manageOpen}
        onOpenChange={setManageOpen}
        templates={templates}
      />
    </>
  );
}

// ---------- Management dialog ----------------------------------------------

function ManageDialog({
  open,
  onOpenChange,
  templates,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  templates: RecruitmentTemplate[];
}) {
  // Local "edit form" state — null when not editing, otherwise the
  // template currently being created/edited.
  const [editing, setEditing] = useState<{
    id?: string;
    label: string;
    body: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  const startNew = () => setEditing({ label: "", body: "" });
  const startEdit = (t: RecruitmentTemplate) =>
    setEditing({ id: t.id, label: t.label, body: t.body });
  const cancelEdit = () => setEditing(null);

  const onSave = async () => {
    if (!editing) return;
    const label = editing.label.trim();
    const body = editing.body.trim();
    if (!label) {
      toast.error("ラベルを入力してください");
      return;
    }
    if (!body) {
      toast.error("本文を入力してください");
      return;
    }
    setBusy(true);
    const result = editing.id
      ? await updateRecruitmentTemplate(editing.id, { label, body })
      : await createRecruitmentTemplate({ label, body });
    setBusy(false);
    if (!result.ok) {
      toast.error("保存失敗: " + result.reason);
      return;
    }
    toast.success(editing.id ? "更新しました" : "追加しました");
    setEditing(null);
  };

  const onDelete = async (t: RecruitmentTemplate) => {
    if (!window.confirm(`「${t.label}」を削除しますか？`)) return;
    const result = await deleteRecruitmentTemplate(t.id);
    if (!result.ok) {
      toast.error("削除失敗: " + result.reason);
      return;
    }
    toast.success("削除しました");
  };

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
              よく使う募集文を保存して、ワンクリックでコピーできます
            </DialogDescription>
          </div>
        </DialogHeader>

        <div className="flex max-h-[70svh] flex-col gap-4 overflow-y-auto p-5">
          {/* List of existing templates */}
          {templates.length === 0 ? (
            <p className="rounded-md border border-dashed border-border/40 px-4 py-6 text-center text-xs text-muted-foreground">
              テンプレート未登録 — 下の「+ 新規追加」から1つ目を作成
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {templates.map((t) => (
                <li
                  key={t.id}
                  className="rounded-md border border-border/40 bg-secondary/20"
                >
                  <div className="flex items-center justify-between gap-2 border-b border-border/30 px-3 py-2">
                    <span className="font-display text-sm">{t.label}</span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => startEdit(t)}
                        aria-label={`${t.label}を編集`}
                        title="編集"
                        className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDelete(t)}
                        aria-label={`${t.label}を削除`}
                        title="削除"
                        className="inline-flex h-7 w-7 items-center justify-center rounded text-rose-300 hover:bg-rose-500/15 hover:text-rose-200"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    </div>
                  </div>
                  <pre className="max-h-[8rem] overflow-y-auto px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-foreground/85">
                    {t.body}
                  </pre>
                </li>
              ))}
            </ul>
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
                <Label htmlFor="rt-label" className="text-xs text-foreground/80">
                  ラベル
                </Label>
                <Input
                  id="rt-label"
                  value={editing.label}
                  onChange={(e) =>
                    setEditing((cur) =>
                      cur ? { ...cur, label: e.target.value } : cur,
                    )
                  }
                  placeholder="例: 通常募集 / 補強募集"
                  spellCheck={false}
                  autoFocus
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="rt-body" className="text-xs text-foreground/80">
                  本文
                </Label>
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
                  placeholder="例: 22:00開始 黄金零式 1〜4層消化編成 / 待機所..."
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

