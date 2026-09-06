"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LOCALES, LOCALE_LABELS, type Locale } from "@/lib/i18n/locales";
import { useLocale, useMessages } from "@/lib/i18n/client";
import { setLocaleAction } from "@/lib/i18n/actions";
import { LocaleFlag } from "./locale-flag";

/**
 * 表示言語の切替 (2026-09-06、2026-09-07 にヘッダーへ移動 + 国旗)。
 *
 * - `variant="menu"` (既定): ヘッダー用。テーマ切替と同じ見た目のトリガー
 *   (国旗 + ラベル、ラベルはスマホでは隠す) + ドロップダウン。ヘッダーの高さや
 *   他ボタンの並びを変えないよう、ThemeSwitcher と同じクラスを使う。
 * - `variant="segmented"`: ログイン画面の脚注用。国旗付きの 2 択。
 * 選ぶと Server Action で cookie を書き、`router.refresh()` で描き直す。
 */
export function LocaleSwitcher({
  className,
  variant = "menu",
}: {
  className?: string;
  variant?: "menu" | "segmented";
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

  if (variant === "segmented") {
    return (
      <div
        role="group"
        aria-label={m.settings.languageSwitchAria}
        aria-busy={pending}
        className={cn(
          "inline-flex items-center gap-0.5 rounded-md border border-border/40 bg-background/30 p-0.5",
          pending && "opacity-70",
          className,
        )}
      >
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
                "inline-flex items-center gap-1.5 rounded-sm px-1.5 py-0.5 text-[10px] transition-colors",
                active
                  ? "bg-secondary/60 text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <LocaleFlag locale={l} className="h-3 w-[18px]" />
              {LOCALE_LABELS[l]}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "group flex items-center gap-2 rounded-md border border-border/40 bg-background/30 px-2.5 py-1.5 text-[10px] tracking-normal text-muted-foreground transition-colors hover:border-[var(--neon-cyan)]/40 hover:text-foreground",
          pending && "opacity-70",
          className,
        )}
        aria-label={m.settings.languageSwitchAria}
        aria-busy={pending}
      >
        <LocaleFlag locale={current} />
        <span className="hidden sm:inline" lang={current}>
          {LOCALE_LABELS[current]}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="glass-popup min-w-44">
        <div className="px-1.5 pt-1 pb-1 font-mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase">
          Language
        </div>
        {LOCALES.map((l) => {
          const active = l === current;
          return (
            <DropdownMenuItem
              key={l}
              onClick={() => select(l)}
              className={cn(
                "flex cursor-pointer items-center gap-3 py-1.5",
                active && "bg-secondary/40",
              )}
            >
              <LocaleFlag locale={l} className="h-4 w-6" />
              <span className="flex-1 text-sm" lang={l}>
                {LOCALE_LABELS[l]}
              </span>
              {active && (
                <Check className="h-3.5 w-3.5 text-[var(--neon-cyan)]" aria-hidden />
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
