"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import {
  AlertTriangle,
  ImagePlus,
  Loader2,
  Pencil,
  Save,
  Upload,
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
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  createCategoryLink,
  updateCategoryLink,
} from "@/lib/category-links-client";
import { createClient } from "@/lib/supabase/client";
import type { CategoryLink } from "@/lib/supabase/types";

/**
 * Phase 15 (2.x, 2026-05-13): 攻略タブの「画像」エントリ追加/編集ダイアログ。
 *
 * `link-form-dialog.tsx` を model にしつつ、画像専用の UX:
 *   - 画像 URL を直接貼る経路と、ローカル画像を Supabase Storage
 *     (`category-strategy-images` バケット) にアップロードする経路の両対応。
 *   - タイトル / メモは任意。タイトル未記入は `"画像"` をデフォルト保存
 *     (DB の `title NOT NULL` を満たす)。
 *   - URL バリデーションは createCategoryLinkAction 側の isSafeUrl で再度
 *     行われるので、ここでは UX のための前段チェック (http(s) prefix) のみ。
 */
type Props = {
  categoryId: string;
  /** Provide an existing link to edit; omit for create mode. */
  link?: CategoryLink;
  /** Custom trigger element. Defaults to a primary "画像追加" button. */
  trigger?: React.ReactNode;
  /** Controlled-mode open state — list 側で編集対象 link を保持する経路。 */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

const DEFAULT_TITLE = "画像";

export function ImageFormDialog({
  categoryId,
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
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // 連続オープン時に前回値が残るのを避けて open 毎に form を初期化。
  useEffect(() => {
    if (open) {
      setTitle(link?.title ?? "");
      setUrl(link?.url ?? "");
      setDescription(link?.description ?? "");
      setError(null);
    }
  }, [open, link]);

  const onPickFile = () => fileInputRef.current?.click();

  // category-form-dialog.tsx の onBackgroundFileChange を踏襲。バケットと
  // path 規則だけ画像エントリ用に差し替え (`<categoryId>/<ts>-<rand>.<ext>`)。
  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setError("画像ファイルを選択してください");
      return;
    }
    const MAX_BYTES = 5 * 1024 * 1024;
    if (file.size > MAX_BYTES) {
      setError("画像サイズは 5MB 以内にしてください");
      return;
    }

    setError(null);
    setUploading(true);
    try {
      const supabase = createClient();
      const ext =
        (file.name.split(".").pop() || "bin")
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "")
          .slice(0, 8) || "bin";
      const path = `${categoryId}/${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("category-strategy-images")
        .upload(path, file, {
          cacheControl: "3600",
          upsert: false,
          contentType: file.type,
        });
      if (upErr) {
        setError(`アップロード失敗: ${upErr.message}`);
        return;
      }
      const { data } = supabase.storage
        .from("category-strategy-images")
        .getPublicUrl(path);
      setUrl(data.publicUrl);
      toast.success("画像をアップロードしました");
    } finally {
      setUploading(false);
    }
  };

  const onSubmit = async () => {
    setError(null);
    const u = url.trim();
    if (!u) return setError("画像 URL を入力するか、画像をアップロードしてください");
    if (!/^https?:\/\//i.test(u))
      return setError("URLは http:// または https:// で始めてください");
    try {
      new URL(u);
    } catch {
      return setError("URL の形式が正しくありません");
    }

    const t = title.trim() || DEFAULT_TITLE;
    const desc = description.trim() ? description.trim() : null;

    setBusy(true);
    const result = isEdit
      ? await updateCategoryLink(link!.id, {
          title: t,
          url: u,
          description: desc,
        })
      : await createCategoryLink({
          categoryId,
          kind: "image",
          title: t,
          url: u,
          description: desc ?? undefined,
        });
    setBusy(false);

    if (!result.ok) {
      setError(`保存失敗: ${result.reason}`);
      return;
    }

    toast.success(isEdit ? "更新しました" : "画像を追加しました");
    setOpen(false);
  };

  const defaultTrigger = (
    <DialogTrigger className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-background/30 px-3 py-1.5 font-mono text-[11px] tracking-[0.18em] text-muted-foreground uppercase transition-colors hover:border-[var(--neon-cyan)]/60 hover:text-foreground">
      <ImagePlus className="h-3.5 w-3.5" aria-hidden />
      画像追加
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
              <ImagePlus className="h-4 w-4" aria-hidden />
            )}
          </span>
          <div className="flex flex-col gap-0.5">
            <DialogTitle className="font-display text-base tracking-[0.16em] uppercase">
              {isEdit ? "Edit" : "Add"} Image
            </DialogTitle>
            <DialogDescription className="text-xs">
              スクリーンショットや散開図などの画像
              （ローカルアップロード または URL 直接指定）
            </DialogDescription>
          </div>
        </DialogHeader>

        <div className="flex flex-col gap-4 p-5">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="image-url" className="text-xs text-foreground/80">
              画像 URL
            </Label>
            <div className="flex gap-1.5">
              <Input
                id="image-url"
                type="url"
                inputMode="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://... または下のアップロードボタンから"
                className="font-mono text-[12px]"
                autoComplete="off"
                spellCheck={false}
                disabled={uploading}
                autoFocus
              />
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={onFileChange}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onPickFile}
                disabled={uploading || busy}
                className="shrink-0 gap-1.5 font-mono text-[10px] tracking-[0.18em] uppercase"
              >
                {uploading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <Upload className="h-3.5 w-3.5" aria-hidden />
                )}
                {uploading ? "送信中" : "アップロード"}
              </Button>
            </div>
            <p className="text-muted-foreground text-[11px] leading-relaxed">
              ローカル画像 (最大 5MB / PNG·JPG·WebP·GIF) をアップロードするか、
              既にどこかにある画像 URL を貼り付けてください。
            </p>
            {url.trim() && /^https?:\/\//i.test(url.trim()) && (
              <div
                aria-hidden
                className="relative mt-1 h-32 w-full overflow-hidden rounded-md border border-border/40 bg-secondary/30"
              >
                <Image
                  src={url.trim()}
                  alt=""
                  fill
                  sizes="(min-width: 640px) 32rem, 100vw"
                  className="object-contain object-center"
                  unoptimized
                />
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="image-title" className="text-xs text-foreground/80">
              タイトル（任意）
            </Label>
            <Input
              id="image-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={`例: P3 散開図 / 未記入の場合は「${DEFAULT_TITLE}」`}
              spellCheck={false}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="image-desc" className="text-xs text-foreground/80">
              メモ（任意）
            </Label>
            <Textarea
              id="image-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="例: 散開位置の解説 / 出典元など"
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
            className="font-mono text-[11px] tracking-[0.18em] uppercase"
          >
            キャンセル
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={onSubmit}
            disabled={busy || uploading}
            className="gap-1.5 font-mono text-[11px] tracking-[0.18em] uppercase"
          >
            <Save className="h-3.5 w-3.5" aria-hidden />
            {busy ? "保存中..." : isEdit ? "更新" : "追加"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
