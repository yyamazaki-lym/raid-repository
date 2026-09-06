import { Settings, AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { safeHref } from "@/lib/url-safe";
import { SheetIframeFrame } from "./sheet-iframe-frame";
import { getMessages } from "@/lib/i18n/server";

/**
 * Shared iframe view for the mitigation / loot sub-tabs.
 *
 * Server-renders the empty / unsafe-URL fallbacks, then delegates the
 * actual iframe (and its zoom controls — TODO #43) to a client child
 * so the user can switch the embed scale without a server round-trip.
 *
 * `categoryId` + `kind` + `canEdit` を受け取ると admin に「紐付け解除」
 * ボタンを表示する (TODO #31)。これらが渡されない場合は従来どおり
 * 解除 UI 無しで描画する (= 後方互換)。
 */
export async function SheetIframe({
  url,
  title,
  emptyHint,
  categoryId,
  kind,
  canEdit,
}: {
  url: string | null;
  title: string;
  /** Markdown-ish hint shown when no URL is configured. */
  emptyHint: string;
  /** When set together with `kind` and `canEdit=true`, show an unlink button. */
  categoryId?: string;
  kind?: "mitigation" | "loot";
  canEdit?: boolean;
}) {
  const m = await getMessages();
  if (!url) {
    return (
      <Card className="glass flex flex-col items-center gap-3 p-10 text-center">
        <span className="grid h-10 w-10 place-items-center rounded-md border border-border/60 bg-background/40 text-muted-foreground">
          <Settings className="h-4 w-4" aria-hidden />
        </span>
        <p className="font-display text-foreground text-sm">
          {m.sheet.notConfigured(title)}
        </p>
        <p className="text-muted-foreground max-w-md text-xs leading-relaxed">
          {emptyHint}
        </p>
      </Card>
    );
  }

  // Defense in depth: refuse to render the iframe (and external link)
  // unless the URL uses http/https. Prevents `data:` / `javascript:` /
  // `file:` URIs from ever reaching iframe.src or anchor.href.
  const safeUrl = safeHref(url);
  if (!safeUrl) {
    return (
      <Card className="glass flex flex-col items-center gap-3 border-amber-400/40 p-10 text-center">
        <span className="grid h-10 w-10 place-items-center rounded-md border border-amber-400/40 bg-amber-400/10 text-amber-300">
          <AlertTriangle className="h-4 w-4" aria-hidden />
        </span>
        <p className="font-display text-foreground text-sm">
          {m.sheet.unsafeUrl(title)}
        </p>
        <p className="text-muted-foreground max-w-md text-xs leading-relaxed">
          {m.sheet.unsafeUrlHint}
        </p>
      </Card>
    );
  }

  return (
    <SheetIframeFrame
      url={safeUrl}
      title={title}
      categoryId={categoryId}
      kind={kind}
      canEdit={canEdit}
    />
  );
}
