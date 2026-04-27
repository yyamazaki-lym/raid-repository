"use client";

import { useState } from "react";
import { ChevronsDown, ChevronsUp, ExternalLink } from "lucide-react";
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
 * scroll / focus context is preserved when they close it.
 *
 * 1.9.15: cross-origin iframes don't let us scroll programmatically and
 * URL hash hints aren't honored by character-sheets, so we instead
 * apply a CSS `translateY(-N)` to the iframe with a matching extra
 * height. Effect: the iframe page renders normally but its TOP rows
 * are clipped, putting a chosen offset (e.g. ~280px in) at the visual
 * top of the dialog. Toggle button switches between top / mid offsets
 * so the user can flip back if they want to see the page header.
 */
const SCROLL_OFFSETS = {
  top: 0,
  // Heuristic: character-sheets renders a fixed nav + a title block in
  // the first ~280px. Skipping that lands the user near the calendar.
  // Adjust if the upstream layout changes.
  mid: 280,
} as const;

type OffsetMode = keyof typeof SCROLL_OFFSETS;

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
  // Default to mid so the user lands closer to the calendar input area.
  // They can flip back to top to see the page header / title.
  const [offsetMode, setOffsetMode] = useState<OffsetMode>("mid");
  const offsetPx = SCROLL_OFFSETS[offsetMode];

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
          <div className="flex shrink-0 items-center gap-1.5">
            {/* 表示位置トグル: 「ヘッダーを見たい」「中央 (デフォルト)」 */}
            {safeUrl && (
              <button
                type="button"
                onClick={() =>
                  setOffsetMode((m) => (m === "top" ? "mid" : "top"))
                }
                title={
                  offsetMode === "top"
                    ? "中央位置にジャンプ (ヘッダーを隠す)"
                    : "ヘッダーを表示 (上端から)"
                }
                className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-background/40 px-2 py-1.5 font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase transition-colors hover:border-[var(--neon-cyan)]/60 hover:text-foreground"
              >
                {offsetMode === "top" ? (
                  <ChevronsDown className="h-3 w-3" aria-hidden />
                ) : (
                  <ChevronsUp className="h-3 w-3" aria-hidden />
                )}
                {offsetMode === "top" ? "中央" : "上"}
              </button>
            )}
            {safeUrl && (
              <a
                href={safeUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-background/40 px-2.5 py-1.5 font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase transition-colors hover:border-[var(--neon-cyan)]/60 hover:text-foreground"
                title="埋め込みが表示されない場合は新しいタブで開いてください"
              >
                <ExternalLink className="h-3 w-3" aria-hidden />
                新しいタブ
              </a>
            )}
          </div>
        </DialogHeader>
        {safeUrl ? (
          // Wrapper hides overflow; iframe has extra height + negative
          // margin so its top portion is clipped, putting the chosen
          // offset at the visual top of the dialog. CSS-only — no
          // cross-origin script needed (which wouldn't work anyway).
          <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg border border-border/40 bg-white">
            <iframe
              key={safeUrl}
              src={safeUrl}
              title={title}
              sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-top-navigation-by-user-activation"
              referrerPolicy="no-referrer-when-downgrade"
              className="absolute left-0 w-full border-0 transition-[top,height] duration-200"
              style={{
                top: `-${offsetPx}px`,
                height: `calc(100% + ${offsetPx}px)`,
              }}
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
