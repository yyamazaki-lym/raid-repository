"use client";

import { useEffect, useState } from "react";
import { ExternalLink, ZoomIn } from "lucide-react";
import { Card } from "@/components/ui/card";
import { SheetUrlUnlinkButton } from "./sheet-url-unlink-button";

/**
 * Client iframe wrapper for SheetIframe (TODO #43).
 *
 * Google Sheets embeds render at 100% by default which spills outside
 * the dialog frame. We scale the iframe down (and over-size the inner
 * width/height) so the content fits in view by default, with a button
 * to cycle through preset scales. The choice persists per-browser per
 * kind so users keep their preferred fit across navigation.
 *
 * Per-kind defaults (user feedback 2026-04-29):
 *   mitigation: default 80% — below this the cell text is too small to
 *               read on most layouts. Cycle restricts to [80, 90, 100].
 *   loot:       default 75% — typical loot sheets fit at 75% out-of-the
 *               box; allow zooming further out for very wide sheets.
 *               Cycle is the full preset list [50, 60, 75, 90, 100].
 */
const PRESETS_BY_KIND = {
  mitigation: [0.8, 0.9, 1] as const,
  loot: [0.5, 0.6, 0.75, 0.9, 1] as const,
} as const;
const DEFAULT_BY_KIND = {
  mitigation: 0.8,
  loot: 0.75,
} as const;
type SheetKind = keyof typeof PRESETS_BY_KIND;
const STORAGE_KEY_PREFIX = "raid-portal:sheet-iframe-scale";

export function SheetIframeFrame({
  url,
  title,
  categoryId,
  kind,
  canEdit,
}: {
  /** Already validated by safeHref upstream. */
  url: string;
  title: string;
  categoryId?: string;
  kind?: SheetKind;
  canEdit?: boolean;
}) {
  // Fall back to "loot" preset family when kind is missing — its preset
  // list is a strict superset, so behavior degrades gracefully.
  const effectiveKind: SheetKind = kind ?? "loot";
  const presets = PRESETS_BY_KIND[effectiveKind];
  const defaultScale = DEFAULT_BY_KIND[effectiveKind];
  const storageKey = `${STORAGE_KEY_PREFIX}:${effectiveKind}`;
  const isPreset = (v: unknown): v is number =>
    typeof v === "number" && (presets as readonly number[]).includes(v);

  const [scale, setScale] = useState<number>(defaultScale);

  // Hydrate persisted choice on mount. Server render uses defaultScale
  // so the initial markup is stable; we only nudge it after hydration.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw === null) return;
      const parsed = Number(raw);
      if (isPreset(parsed)) setScale(parsed);
    } catch {
      // ignore: storage may be disabled / corrupted
    }
    // storageKey changes only when kind changes, which triggers a fresh
    // hydration for the new kind.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  const cycleScale = () => {
    setScale((curr) => {
      const i = presets.indexOf(curr as never);
      // If `curr` isn't in the active preset list (e.g. kind changed),
      // restart from the default for this kind.
      const next =
        i < 0
          ? defaultScale
          : presets[(i + 1) % presets.length]!;
      try {
        window.localStorage.setItem(storageKey, String(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  // 1 / scale で over-size して transform: scale で縮小。スケール 1 の
  // 時はオーバーサイズ不要 (= width/height 100%) なので分岐。
  const inv = scale >= 1 ? 1 : 1 / scale;
  const widthPct = `${inv * 100}%`;
  const heightPct = `${inv * 100}%`;

  return (
    /* Full-bleed wrapper: negative margin breaks out of the parent's
       max-w-6xl container so the iframe can use the full viewport
       width. The formula `calc(50% - 50vw)` resolves to 0 when parent
       fills the viewport (mobile) and to a negative pull on wider
       screens. */
    <div
      className="flex flex-col gap-3"
      style={{
        marginLeft: "calc(50% - 50vw + 1rem)",
        marginRight: "calc(50% - 50vw + 1rem)",
      }}
    >
      <div className="flex items-center justify-end gap-2 px-4 sm:px-6">
        <button
          type="button"
          onClick={cycleScale}
          title={`表示倍率 (${Math.round(scale * 100)}%) — クリックで切替`}
          aria-label={`表示倍率を切替 (現在 ${Math.round(scale * 100)}%)`}
          className="inline-flex items-center gap-1.5 rounded-md border border-border/60 px-3 py-1.5 font-mono text-[11px] tracking-[0.18em] text-muted-foreground uppercase transition-colors hover:border-[var(--neon-cyan)]/60 hover:text-foreground"
        >
          <ZoomIn className="h-3.5 w-3.5" aria-hidden />
          {Math.round(scale * 100)}%
        </button>
        {canEdit && categoryId && kind && (
          <SheetUrlUnlinkButton categoryId={categoryId} kind={kind} />
        )}
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 rounded-md border border-border/60 px-3 py-1.5 text-[11px] tracking-normal transition-colors hover:border-[var(--neon-cyan)]/60"
        >
          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          元サイトを開く
        </a>
      </div>
      <div className="px-4 sm:px-6">
        <Card className="glass overflow-hidden p-0">
          {/* Wrapper hides overflow; iframe is inversely over-sized
              then visually scaled back so the visible content matches
              `scale`. top-left origin keeps the upper-left of the
              spreadsheet in view. */}
          <div className="relative h-[calc(100dvh-22rem)] min-h-[420px] w-full overflow-hidden bg-white">
            <iframe
              src={url}
              title={title}
              className="absolute top-0 left-0 origin-top-left border-0"
              style={{
                width: widthPct,
                height: heightPct,
                transform: scale >= 1 ? "none" : `scale(${scale})`,
              }}
              sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
            />
          </div>
        </Card>
      </div>
    </div>
  );
}
