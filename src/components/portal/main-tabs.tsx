"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import { CategorySwitcher } from "./category-switcher";
import { LinkPendingIndicator } from "./link-pending-indicator";
import { MainActionSlotTarget } from "./action-slot";
import type { Category } from "@/lib/supabase/types";
import type { ScheduleSourceMode } from "@/lib/schedule/source-mode";

export function MainTabs({
  initialCategories,
  userRoleIds,
  scheduleSourceMode,
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
  /**
   * TODO #79: schedule_source_mode='disabled' の portal ではスケジュール
   * 機能が無効化されているため、ナビ上から「スケジュール」タブ自体を
   * 取り除き、コンテンツページを実質のホームにする。admin が settings
   * dialog から sync/native に戻したら tab も自動復活する。
   */
  scheduleSourceMode: ScheduleSourceMode;
}) {
  const pathname = usePathname();
  const scheduleActive = pathname === "/";
  const showScheduleTab = scheduleSourceMode !== "disabled";
  // F-2: prefers-reduced-motion 時は underline の spring を即時化する。
  const reduceMotion = useReducedMotion();
  const underlineTransition = reduceMotion
    ? { duration: 0 }
    : { type: "spring" as const, bounce: 0.2, duration: 0.5 };

  return (
    <nav
      aria-label="メインナビゲーション"
      className="glass-bar sticky top-[var(--header-h)] z-20"
    >
      <div className="mx-auto max-w-5xl px-2 sm:px-6">
        <div className="flex items-center gap-1">
          <ul className="flex min-w-0 flex-1 gap-1 overflow-x-auto py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {showScheduleTab && (
              <li className="shrink-0">
                <Link
                  href="/"
                  data-active={scheduleActive}
                  className={cn(
                    "neon-edge group relative flex items-center gap-2 rounded-md border border-transparent px-4 py-2 text-[12px] font-medium tracking-normal transition-colors",
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
                  {/* 2.9 (2026-06-11): cold start 等で RSC 応答が遅い時の
                      「無音 stuck」対策。prefetch 済みなら出ない。
                      absolute で右 padding 域に重ね、flow に置かない
                      (flow に入れるとタブ内余白が左 16px / 右 30px に偏る)。 */}
                  <LinkPendingIndicator className="absolute top-1/2 right-1.5 -translate-y-1/2 text-[var(--neon-cyan)]" />
                  {scheduleActive && (
                    <motion.span
                      layoutId="main-tab-underline"
                      transition={underlineTransition}
                      className="absolute right-2 -bottom-px left-2 h-px bg-[var(--neon-cyan)] shadow-[0_0_10px_var(--neon-cyan)]"
                    />
                  )}
                </Link>
              </li>
            )}

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
