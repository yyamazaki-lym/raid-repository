"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ChevronDown,
  Layers,
  ListChecks,
  ShieldHalf,
  Dice5,
  BookOpen,
  Film,
  Terminal,
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
  { segment: "macros", label: "マクロ", Icon: Terminal },
];

type Props = {
  initialCategories: Category[];
};

export function CategorySwitcher({ initialCategories }: Props) {
  const categories = useRealtimeCategories(initialCategories);
  const pathname = usePathname();
  // Controlled open state. The SiteHeader sits in the persistent
  // layout so the dropdown component instance survives route changes;
  // without this we'd need a way to force-close.
  const [open, setOpen] = useState(false);

  // Close on route change — single source of truth for "navigation
  // happened, dismiss the menu". No per-Link onClick handlers
  // necessary, which keeps the JSX simple.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

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

  const triggerLabel = activeCategory ? activeCategory.name : "コンテンツ";

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
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
        <span className="max-w-[18ch] truncate sm:max-w-[28ch] lg:max-w-[40ch]">
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
        // Wide popup so long content names render on a single line
        // alongside the 5 sub-page icons. Bumped to 40rem on desktop
        // (was 32rem) because Japanese category names like
        // "FRU零式 / アルカディアライトヘビー級" were wrapping to two
        // lines once the icon row claimed ~140px.
        // Mobile caps at viewport width.
        className="glass-popup w-[max(20rem,min(calc(100vw-1rem),40rem))] border-border/40"
      >
        <div className="px-1.5 pt-1 pb-1 font-mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase">
          Contents
        </div>

        {categories.length === 0 ? (
          <div className="px-2 py-3 text-center text-xs text-muted-foreground">
            コンテンツがまだ登録されていません
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
                  "group flex flex-wrap items-center gap-x-1 gap-y-1 rounded-md transition-colors",
                  isActive && "bg-secondary/40",
                )}
              >
                {/* Default-click target wrapped in DropdownMenuItem so
                    Base UI's menuitem semantics (focus / click / close)
                    play nicely with Next.js Link navigation. The
                    earlier raw <div>+<Link> form was being swallowed
                    by the menu's pointer handling and never navigated. */}
                <DropdownMenuItem
                  render={
                    <Link
                      href={defaultHref}
                      prefetch
                      title={cat.name}
                      aria-label={cat.name}
                    />
                  }
                  className={cn(
                    "flex min-w-0 flex-1 cursor-pointer items-center gap-3",
                    isActive && "bg-secondary/40",
                  )}
                >
                  <StatusBadge
                    status={cat.status}
                    readOnly
                    variant="compact"
                    className="shrink-0"
                  />
                  <span className="min-w-0 flex-1 truncate text-sm leading-tight">
                    {cat.name}
                  </span>
                  {isActive && (
                    <span
                      aria-hidden
                      className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--neon-violet)] shadow-[0_0_8px_var(--neon-violet)]"
                    />
                  )}
                </DropdownMenuItem>

                {/* Sub-page shortcuts: each as its own DropdownMenuItem
                    so they get the same menuitem behavior. Compact
                    h-6 w-6 with icon-only rendering. */}
                <nav
                  aria-label={`${cat.name} のサブページ`}
                  className="flex shrink-0 items-center gap-0.5 pr-1.5"
                >
                  {SUB_PAGES.map((p) => (
                    <DropdownMenuItem
                      key={p.segment}
                      render={
                        <Link
                          href={`/category/${cat.slug}/${p.segment}`}
                          prefetch
                          title={p.label}
                          aria-label={`${cat.name} - ${p.label}`}
                        />
                      }
                      className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded text-muted-foreground transition-all duration-150 hover:scale-110 hover:bg-[var(--neon-violet)]/15 hover:text-[var(--neon-violet)]"
                    >
                      <p.Icon className="h-3 w-3" aria-hidden />
                    </DropdownMenuItem>
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
          <span className="text-sm">全コンテンツ一覧</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
