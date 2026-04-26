import { ExternalLink, Settings } from "lucide-react";
import { Card } from "@/components/ui/card";

/**
 * Shared iframe view for the mitigation / loot sub-tabs.
 *
 * The wrapper scales the iframe to 80% (matches the schedule page pattern)
 * so spreadsheets render with more rows visible. Users can always tap
 * "元サイトを開く" to view at native size.
 */
export function SheetIframe({
  url,
  title,
  emptyHint,
}: {
  url: string | null;
  title: string;
  /** Markdown-ish hint shown when no URL is configured. */
  emptyHint: string;
}) {
  if (!url) {
    return (
      <Card className="glass flex flex-col items-center gap-3 p-10 text-center">
        <span className="grid h-10 w-10 place-items-center rounded-md border border-border/60 bg-background/40 text-muted-foreground">
          <Settings className="h-4 w-4" aria-hidden />
        </span>
        <p className="font-display text-foreground text-sm">{title} 未設定</p>
        <p className="text-muted-foreground max-w-md text-xs leading-relaxed">
          {emptyHint}
        </p>
      </Card>
    );
  }

  return (
    /* Full-bleed wrapper: negative margin breaks out of the parent's
       max-w-6xl container so the iframe can use the full viewport width.
       The formula `calc(50% - 50vw)` resolves to 0 when parent fills the
       viewport (mobile) and to a negative pull on wider screens. */
    <div
      className="flex flex-col gap-3"
      style={{
        marginLeft: "calc(50% - 50vw + 1rem)",
        marginRight: "calc(50% - 50vw + 1rem)",
      }}
    >
      <div className="flex items-center justify-end px-4 sm:px-6">
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 rounded-md border border-border/60 px-3 py-1.5 font-mono text-[11px] tracking-widest uppercase transition-colors hover:border-[var(--neon-cyan)]/60"
        >
          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          元サイトを開く
        </a>
      </div>
      <div className="px-4 sm:px-6">
        <Card className="glass overflow-hidden p-0">
          {/* Wrapper hides overflow; iframe at 125% scaled to 0.8 so visible
              content is 80% — fits more spreadsheet rows on screen. */}
          <div className="relative h-[calc(100dvh-22rem)] min-h-[420px] w-full overflow-hidden bg-white">
            <iframe
              src={url}
              title={title}
              className="absolute top-0 left-0 origin-top-left border-0"
              style={{
                width: "125%",
                height: "125%",
                transform: "scale(0.8)",
              }}
              sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
            />
          </div>
        </Card>
      </div>
    </div>
  );
}
