"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, Layers, ListChecks } from "lucide-react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { StatusBadge } from "./status-badge";
import { useRealtimeCategories } from "@/lib/categories-client";
import type { Category } from "@/lib/supabase/types";

type Props = {
  initialCategories: Category[];
};

export function CategorySwitcher({ initialCategories }: Props) {
  const categories = useRealtimeCategories(initialCategories);
  const pathname = usePathname();

  const isCategoryRoute = pathname.startsWith("/category");
  const slugMatch = pathname.match(/^\/category\/([^/]+)/);
  const activeSlug = slugMatch ? decodeURIComponent(slugMatch[1]) : null;
  const activeCategory =
    activeSlug != null
      ? (categories.find((c) => c.slug === activeSlug) ?? null)
      : null;

  // Preserve current sub-tab when switching categories — fall back to
  // mitigation (most-used) when entering from outside.
  const subSegment =
    pathname.match(/^\/category\/[^/]+\/([^/]+)/)?.[1] ?? "mitigation";

  const triggerLabel = activeCategory ? activeCategory.name : "カテゴリー";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        data-active={isCategoryRoute}
        aria-current={isCategoryRoute ? "page" : undefined}
        className={cn(
          "neon-edge group relative flex shrink-0 items-center gap-2 rounded-md border border-transparent px-4 py-2 font-mono text-[12px] tracking-[0.16em] uppercase transition-colors",
          isCategoryRoute
            ? "text-foreground"
            : "text-muted-foreground hover:text-foreground/90",
        )}
      >
        <Layers
          className={cn(
            "h-3.5 w-3.5 transition-colors",
            isCategoryRoute
              ? "text-[var(--neon-violet)]"
              : "text-muted-foreground group-hover:text-foreground/80",
          )}
          aria-hidden
        />
        <span className="max-w-[20ch] truncate">{triggerLabel}</span>
        <ChevronDown
          className="h-3 w-3 opacity-70 transition-transform data-[popup-open]:rotate-180"
          aria-hidden
        />
        {isCategoryRoute && (
          <motion.span
            layoutId="main-tab-underline"
            transition={{ type: "spring", bounce: 0.2, duration: 0.5 }}
            className="absolute right-2 -bottom-px left-2 h-px bg-[var(--neon-violet)] shadow-[0_0_10px_var(--neon-violet)]"
          />
        )}
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="start"
        sideOffset={8}
        className="glass-popup min-w-80 border-border/40"
      >
        <div className="px-1.5 pt-1 pb-1 font-mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase">
          Categories
        </div>

        {categories.length === 0 ? (
          <div className="px-2 py-3 text-center text-xs text-muted-foreground">
            カテゴリーがまだ登録されていません
          </div>
        ) : (
          categories.map((cat) => {
            const isActive = cat.slug === activeSlug;
            const href = `/category/${cat.slug}/${subSegment}`;
            return (
              <DropdownMenuItem
                key={cat.id}
                render={<Link href={href} prefetch />}
                className={cn(
                  "flex cursor-pointer items-center gap-3 focus:bg-secondary/60",
                  isActive && "bg-secondary/40",
                )}
              >
                <StatusBadge
                  status={cat.status}
                  readOnly
                  variant="compact"
                  className="shrink-0"
                />
                <span className="flex-1 truncate text-sm">{cat.name}</span>
                {isActive && (
                  <span
                    aria-hidden
                    className="h-1.5 w-1.5 rounded-full bg-[var(--neon-violet)] shadow-[0_0_8px_var(--neon-violet)]"
                  />
                )}
              </DropdownMenuItem>
            );
          })
        )}

        <DropdownMenuSeparator />

        <DropdownMenuItem
          render={<Link href="/category" prefetch />}
          className="flex cursor-pointer items-center gap-2"
        >
          <ListChecks className="h-4 w-4 text-muted-foreground" aria-hidden />
          <span className="text-sm">全カテゴリー一覧</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
