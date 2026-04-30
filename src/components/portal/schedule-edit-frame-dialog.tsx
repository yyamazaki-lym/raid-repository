"use client";

import { useRef, useState } from "react";
import { CalendarPlus, ChevronsDown, ChevronsUp, ExternalLink } from "lucide-react";
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
 *
 * 2.1+ (TODO #44): also accept a per-session offset so that tapping a
 * specific date row jumps the iframe roughly to that date's input row.
 * cross-origin iframe scripting and hash anchors aren't honored by
 * character-sheets, so we extend the same translateY clipping with a
 * heuristic `BASE + index * ROW_HEIGHT` offset.
 */
const SCROLL_OFFSETS = {
  top: 0,
  // Heuristic: character-sheets renders a fixed nav + a title block in
  // the first ~280px. Skipping that lands the user near the calendar.
  // Adjust if the upstream layout changes.
  mid: 280,
  // 2.1 (2026-04-30 part4, TODO #53 フォロー): character-sheets の
  // input ページ (ユーザー列の編集) は最下部に「日程登録 / 削除」ボタン
  // 群があり、ユーザーがそこへ到達するために iframe 内を毎回大きく
  // スクロールしていた。クロスオリジンで scriptable には制御できない
  // が、translateY clipping を大きく取れば下端を一気に視野に入れられる。
  // 2400 はユーザー列ページの実測高 (~1900-2300px、固定行数で大きく
  // 変動しない) を上回る値。短いページの場合は単に余白が増えるだけ。
  bottom: 2400,
} as const;

type OffsetMode = keyof typeof SCROLL_OFFSETS | "target";

export function ScheduleEditFrameDialog({
  url,
  title,
  targetOffsetPx,
  onClose,
}: {
  /** Editing URL. `null` = closed. */
  url: string | null;
  /** Title shown in the header (e.g. "ユーザー名 の出欠を編集"). */
  title: string;
  /**
   * TODO #44: heuristic clipping offset to roughly land on a specific
   * date row in the character-sheets input page. When set, the dialog
   * defaults to the "target" mode using this value; the user can still
   * flip to top / mid to see the header or recenter. `null` (the
   * default) preserves pre-2.1 behavior — open at "mid" with no
   * per-date hint.
   */
  targetOffsetPx?: number | null;
  /** Called when the user closes the dialog. */
  onClose: () => void;
}) {
  const safeUrl = safeHref(url);
  // Default to "target" if a per-date offset was passed; otherwise
  // fall back to the legacy "mid" so unrelated open paths (e.g.
  // tapping a username header) keep their old landing position.
  const initialMode: OffsetMode =
    typeof targetOffsetPx === "number" ? "target" : "mid";
  const [offsetMode, setOffsetMode] = useState<OffsetMode>(initialMode);
  // 2.1 (2026-04-30 part4): 「⬇ 登録」ボタンで bottom にジャンプした
  // 後、もう一度押したときに元のモードへ戻すための保存先 (toggle 動作)。
  // 通常モード切替トグルとは独立に「下端 ↔ 直前の表示位置」を 1 押しで
  // 行き来させる。
  const beforeBottomModeRef = useRef<OffsetMode | null>(null);
  // Each open of a new URL resets the mode (otherwise the previous
  // session's offset would stick when the user opens a different cell
  // without closing the dialog).
  const lastUrlRef = useRef<string | null>(null);
  if (lastUrlRef.current !== url) {
    lastUrlRef.current = url;
    if (url !== null) {
      beforeBottomModeRef.current = null;
      if (offsetMode !== initialMode) {
        // setState in render is fine here — it's a derived reset on
        // identity change of the URL prop and avoids an extra effect.
        setOffsetMode(initialMode);
      }
    }
  }
  const offsetPx =
    offsetMode === "target"
      ? Math.max(0, targetOffsetPx ?? 0)
      : SCROLL_OFFSETS[offsetMode];

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
            {/* 「⬇ 登録」専用ボタン (2.1, 2026-04-30 part4, TODO #53 フォロー):
                character-sheets input ページ最下部の「日程登録 / 削除」
                ボタンへ 1 押しで到達するためのショートカット。bottom mode
                ↔ 直前のモードを toggle するので、登録ボタン操作後に戻る
                のも 1 押しで済む。target/top/mid トグルとは独立に置く。 */}
            {safeUrl && (
              <button
                type="button"
                onClick={() => {
                  setOffsetMode((m) => {
                    if (m === "bottom") {
                      const prev = beforeBottomModeRef.current ?? initialMode;
                      beforeBottomModeRef.current = null;
                      return prev;
                    }
                    beforeBottomModeRef.current = m;
                    return "bottom";
                  });
                }}
                title={
                  offsetMode === "bottom"
                    ? "前の表示位置に戻す"
                    : "ページ下部 (日程登録ボタン付近) にジャンプ"
                }
                aria-pressed={offsetMode === "bottom"}
                className={`inline-flex items-center gap-1 rounded-md border px-2 py-1.5 font-mono text-[10px] tracking-[0.18em] uppercase transition-colors ${
                  offsetMode === "bottom"
                    ? "border-[var(--neon-cyan)]/60 bg-[var(--neon-cyan)]/15 text-[var(--neon-cyan)]"
                    : "border-border/60 bg-background/40 text-muted-foreground hover:border-[var(--neon-cyan)]/60 hover:text-foreground"
                }`}
              >
                <CalendarPlus className="h-3 w-3" aria-hidden />
                登録
              </button>
            )}
            {/* 表示位置トグル: 「ヘッダー」「中央」「該当日 (target offset)」
                を循環。target offset が無い場合は header ↔ mid の 2-way。 */}
            {safeUrl && (
              <button
                type="button"
                onClick={() =>
                  setOffsetMode((m) => {
                    // bottom 状態から普通のトグルが押された場合は cycle に
                    // 復帰させる (= initialMode に戻す)。toggle 履歴は破棄。
                    if (m === "bottom") {
                      beforeBottomModeRef.current = null;
                      return initialMode;
                    }
                    const hasTarget = typeof targetOffsetPx === "number";
                    if (!hasTarget) return m === "top" ? "mid" : "top";
                    if (m === "target") return "mid";
                    if (m === "mid") return "top";
                    return "target";
                  })
                }
                title={
                  offsetMode === "top"
                    ? typeof targetOffsetPx === "number"
                      ? "該当日にジャンプ"
                      : "中央位置にジャンプ (ヘッダーを隠す)"
                    : offsetMode === "mid"
                      ? "ヘッダーを表示 (上端から)"
                      : offsetMode === "bottom"
                        ? "通常表示に戻す"
                        : "中央位置に戻す"
                }
                className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-background/40 px-2 py-1.5 font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase transition-colors hover:border-[var(--neon-cyan)]/60 hover:text-foreground"
              >
                {offsetMode === "top" ? (
                  <ChevronsDown className="h-3 w-3" aria-hidden />
                ) : (
                  <ChevronsUp className="h-3 w-3" aria-hidden />
                )}
                {offsetMode === "top"
                  ? typeof targetOffsetPx === "number"
                    ? "該当日"
                    : "中央"
                  : offsetMode === "mid"
                    ? "上"
                    : offsetMode === "bottom"
                      ? "通常"
                      : "中央"}
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
