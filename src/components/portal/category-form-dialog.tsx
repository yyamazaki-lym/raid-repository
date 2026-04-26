"use client";

import { useState } from "react";
import { Plus, Save, AlertTriangle } from "lucide-react";
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
import { ALL_STATUSES, type CategoryStatus } from "@/lib/supabase/types";
import { createCategory } from "@/lib/categories-client";
import { cn } from "@/lib/utils";

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,40}[a-z0-9]?$/;

export function CategoryFormDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [status, setStatus] = useState<CategoryStatus>("未着手");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setName("");
    setSlug("");
    setStatus("未着手");
    setBusy(false);
    setError(null);
  };

  const onSubmit = async () => {
    setError(null);
    const trimmedName = name.trim();
    const trimmedSlug = slug.trim().toLowerCase();
    if (!trimmedName) {
      setError("名前を入力してください");
      return;
    }
    if (!trimmedSlug || !SLUG_RE.test(trimmedSlug)) {
      setError(
        "URL識別子は半角英数字とハイフン (a-z 0-9 -) で、3〜42文字で入力してください",
      );
      return;
    }

    setBusy(true);
    const result = await createCategory({
      slug: trimmedSlug,
      name: trimmedName,
      status,
    });
    setBusy(false);

    if (!result.ok) {
      setError(
        result.reason.includes("duplicate")
          ? "このURL識別子は既に使用されています"
          : `保存失敗: ${result.reason}`,
      );
      return;
    }

    toast.success(`「${result.category.name}」を追加しました`);
    setOpen(false);
    reset();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger
        className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-background/30 px-3 py-1.5 font-mono text-[11px] tracking-widest text-muted-foreground uppercase transition-colors hover:border-[var(--neon-cyan)]/60 hover:text-foreground"
      >
        <Plus className="h-3.5 w-3.5" aria-hidden />
        カテゴリー追加
      </DialogTrigger>

      <DialogContent
        className="glass top-[8svh] max-w-[calc(100%-1.5rem)] translate-y-0 gap-0 p-0 sm:top-20 sm:max-w-lg"
      >
        <DialogHeader className="flex-row items-start gap-3 border-b border-border/40 p-5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-[var(--neon-cyan)]/40 bg-background/40 text-[var(--neon-cyan)] shadow-[0_0_18px_-6px_var(--neon-cyan)]">
            <Plus className="h-4 w-4" aria-hidden />
          </span>
          <div className="flex flex-col gap-0.5">
            <DialogTitle className="font-display text-base tracking-[0.16em] uppercase">
              New Category
            </DialogTitle>
            <DialogDescription className="text-xs">
              新しいレイドコンテンツを追加します
            </DialogDescription>
          </div>
        </DialogHeader>

        <div className="flex flex-col gap-4 p-5">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="category-name" className="text-xs text-foreground/80">
              名前
            </Label>
            <Input
              id="category-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例: アルカディア:ライトヘビー級"
              autoFocus
              spellCheck={false}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="category-slug" className="text-xs text-foreground/80">
              URL識別子
            </Label>
            <Input
              id="category-slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="例: arc-lightheavy"
              className="font-mono text-[12px]"
              autoComplete="off"
              spellCheck={false}
            />
            <p className="text-muted-foreground text-[11px] leading-relaxed">
              URLパスに使われます — 半角英数字とハイフンのみ。
              例:{" "}
              <code className="font-mono">/category/arc-lightheavy/mitigation</code>
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-foreground/80">初期ステータス</Label>
            <div className="flex flex-wrap gap-1.5">
              {ALL_STATUSES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatus(s)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-sm border px-2 py-1 font-mono text-[10px] tracking-widest uppercase transition-colors",
                    status === s
                      ? "border-[var(--neon-cyan)]/60 bg-[var(--neon-cyan)]/10 text-foreground"
                      : "border-border bg-background/30 text-muted-foreground hover:border-border-foreground hover:text-foreground/80",
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive-foreground/90">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" aria-hidden />
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
            {busy ? "保存中..." : "追加"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
