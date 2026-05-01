"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays } from "lucide-react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { CategorySwitcher } from "./category-switcher";
import { MainActionSlotTarget } from "./action-slot";
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
        <div className="flex items-center gap-1">
          <ul className="flex min-w-0 flex-1 gap-1 overflow-x-auto py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <li className="shrink-0">
              <Link
                href="/"
                data-active={scheduleActive}
                className={cn(
                  "neon-edge group relative flex items-center gap-2 rounded-md border border-transparent px-4 py-1.5 font-mono text-[12px] tracking-[0.16em] uppercase transition-colors",
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
                {scheduleActive && (
                  <motion.span
                    layoutId="main-tab-underline"
                    transition={{ type: "spring", bounce: 0.2, duration: 0.5 }}
                    className="absolute right-2 -bottom-px left-2 h-px bg-[var(--neon-cyan)] shadow-[0_0_10px_var(--neon-cyan)]"
                  />
                )}
              </Link>
            </li>

            <li className="shrink-0">
              <CategorySwitcher
                initialCategories={initialCategories}
                userRoleIds={userRoleIds}
              />
            </li>
          </ul>
          {/* TODO #58 part2: /category 一覧の Maintenance + 追加ボタンが
              stuck 時に portal される右端スロット。ul (overflow-x-auto) の
              外に置き、tabs スクロール時もスロット内ボタンが常に visible
              になる構造。in-flow 時は空。mobile では portal される複数
              ボタンが viewport 幅を超え得るので max-w + overflow-x-auto で
              内部スクロール可能にする。SubTabs ActionSlotTarget と同形式。 */}
          <MainActionSlotTarget className="flex shrink-0 items-center gap-1 max-w-[60vw] overflow-x-auto [scrollbar-width:none] sm:max-w-none [&::-webkit-scrollbar]:hidden [&>*]:!flex-nowrap [&>*]:shrink-0 [&>*>*]:shrink-0" />
        </div>
      </div>
    </nav>
  );
}
