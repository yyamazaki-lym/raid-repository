"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChevronDown,
  Layers,
  ListChecks,
  ShieldHalf,
  Dice5,
  BookOpen,
  Film,
  type LucideIcon,
} from "lucide-react";
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

const SUB_PAGES: Array<{ segment: string; label: string; Icon: LucideIcon }> = [
  { segment: "mitigation", label: "軽減表", Icon: ShieldHalf },
  { segment: "loot", label: "ロット管理", Icon: Dice5 },
  { segment: "strategy", label: "攻略情報", Icon: BookOpen },
  { segment: "videos", label: "動画", Icon: Film },
];

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
        <span className="max-w-[14ch] truncate sm:max-w-[24ch] lg:max-w-[32ch]">
          {triggerLabel}
        </span>
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
        // Wide popup so long content names render fully.
        // Caps at viewport width on mobile.
        className="glass-popup min-w-72 max-w-[calc(100vw-1rem)] border-border/40 sm:min-w-96"
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
            // Default-action target: preserve the user's current sub-tab
            // when switching, fall back to mitigation. The 4 inline icons
            // bypass that and navigate to specific sub-pages directly.
            const defaultHref = `/category/${cat.slug}/${subSegment}`;
            return (
              <div
                key={cat.id}
                className={cn(
                  "group flex items-center gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-secondary/60 focus-within:bg-secondary/60",
                  isActive && "bg-secondary/40",
                )}
              >
                {/* Default-click target: name + status. Goes to current
                    sub-tab to feel "natural" when chained from another
                    category page. */}
                <Link
                  href={defaultHref}
                  prefetch
                  className="flex flex-1 items-center gap-3 cursor-pointer"
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
                </Link>

                {/* Sub-page shortcuts: always visible (touch-friendly).
                    Each is its own Link so clicking jumps directly to
                    that page without needing the default sub-tab path. */}
                <nav
                  aria-label={`${cat.name} のサブページ`}
                  className="flex shrink-0 items-center gap-0.5"
                >
                  {SUB_PAGES.map((p) => (
                    <Link
                      key={p.segment}
                      href={`/category/${cat.slug}/${p.segment}`}
                      prefetch
                      title={p.label}
                      aria-label={`${cat.name} - ${p.label}`}
                      className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-all duration-150 hover:scale-110 hover:bg-[var(--neon-violet)]/15 hover:text-[var(--neon-violet)]"
                    >
                      <p.Icon className="h-3 w-3" aria-hidden />
                    </Link>
                  ))}
                </nav>
              </div>
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
