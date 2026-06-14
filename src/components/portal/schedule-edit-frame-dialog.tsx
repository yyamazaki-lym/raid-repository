"use client";

import { useRouter } from "next/navigation";
import { ExternalLink } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { invalidateScheduleCache } from "@/lib/server/schedule-cache-actions";
import { safeHref } from "@/lib/url-safe";

/**
 * In-portal iframe dialog for character-sheets edit URLs.
 *
 * 1.9.13: replace the previous `<a target="_blank">` pattern. Tapping a
 * username / attendance cell on the schedule now opens this overlay
 * instead of a new tab, so the user stays inside the portal and their
 * scroll / focus context is preserved when they close it.
 *
 * 2.1 (TODO #44): switch initial scroll positioning entirely to URL
 * fragment anchors — `#row_N` for per-date jumps and `#comment` as the
 * default landing zone. character-sheets natively honors hash anchors
 * (実証済 2.1 part7), so the previous translateY clipping heuristic and
 * its `top` / `mid` / `target` mode toggle are no longer needed.
 *
 * - `targetRowIndex` provided  → URL hash = `#row_N` (exact row jump)
 * - `targetRowIndex` null/none → URL hash = `#comment` (default mid view)
 */
export function ScheduleEditFrameDialog({
  url,
  title,
  targetRowIndex,
  onClose,
}: {
  /** Editing URL. `null` = closed. */
  url: string | null;
  /** Title shown in the header (e.g. "ユーザー名 の出欠を編集"). */
  title: string;
  /**
   * 0-based N of the target `<tr id="row_N">` on character-sheets.
   *
   * - `>= 0` → URL gets `#row_N`, exact row anchor
   * - `< 0`  → URL gets `#stickyhead` (= `<thead id="stickyhead">` の固定
   *   header 自体に anchor)。確定セルで `rowIndex - 1` 補正したとき最古行
   *   (rowIndex=0) で負になるため、固定 header の直下に row_0 を見せたい
   *   ケースの sentinel。pre-table の凡例 / 運用ルール / コメントは画面外
   *   上にスクロールされ、画面最上端 = 固定 header → 直下に row_0 という
   *   他の `#row_(N-1)` 着地と整合する見た目になる
   * - `null`/omitted → `#comment` fallback (default mid view: legend +
   *   table rows + footer register button visible at once)
   */
  targetRowIndex?: number | null;
  /** Called when the user closes the dialog. */
  onClose: () => void;
}) {
  const router = useRouter();
  const safeUrl = safeHref(url);

  /**
   * dialog 閉じた時に Vercel Data Cache の `schedule` tag を invalidate
   * し、router.refresh で RSC を再 fetch (cache miss → fresh HTML 取得)。
   * 編集が反映されない症状 (TODO #55 cache 戦略) を防ぐ。
   */
  const handleClose = () => {
    void invalidateScheduleCache().then(() => router.refresh());
    onClose();
  };
  // Append the appropriate hash anchor. character-sheets honors
  // browser-native fragment scrolling — no cross-origin scripting
  // required. `#row_N` for per-date jumps, `#comment` otherwise.
  const srcUrl = !safeUrl
    ? null
    : (() => {
        try {
          const u = new URL(safeUrl);
          u.hash =
            typeof targetRowIndex === "number"
              ? targetRowIndex < 0
                ? "#stickyhead" // 最古行 sentinel: 固定 header 直下に row_0 を表示
                : `#row_${targetRowIndex}`
              : "#comment";
          return u.toString();
        } catch {
          return safeUrl;
        }
      })();

  return (
    <Dialog
      open={url !== null}
      onOpenChange={(open) => {
        if (!open) handleClose();
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
            {safeUrl && (
              <a
                href={safeUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-background/40 px-2.5 py-1.5 text-[10px] tracking-normal text-muted-foreground transition-colors hover:border-[var(--neon-cyan)]/60 hover:text-foreground"
                title="埋め込みが表示されない場合は新しいタブで開いてください"
              >
                <ExternalLink className="h-3 w-3" aria-hidden />
                新しいタブ
              </a>
            )}
          </div>
        </DialogHeader>
        {safeUrl ? (
          <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg border border-border/40 bg-white">
            <iframe
              key={srcUrl ?? safeUrl}
              src={srcUrl ?? safeUrl}
              title={title}
              sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-top-navigation-by-user-activation allow-modals"
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
