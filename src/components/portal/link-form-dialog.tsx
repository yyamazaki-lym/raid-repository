"use client";

import { useEffect, useState } from "react";
import { Plus, Save, AlertTriangle, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  createCategoryLink,
  updateCategoryLink,
} from "@/lib/category-links-client";
import type {
  CategoryLink,
  CategoryLinkKind,
} from "@/lib/supabase/types";

type Props = {
  categoryId: string;
  kind: CategoryLinkKind;
  /** Provide an existing link to edit; omit for create mode. */
  link?: CategoryLink;
  /** Custom trigger element (e.g. menu item). Defaults to a primary "追加" button. */
  trigger?: React.ReactNode;
  /** Controlled-mode open state — see CategoryFormDialog for rationale. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

const KIND_LABEL: Record<CategoryLinkKind, string> = {
  strategy: "攻略リンク",
  video: "動画",
};

export function LinkFormDialog({
  categoryId,
  kind,
  link,
  trigger,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: Props) {
  const isEdit = !!link;
  const isControlled = controlledOpen !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const open = isControlled ? controlledOpen! : internalOpen;
  const setOpen = (next: boolean) => {
    if (isControlled) controlledOnOpenChange?.(next);
    else setInternalOpen(next);
  };
  const [title, setTitle] = useState(link?.title ?? "");
  const [url, setUrl] = useState(link?.url ?? "");
  const [description, setDescription] = useState(link?.description ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form when opening (handles consecutive opens with stale state).
  useEffect(() => {
    if (open) {
      setTitle(link?.title ?? "");
      setUrl(link?.url ?? "");
      setDescription(link?.description ?? "");
      setError(null);
    }
  }, [open, link]);

  const onSubmit = async () => {
    setError(null);
    const t = title.trim();
    const u = url.trim();
    if (!t) return setError("タイトルを入力してください");
    if (!/^https?:\/\//i.test(u))
      return setError("URLは http:// または https:// で始めてください");
    try {
      new URL(u);
    } catch {
      return setError("URLの形式が正しくありません");
    }

    setBusy(true);
    const desc = description.trim() ? description.trim() : null;
    const result = isEdit
      ? await updateCategoryLink(link!.id, { title: t, url: u, description: desc })
      : await createCategoryLink({
          categoryId,
          kind,
          title: t,
          url: u,
          description: desc ?? undefined,
        });
    setBusy(false);

    if (!result.ok) {
      setError(`保存失敗: ${result.reason}`);
      return;
    }

    toast.success(
      isEdit ? "更新しました" : `${KIND_LABEL[kind]}を追加しました`,
    );
    setOpen(false);
  };

  const defaultTrigger = (
    <DialogTrigger className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-background/30 px-3 py-1.5 font-mono text-[11px] tracking-widest text-muted-foreground uppercase transition-colors hover:border-[var(--neon-cyan)]/60 hover:text-foreground">
      <Plus className="h-3.5 w-3.5" aria-hidden />
      {KIND_LABEL[kind]}追加
    </DialogTrigger>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!isControlled &&
        (trigger ? (
          <DialogTrigger render={trigger as React.ReactElement} />
        ) : (
          defaultTrigger
        ))}

      <DialogContent className="glass top-[8svh] max-w-[calc(100%-1.5rem)] translate-y-0 gap-0 p-0 sm:top-20 sm:max-w-lg">
        <DialogHeader className="flex-row items-start gap-3 border-b border-border/40 p-5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-[var(--neon-cyan)]/40 bg-background/40 text-[var(--neon-cyan)] shadow-[0_0_18px_-6px_var(--neon-cyan)]">
            {isEdit ? (
              <Pencil className="h-4 w-4" aria-hidden />
            ) : (
              <Plus className="h-4 w-4" aria-hidden />
            )}
          </span>
          <div className="flex flex-col gap-0.5">
            <DialogTitle className="font-display text-base tracking-[0.16em] uppercase">
              {isEdit ? "Edit" : "Add"} {kind === "video" ? "Video" : "Link"}
            </DialogTitle>
            <DialogDescription className="text-xs">
              {kind === "video"
                ? "動画URL（YouTube可・他サイトはリンクとして表示）"
                : "ウェブサイト・記事・wiki などのリンク"}
            </DialogDescription>
          </div>
        </DialogHeader>

        <div className="flex flex-col gap-4 p-5">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="link-title" className="text-xs text-foreground/80">
              タイトル
            </Label>
            <Input
              id="link-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={
                kind === "video"
                  ? "例: P1 黒魔目線 (固定〇〇)"
                  : "例: 攻略記事 by ○○"
              }
              autoFocus
              spellCheck={false}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="link-url" className="text-xs text-foreground/80">
              URL
            </Label>
            <Input
              id="link-url"
              type="url"
              inputMode="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={
                kind === "video"
                  ? "https://www.youtube.com/watch?v=..."
                  : "https://..."
              }
              className="font-mono text-[12px]"
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label
              htmlFor="link-desc"
              className="text-xs text-foreground/80"
            >
              メモ（任意）
            </Label>
            <Textarea
              id="link-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={
                kind === "video"
                  ? "例: 開幕〜P2途中まで / ○○分頃の散開図あり"
                  : "例: P3 散開法の図解あり"
              }
              rows={3}
              className="text-[13px] leading-relaxed"
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive-foreground/90">
              <AlertTriangle
                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive"
                aria-hidden
              />
              <span>{error}</span>
            </div>
          )}
        </div>

        <DialogFooter className="-mx-0 -mb-0 mt-0 flex-row items-center justify-end gap-2 rounded-b-xl border-t border-border/40 bg-secondary/30 p-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setOpen(false)}
            disabled={busy}
            className="font-mono text-[11px] tracking-widest uppercase"
          >
            キャンセル
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={onSubmit}
            disabled={busy}
            className="gap-1.5 font-mono text-[11px] tracking-widest uppercase"
          >
            <Save className="h-3.5 w-3.5" aria-hidden />
            {busy ? "保存中..." : isEdit ? "更新" : "追加"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
