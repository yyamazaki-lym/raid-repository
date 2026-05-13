"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, ImagePlus, Loader2, Save } from "lucide-react";
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
import { createGphotoEntry } from "@/lib/category-links-client";

/**
 * Phase 16 (2026-05-13): 攻略タブの「Google フォト追加」ダイアログ。
 *
 * `image-form-dialog.tsx` を model に簡素化。
 *   - URL 1 本のみ (アップロードなし、メモなし、タイトル省略)
 *   - 入力 URL を server-side で classify → 共有なら scrape + 複数 INSERT、
 *     直リンクなら単独 INSERT
 *   - 結果に応じてトースト文言を分岐
 */
type Props = {
  categoryId: string;
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export function GphotoFormDialog({
  categoryId,
  trigger,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: Props) {
  const isControlled = controlledOpen !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const open = isControlled ? controlledOpen! : internalOpen;
  const setOpen = (next: boolean) => {
    if (isControlled) controlledOnOpenChange?.(next);
    else setInternalOpen(next);
  };

  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setUrl("");
      setError(null);
    }
  }, [open]);

  const onSubmit = async () => {
    setError(null);
    const u = url.trim();
    if (!u) {
      return setError("Google フォトの共有 URL または画像直リンクを入力してください");
    }
    if (!/^https?:\/\//i.test(u)) {
      return setError("URLは http:// または https:// で始めてください");
    }
    try {
      new URL(u);
    } catch {
      return setError("URL の形式が正しくありません");
    }

    setBusy(true);
    const result = await createGphotoEntry({ categoryId, rawUrl: u });
    setBusy(false);

    if (!result.ok) {
      setError(result.reason);
      return;
    }

    if (result.kind === "album") {
      const titleSuffix = result.title ? ` (${result.title})` : "";
      toast.success(`${result.imageCount} 枚展開しました${titleSuffix}`);
    } else {
      toast.success("画像を追加しました");
    }
    setOpen(false);
  };

  const defaultTrigger = (
    <DialogTrigger className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-background/30 px-3 py-1.5 font-mono text-[11px] tracking-[0.18em] text-muted-foreground uppercase transition-colors hover:border-[var(--neon-cyan)]/60 hover:text-foreground">
      <ImagePlus className="h-3.5 w-3.5" aria-hidden />
      Google フォト追加
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
            <ImagePlus className="h-4 w-4" aria-hidden />
          </span>
          <div className="flex flex-col gap-0.5">
            <DialogTitle className="font-display text-base tracking-[0.16em] uppercase">
              Add Google Photos
            </DialogTitle>
            <DialogDescription className="text-xs">
              共有アルバム URL → 全画像を自動展開 / 画像直リンク → 1 枚追加
            </DialogDescription>
          </div>
        </DialogHeader>

        <div className="flex flex-col gap-4 p-5">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="gphoto-url" className="text-xs text-foreground/80">
              URL
            </Label>
            <Input
              id="gphoto-url"
              type="url"
              inputMode="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://photos.app.goo.gl/... または https://lh3.googleusercontent.com/..."
              className="font-mono text-[12px]"
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
              autoFocus
            />
            <p className="text-muted-foreground text-[11px] leading-relaxed">
              共有アルバム URL を貼ると、含まれる全画像を自動で展開します。
              枚数が多いと取得に数秒〜十数秒かかることがあります。
            </p>
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
            className="font-mono text-[11px] tracking-[0.18em] uppercase"
          >
            キャンセル
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={onSubmit}
            disabled={busy}
            className="gap-1.5 font-mono text-[11px] tracking-[0.18em] uppercase"
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Save className="h-3.5 w-3.5" aria-hidden />
            )}
            {busy ? "取得中..." : "追加"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
