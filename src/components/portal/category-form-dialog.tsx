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
import {
  ALL_STATUSES,
  type Category,
  type CategoryStatus,
} from "@/lib/supabase/types";
import {
  createCategory,
  updateCategory,
} from "@/lib/categories-client";
import { cn } from "@/lib/utils";

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,40}[a-z0-9]?$/;

type Props = {
  /** Existing category for edit mode; omit for create. */
  category?: Category;
  /** Custom trigger (e.g. menu item). Defaults to "+カテゴリー追加" button.
   *  Ignored in controlled mode. */
  trigger?: React.ReactNode;
  /** Controlled-mode open state. When provided, the dialog skips rendering
   *  its own trigger — useful for wiring open/close from outside (e.g. a
   *  dropdown menu item that needs to close the menu before the dialog
   *  opens, avoiding the focus collision that auto-closes the dialog). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export function CategoryFormDialog({
  category,
  trigger,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: Props) {
  const isEdit = !!category;
  const isControlled = controlledOpen !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const open = isControlled ? controlledOpen! : internalOpen;
  const setOpen = (next: boolean) => {
    if (isControlled) controlledOnOpenChange?.(next);
    else setInternalOpen(next);
  };
  const [name, setName] = useState(category?.name ?? "");
  const [slug, setSlug] = useState(category?.slug ?? "");
  const [status, setStatus] = useState<CategoryStatus>(
    category?.status ?? "未着手",
  );
  const [mitigationUrl, setMitigationUrl] = useState(
    category?.mitigationSheetUrl ?? "",
  );
  const [lootUrl, setLootUrl] = useState(category?.lootSheetUrl ?? "");
  const [discordStrategy, setDiscordStrategy] = useState(
    category?.discordStrategyChannelId ?? "",
  );
  const [discordVideo, setDiscordVideo] = useState(
    category?.discordVideoChannelId ?? "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(category?.name ?? "");
      setSlug(category?.slug ?? "");
      setStatus(category?.status ?? "未着手");
      setMitigationUrl(category?.mitigationSheetUrl ?? "");
      setLootUrl(category?.lootSheetUrl ?? "");
      setDiscordStrategy(category?.discordStrategyChannelId ?? "");
      setDiscordVideo(category?.discordVideoChannelId ?? "");
      setError(null);
    }
  }, [open, category]);

  const validateUrl = (raw: string): string | null => {
    if (!raw.trim()) return null;
    if (!/^https?:\/\//i.test(raw))
      return "http:// または https:// で始めてください";
    try {
      new URL(raw);
      return null;
    } catch {
      return "URLの形式が正しくありません";
    }
  };

  const onSubmit = async () => {
    setError(null);
    const trimmedName = name.trim();
    const trimmedSlug = slug.trim().toLowerCase();
    const trimmedMitigation = mitigationUrl.trim();
    const trimmedLoot = lootUrl.trim();
    const trimmedDiscordStrategy = discordStrategy.trim();
    const trimmedDiscordVideo = discordVideo.trim();

    if (!trimmedName) return setError("名前を入力してください");
    if (!trimmedSlug || !SLUG_RE.test(trimmedSlug)) {
      return setError(
        "URL識別子は半角英数字とハイフン (a-z 0-9 -) で、3〜42文字で入力してください",
      );
    }
    const mitigationErr = validateUrl(trimmedMitigation);
    if (mitigationErr) return setError("軽減表URL: " + mitigationErr);
    const lootErr = validateUrl(trimmedLoot);
    if (lootErr) return setError("ロット管理URL: " + lootErr);

    // Discord channel IDs are 17–20 digit snowflakes.
    const SNOWFLAKE_RE = /^\d{17,20}$/;
    if (trimmedDiscordStrategy && !SNOWFLAKE_RE.test(trimmedDiscordStrategy)) {
      return setError("攻略チャンネルIDは17〜20桁の数字です");
    }
    if (trimmedDiscordVideo && !SNOWFLAKE_RE.test(trimmedDiscordVideo)) {
      return setError("動画チャンネルIDは17〜20桁の数字です");
    }

    setBusy(true);
    const patch = {
      name: trimmedName,
      slug: trimmedSlug,
      status,
      mitigation_sheet_url: trimmedMitigation || null,
      loot_sheet_url: trimmedLoot || null,
      discord_strategy_channel_id: trimmedDiscordStrategy || null,
      discord_video_channel_id: trimmedDiscordVideo || null,
    };

    const result = isEdit
      ? await updateCategory(category!.id, patch)
      : await createCategory({
          slug: trimmedSlug,
          name: trimmedName,
          status,
        }).then(async (r) => {
          // After create, set the URLs in a follow-up update so the existing
          // create helper stays focused on the minimal required columns.
          if (!r.ok) return r;
          if (trimmedMitigation || trimmedLoot) {
            await updateCategory(r.category.id, {
              mitigation_sheet_url: trimmedMitigation || null,
              loot_sheet_url: trimmedLoot || null,
            });
          }
          return { ok: true } as const;
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

    toast.success(isEdit ? "更新しました" : `「${trimmedName}」を追加しました`);
    setOpen(false);
  };

  const defaultTrigger = (
    <DialogTrigger className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-background/30 px-3 py-1.5 font-mono text-[11px] tracking-widest text-muted-foreground uppercase transition-colors hover:border-[var(--neon-cyan)]/60 hover:text-foreground">
      <Plus className="h-3.5 w-3.5" aria-hidden />
      カテゴリー追加
    </DialogTrigger>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {/* Skip trigger render entirely in controlled mode — caller owns the
          state, presumably driven by a menu item or other affordance that
          doesn't need a Base UI Trigger wrapper. */}
      {!isControlled &&
        (trigger ? (
          <DialogTrigger render={trigger as React.ReactElement} />
        ) : (
          defaultTrigger
        ))}

      <DialogContent className="glass top-[8svh] max-w-[calc(100%-1.5rem)] translate-y-0 gap-0 p-0 sm:top-20 sm:max-w-xl">
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
              {isEdit ? "Edit" : "New"} Category
            </DialogTitle>
            <DialogDescription className="text-xs">
              {isEdit
                ? "カテゴリー情報・スプレッドシートURLを編集"
                : "新しいレイドコンテンツを追加します"}
            </DialogDescription>
          </div>
        </DialogHeader>

        <div className="flex max-h-[70svh] flex-col gap-4 overflow-y-auto p-5">
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
              disabled={isEdit}
            />
            <p className="text-muted-foreground text-[11px] leading-relaxed">
              URLパスに使われます — 半角英数字とハイフンのみ。
              {isEdit && "（編集不可）"}
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-foreground/80">ステータス</Label>
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
                      : "border-border bg-background/30 text-muted-foreground hover:text-foreground/80",
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5 border-t border-border/30 pt-4">
            <Label htmlFor="mitigation-url" className="text-xs text-foreground/80">
              軽減表URL（任意）
            </Label>
            <Input
              id="mitigation-url"
              type="url"
              inputMode="url"
              value={mitigationUrl}
              onChange={(e) => setMitigationUrl(e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/.../pubhtml"
              className="font-mono text-[12px]"
              autoComplete="off"
              spellCheck={false}
            />
            <p className="text-muted-foreground text-[11px] leading-relaxed">
              軽減表サブタブで iframe 埋め込み表示されます。
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="loot-url" className="text-xs text-foreground/80">
              ロット管理URL（任意）
            </Label>
            <Input
              id="loot-url"
              type="url"
              inputMode="url"
              value={lootUrl}
              onChange={(e) => setLootUrl(e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/.../pubhtml"
              className="font-mono text-[12px]"
              autoComplete="off"
              spellCheck={false}
            />
            <p className="text-muted-foreground text-[11px] leading-relaxed">
              ロット管理サブタブで iframe 埋め込み表示されます。
            </p>
          </div>

          <div className="flex flex-col gap-1.5 border-t border-border/30 pt-4">
            <Label
              htmlFor="discord-strategy"
              className="text-xs text-foreground/80"
            >
              Discord 攻略チャンネルID（任意）
            </Label>
            <Input
              id="discord-strategy"
              inputMode="numeric"
              value={discordStrategy}
              onChange={(e) => setDiscordStrategy(e.target.value)}
              placeholder="例: 1234567890123456789"
              className="font-mono text-[12px]"
              autoComplete="off"
              spellCheck={false}
            />
            <p className="text-muted-foreground text-[11px] leading-relaxed">
              設定すると、毎日1回このチャンネルから URL を自動で攻略情報タブに取り込みます。
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label
              htmlFor="discord-video"
              className="text-xs text-foreground/80"
            >
              Discord 動画チャンネルID（任意）
            </Label>
            <Input
              id="discord-video"
              inputMode="numeric"
              value={discordVideo}
              onChange={(e) => setDiscordVideo(e.target.value)}
              placeholder="例: 1234567890123456789"
              className="font-mono text-[12px]"
              autoComplete="off"
              spellCheck={false}
            />
            <p className="text-muted-foreground text-[11px] leading-relaxed">
              設定すると、毎日1回このチャンネルから URL を自動で動画タブに取り込みます。
              Discord の開発者モードを ON にして、チャンネル名右クリック → IDコピーで取得できます。
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
