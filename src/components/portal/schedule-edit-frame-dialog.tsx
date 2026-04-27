"use client";

import { ExternalLink } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { safeHref } from "@/lib/url-safe";

/**
 * In-portal iframe dialog for character-sheets edit URLs.
 *
 * 1.9.13: replace the previous `<a target="_blank">` pattern. Tapping a
 * username / attendance cell on the schedule now opens this overlay
 * instead of a new tab, so the user stays inside the portal and their
 * scroll / focus context is preserved when they close it. Mobile gets
 * a near-fullscreen panel; desktop shows a centered card. Some hosts
 * may block iframe embedding via X-Frame-Options or CSP — for those
 * cases a "新しいタブで開く" fallback button stays visible at the top
 * of the dialog.
 */
export function ScheduleEditFrameDialog({
  url,
  title,
  onClose,
}: {
  /** Editing URL. `null` = closed. */
  url: string | null;
  /** Title shown in the header (e.g. "ユーザー名 の出欠を編集"). */
  title: string;
  /** Called when the user closes the dialog. */
  onClose: () => void;
}) {
  const safeUrl = safeHref(url);

  return (
    <Dialog
      open={url !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        // Override the base dialog's narrow `sm:max-w-sm` — the
        // character-sheets edit form needs real estate. Width fills
        // the viewport on mobile and caps at 5xl on desktop. Height
        // tracks the dynamic viewport so the frame is usable on
        // both portrait phones and tall monitors.
        className="flex h-[92svh] w-[calc(100%-1rem)] max-w-[calc(100%-1rem)] flex-col gap-2 p-3 sm:h-[88svh] sm:max-w-5xl sm:p-4"
      >
        <DialogHeader className="flex flex-row items-center justify-between gap-2 pr-8">
          <div className="flex flex-col gap-0.5">
            <DialogTitle className="text-sm">{title}</DialogTitle>
            <DialogDescription className="text-[11px]">
              編集後はそのままダイアログを閉じればスケジュールに戻れます
            </DialogDescription>
          </div>
          {safeUrl && (
            <a
              href={safeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border/60 bg-background/40 px-2.5 py-1.5 font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase transition-colors hover:border-[var(--neon-cyan)]/60 hover:text-foreground"
              title="埋め込みが表示されない場合は新しいタブで開いてください"
            >
              <ExternalLink className="h-3 w-3" aria-hidden />
              新しいタブ
            </a>
          )}
        </DialogHeader>
        {safeUrl ? (
          <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg border border-border/40 bg-white">
            <iframe
              key={safeUrl}
              src={safeUrl}
              title={title}
              // Sandbox parity with sheet-iframe.tsx — allow scripts so
              // character-sheets can submit, allow same-origin so its
              // own auth cookies work, allow popups for any redirect.
              sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-top-navigation-by-user-activation"
              referrerPolicy="no-referrer-when-downgrade"
              className="absolute inset-0 h-full w-full border-0"
            />
          </div>
        ) : (
          <div className="grid flex-1 place-items-center text-xs text-muted-foreground">
            URL が設定されていません
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
