"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Languages } from "lucide-react";
import { cn } from "@/lib/utils";
import { LOCALES, LOCALE_LABELS, type Locale } from "@/lib/i18n/locales";
import { useLocale, useMessages } from "@/lib/i18n/client";
import { setLocaleAction } from "@/lib/i18n/actions";

/**
 * 表示言語の切替 (2026-09-06)。日本語 / English の 2 択セグメント。
 * 設定ダイアログとログイン画面に置く。選ぶと Server Action で cookie を
 * 書き、`router.refresh()` で Server Component 側も含めて描き直す。
 */
export function LocaleSwitcher({
  className,
  size = "md",
}: {
  className?: string;
  /** ログイン画面の脚注に置く小型版。 */
  size?: "sm" | "md";
}) {
  const current = useLocale();
  const m = useMessages();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const select = (next: Locale) => {
    if (next === current || pending) return;
    startTransition(async () => {
      const r = await setLocaleAction(next);
      if (r.ok) router.refresh();
    });
  };

  return (
    <div
      role="group"
      aria-label={m.settings.languageSwitchAria}
      aria-busy={pending}
      className={cn(
        "inline-flex items-center gap-1 rounded-md border border-border/40 bg-background/30 p-0.5",
        pending && "opacity-70",
        className,
      )}
    >
      <Languages
        className={cn(
          "shrink-0 text-[var(--neon-cyan)]",
          size === "sm" ? "mx-1 h-3 w-3" : "mx-1.5 h-3.5 w-3.5",
        )}
        aria-hidden
      />
      {LOCALES.map((l) => {
        const active = l === current;
        return (
          <button
            key={l}
            type="button"
            lang={l}
            onClick={() => select(l)}
            aria-pressed={active}
            disabled={pending}
            className={cn(
              "rounded-sm transition-colors",
              size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-1 text-[11px]",
              active
                ? "bg-secondary/60 text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {LOCALE_LABELS[l]}
          </button>
        );
      })}
    </div>
  );
}
