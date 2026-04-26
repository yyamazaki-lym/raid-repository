"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Settings,
  RotateCcw,
  Save,
  ExternalLink,
  Calendar,
} from "lucide-react";
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
  const [hasOverride, setHasOverride] = useState(false);
  const [busy, setBusy] = useState(false);

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

      {/*
        Override Base UI's default "fixed dead-center" positioning:
        - sm+: align to upper third of viewport (top-20) so it reads as a sheet
          sliding down rather than a small modal floating in mid-air.
        - mobile: keep mostly-centered but pull up a bit so virtual keyboards
          don't push it off-screen.
        Wider max-w (xl) so the URL input doesn't wrap awkwardly.
      */}
      <DialogContent
        className="glass top-[8svh] max-w-[calc(100%-1.5rem)] translate-y-0 gap-0 p-0 sm:top-20 sm:max-w-xl"
      >
        <DialogHeader className="flex-row items-start gap-3 border-b border-border/40 p-5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-[var(--neon-cyan)]/40 bg-background/40 text-[var(--neon-cyan)] shadow-[0_0_18px_-6px_var(--neon-cyan)]">
            <Settings className="h-4 w-4" aria-hidden />
          </span>
          <div className="flex flex-col gap-0.5">
            <DialogTitle className="font-display text-base tracking-[0.16em] uppercase">
              Settings
            </DialogTitle>
            <DialogDescription className="text-xs">
              このブラウザでのみ適用 · Phase 3 で Supabase へ移行予定
            </DialogDescription>
          </div>
        </DialogHeader>

        <div className="flex flex-col gap-5 p-5">
          {/* Section: Schedule source URL */}
          <section className="flex flex-col gap-3">
            <header className="flex items-center gap-2 border-b border-border/30 pb-2">
              <Calendar className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              <span className="font-mono text-[10px] tracking-[0.22em] text-muted-foreground uppercase">
                Schedule Source
              </span>
              <span
                className={
                  "ml-auto rounded-sm border px-1.5 py-px font-mono text-[9px] tracking-widest uppercase " +
                  (hasOverride
                    ? "border-[var(--neon-cyan)]/40 text-[var(--neon-cyan)]"
                    : "border-border text-muted-foreground")
                }
              >
                {hasOverride ? "上書き中" : "デフォルト"}
              </span>
            </header>

            <div className="flex flex-col gap-2">
              <Label
                htmlFor="schedule-url"
                className="text-xs text-foreground/80"
              >
                スケジュールページの URL
              </Label>
              <Input
                id="schedule-url"
                type="url"
                inputMode="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder={
                  defaultUrl ??
                  "https://character-sheets.appspot.com/schedule/list?key=..."
                }
                className="font-mono text-[12px]"
                spellCheck={false}
                autoComplete="off"
              />
              <p className="text-muted-foreground text-[11px] leading-relaxed">
                character-sheets.appspot.com の{" "}
                <code className="font-mono">schedule/list?key=…</code>{" "}
                形式を指定してください。
              </p>
              {defaultUrl && (
                <div className="flex items-start gap-1.5 overflow-hidden rounded-md border border-border/40 bg-secondary/20 px-2 py-1.5">
                  <ExternalLink
                    className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1 overflow-hidden">
                    <span className="font-mono text-[9px] tracking-widest text-muted-foreground uppercase">
                      Default
                    </span>
                    {/* URLs lack spaces, so use break-all to wrap on any char
                        instead of truncate (which pushed the dialog wider). */}
                    <p className="font-mono text-[10px] leading-relaxed break-all text-muted-foreground/90">
                      {defaultUrl}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>

        <DialogFooter className="-mx-0 -mb-0 mt-0 flex-row items-center justify-between gap-2 rounded-b-xl border-t border-border/40 bg-secondary/30 p-3 sm:justify-between">
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
