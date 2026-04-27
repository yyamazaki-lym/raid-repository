"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Route-level error boundary for the (portal) segment.
 *
 * Replaces Next.js's default opaque error overlay with a recoverable card
 * that shows the message + a digest hint and exposes a Retry button.
 * `error.message` is intentionally surfaced — this is an internal tool
 * with no untrusted users, so seeing the actual stack helps diagnosis.
 */
export default function PortalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface to the browser console so it shows up in DevTools alongside
    // any other client logs.
    console.error("[portal-error]", error);
  }, [error]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-4 px-4 py-12 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-md border border-destructive/40 bg-background/40 text-destructive shadow-[0_0_24px_-6px_var(--destructive)]">
        <AlertTriangle className="h-5 w-5" aria-hidden />
      </span>
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-lg tracking-[0.16em] uppercase">
          Page Error
        </h1>
        <p className="text-sm text-muted-foreground">
          ページの描画でエラーが発生しました。リトライしてください。
        </p>
      </div>

      <pre className="glass max-w-full overflow-x-auto rounded-md p-3 text-left font-mono text-[11px] leading-relaxed text-foreground/90">
        {error.message}
        {error.digest && `\n\n[digest] ${error.digest}`}
      </pre>

      <Button
        type="button"
        size="sm"
        onClick={reset}
        className="gap-1.5 font-mono text-[11px] tracking-[0.18em] uppercase"
      >
        <RotateCcw className="h-3.5 w-3.5" aria-hidden />
        Retry
      </Button>
    </div>
  );
}
