"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, Layers, ListChecks, Plus } from "lucide-react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  PLACEHOLDER_CATEGORIES,
  findCategoryBySlug,
} from "@/lib/placeholder-categories";
import { StatusBadge } from "./status-badge";

/**
 * The "カテゴリー" main-tab — click opens a dropdown of categories so users can
 * jump straight to a specific category without bouncing through the index page.
 */
export function CategorySwitcher() {
  const pathname = usePathname();

  const isCategoryRoute = pathname.startsWith("/category");
  // /category/[slug]/... → extract slug
  const slugMatch = pathname.match(/^\/category\/([^/]+)/);
  const activeSlug = slugMatch ? decodeURIComponent(slugMatch[1]) : null;
  const activeCategory = activeSlug ? findCategoryBySlug(activeSlug) : null;

  // What sub-tab are we on? Preserve it when switching categories — falls
  // back to the default `mitigation` (most-used sub-tab) when entering from
  // outside any category route.
  const subSegment =
    pathname.match(/^\/category\/[^/]+\/([^/]+)/)?.[1] ?? "mitigation";

  const triggerLabel = activeCategory ? activeCategory.name : "カテゴリー";

  return (
    <DropdownMenu>
      {/* Base UI's Trigger renders its own <button>; we style it directly
          (no asChild — Base UI uses `render` prop, not Radix's asChild). */}
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
        // min-w-80 (20rem) so long content names like "アルカディア:ライトヘビー級"
        // render without truncation. Items still apply truncate as a safety net.
        className="glass min-w-80 border-border/40"
      >
        <div className="px-1.5 pt-1 pb-1 font-mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase">
          Categories
        </div>

        {PLACEHOLDER_CATEGORIES.length === 0 ? (
          <div className="px-2 py-3 text-center text-xs text-muted-foreground">
            まだカテゴリーがありません
          </div>
        ) : (
          PLACEHOLDER_CATEGORIES.map((cat) => {
            const isActive = cat.slug === activeSlug;
            // Preserve the current sub-tab (loot/mitigation/strategy) when switching.
            const href = `/category/${cat.slug}/${subSegment}`;
            return (
              <DropdownMenuItem
                key={cat.slug}
                // Base UI uses `render` to swap the underlying element. Passing a
                // Next.js Link here keeps prefetch + client-side navigation.
                render={<Link href={href} prefetch />}
                className={cn(
                  "flex cursor-pointer items-center gap-3 focus:bg-secondary/60",
                  isActive && "bg-secondary/40",
                )}
              >
                <StatusBadge
                  slug={cat.slug}
                  defaultStatus={cat.status}
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

        <DropdownMenuItem disabled className="flex items-center gap-2 opacity-60">
          <Plus className="h-4 w-4" aria-hidden />
          <span className="text-sm">カテゴリー追加（Phase 3）</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
