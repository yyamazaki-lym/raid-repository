"use client";

import { Palette, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { THEMES, findTheme, type ThemeDef } from "@/lib/themes";
import { setThemeId, useThemeId } from "@/lib/theme-store";

export function ThemeSwitcher() {
  const current = useThemeId();
  const currentTheme = findTheme(current);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="group flex items-center gap-2 rounded-md border border-border/40 bg-background/30 px-2.5 py-1.5 font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase transition-colors hover:border-[var(--neon-cyan)]/40 hover:text-foreground"
        aria-label="テーマを切り替え"
      >
        <Palette className="h-3.5 w-3.5 text-[var(--neon-cyan)]" aria-hidden />
        <Swatch theme={currentTheme} size="sm" />
        <span className="hidden sm:inline">{currentTheme.label}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="glass-popup min-w-64">
        <div className="px-1.5 pt-1 pb-1 font-mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase">
          Theme
        </div>
        {THEMES.map((t) => {
          const active = t.id === current;
          return (
            <DropdownMenuItem
              key={t.id}
              onClick={() => setThemeId(t.id)}
              className={cn(
                "flex cursor-pointer items-center gap-3 py-1.5",
                active && "bg-secondary/40",
              )}
            >
              <Swatch theme={t} />
              <div className="flex min-w-0 flex-1 flex-col leading-tight">
                <span className="truncate text-sm">{t.title}</span>
                <span className="font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
                  v{t.version} · {t.subtitle}
                </span>
              </div>
              {active && (
                <Check
                  className="h-3.5 w-3.5 text-[var(--neon-cyan)]"
                  aria-hidden
                />
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Swatch({
  theme,
  size = "md",
}: {
  theme: ThemeDef;
  size?: "sm" | "md";
}) {
  const dim =
    size === "sm" ? "h-3 w-3" : "h-4 w-4";
  return (
    <span
      aria-hidden
      className={cn(
        "shrink-0 overflow-hidden rounded-full border border-border/60 ring-1 ring-black/30",
        dim,
      )}
      style={{
        background: `conic-gradient(${theme.swatch[0]} 0 33.33%, ${theme.swatch[1]} 33.33% 66.66%, ${theme.swatch[2]} 66.66%)`,
      }}
    />
  );
}
