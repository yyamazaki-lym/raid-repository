"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils";
import { CategorySwitcher } from "./category-switcher";
import type { Category } from "@/lib/supabase/types";

export function MainTabs({
  initialCategories,
  userRoleIds,
}: {
  initialCategories: Category[];
  /**
   * TODO #19: realtime category updates re-fetch the full list, but the
   * client doesn't know which roles the user has unless we pass them
   * down. CategorySwitcher uses this to filter realtime updates so a
   * newly-added role-restricted category doesn't briefly appear before
   * the next page navigation.
   */
  userRoleIds: string[];
}) {
  const pathname = usePathname();
  const scheduleActive = pathname === "/";

  return (
    <nav
      aria-label="メインナビゲーション"
      className="glass-bar sticky top-14 z-20 sm:top-16"
    >
      <div className="mx-auto max-w-5xl px-2 sm:px-6">
        <ul className="flex gap-1 overflow-x-auto py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <li className="shrink-0">
            <Link
              href="/"
              data-active={scheduleActive}
              className={cn(
                "neon-edge group relative flex items-center gap-2 rounded-md border border-transparent px-4 py-2 font-mono text-[12px] tracking-[0.16em] uppercase transition-colors",
                scheduleActive
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground/90",
              )}
              aria-current={scheduleActive ? "page" : undefined}
            >
              <CalendarDays
                className={cn(
                  "h-3.5 w-3.5 transition-colors",
                  scheduleActive
                    ? "text-[var(--neon-cyan)]"
                    : "text-muted-foreground group-hover:text-foreground/80",
                )}
                aria-hidden
              />
              <span>スケジュール</span>
              {/* TODO #11 phase 8: framer-motion 撤廃。常時描画 + opacity
                  crossfade に置換。category-switcher (violet) との色違い
                  なので「ひとつのバーが滑る」演出より「片方が消えてもう
                  片方が現れる」のほうが視覚的にも自然。 */}
              <span
                aria-hidden
                className={cn(
                  "pointer-events-none absolute right-2 -bottom-px left-2 h-px bg-[var(--neon-cyan)] shadow-[0_0_10px_var(--neon-cyan)] transition-opacity duration-300 ease-out",
                  scheduleActive ? "opacity-100" : "opacity-0",
                )}
              />
            </Link>
          </li>

          <li className="shrink-0">
            <CategorySwitcher
              initialCategories={initialCategories}
              userRoleIds={userRoleIds}
            />
          </li>
        </ul>
      </div>
    </nav>
  );
}
