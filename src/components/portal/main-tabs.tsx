"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays } from "lucide-react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { CategorySwitcher } from "./category-switcher";

export function MainTabs() {
  const pathname = usePathname();
  const scheduleActive = pathname === "/";

  return (
    <nav
      aria-label="メインナビゲーション"
      className="glass-bar sticky top-14 z-20 sm:top-16"
    >
      <div className="mx-auto max-w-6xl px-2 sm:px-6">
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
            <CategorySwitcher />
          </li>
        </ul>
      </div>
    </nav>
  );
}
