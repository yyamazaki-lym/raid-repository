"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Settings, RotateCcw, Save, ExternalLink } from "lucide-react";
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
import { toast } from "sonner";
import {
  clearScheduleUrlOverride,
  getScheduleUrlOverride,
  setScheduleUrlOverride,
} from "@/lib/schedule-url-store";

type Props = {
  /** Build-time default from `NEXT_PUBLIC_SCHEDULE_URL`. Shown as placeholder. */
  defaultUrl: string | null;
};

export function SettingsDialog({ defaultUrl }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  /** Remembers whether the override was set when the dialog opened, so the
   *  "現在: 上書き中 / デフォルト" badge stays accurate while editing. */
  const [hasOverride, setHasOverride] = useState(false);
  const [busy, setBusy] = useState(false);

  // Load override fresh every time the dialog opens (in case another tab
  // changed it).
  useEffect(() => {
    if (!open) return;
    const current = getScheduleUrlOverride();
    setUrl(current ?? "");
    setHasOverride(current !== null);
  }, [open]);

  const onSave = () => {
    setBusy(true);
    const result = setScheduleUrlOverride(url);
    setBusy(false);
    if (!result.ok) {
      toast.error(result.reason ?? "保存に失敗しました");
      return;
    }
    toast.success("スケジュールURLを保存しました");
    setHasOverride(true);
    setOpen(false);
    // Trigger a full server re-render so the new URL is fetched immediately.
    router.refresh();
  };

  const onReset = () => {
    clearScheduleUrlOverride();
    setUrl("");
    setHasOverride(false);
    toast.success("デフォルトに戻しました");
    router.refresh();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        className="flex h-8 w-8 items-center justify-center rounded-md border border-border/40 bg-background/30 text-muted-foreground transition-colors hover:border-[var(--neon-cyan)]/40 hover:text-foreground"
        aria-label="設定"
      >
        <Settings className="h-3.5 w-3.5" aria-hidden />
      </DialogTrigger>

      <DialogContent className="glass max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display tracking-wider">設定</DialogTitle>
          <DialogDescription className="text-xs">
            このブラウザでのみ適用されます。Phase 3 で Supabase に移行予定。
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label
                htmlFor="schedule-url"
                className="font-mono text-[11px] tracking-[0.18em] text-muted-foreground uppercase"
              >
                スケジュールURL
              </Label>
              <span
                className={
                  "rounded-sm border px-1.5 py-px font-mono text-[9px] tracking-widest uppercase " +
                  (hasOverride
                    ? "border-[var(--neon-cyan)]/40 text-[var(--neon-cyan)]"
                    : "border-border text-muted-foreground")
                }
              >
                {hasOverride ? "上書き中" : "デフォルト使用中"}
              </span>
            </div>
            <Input
              id="schedule-url"
              type="url"
              inputMode="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={defaultUrl ?? "https://character-sheets.appspot.com/schedule/list?key=..."}
              className="font-mono text-[12px]"
              spellCheck={false}
              autoComplete="off"
            />
            <p className="text-muted-foreground text-[11px] leading-relaxed">
              character-sheets.appspot.com の <strong>schedule/list?key=…</strong>{" "}
              形式のURLを指定してください。空のまま保存すると保存エラーになります（クリアは下のリセットを使用）。
            </p>
            {defaultUrl && (
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/80">
                <ExternalLink className="h-3 w-3" aria-hidden />
                <span className="truncate">
                  default:{" "}
                  <code className="font-mono">{defaultUrl}</code>
                </span>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="flex-row items-center justify-between gap-2 sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onReset}
            disabled={!hasOverride}
            className="gap-1.5 font-mono text-[11px] tracking-widest uppercase"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            デフォルトに戻す
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={onSave}
            disabled={busy}
            className="gap-1.5 font-mono text-[11px] tracking-widest uppercase"
          >
            <Save className="h-3.5 w-3.5" aria-hidden />
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
