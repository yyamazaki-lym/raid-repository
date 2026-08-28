"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ChevronDown,
  Layers,
  ListChecks,
} from "lucide-react";
import { SUB_TAB_DEFS } from "@/lib/sub-tab-defs";
import { motion, useReducedMotion } from "motion/react";
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
import { filterVisibleCategories } from "@/lib/category-visibility";
import { isCategoryTabId, type Category } from "@/lib/supabase/types";

// タブ定義は `@/lib/sub-tab-defs` に集約 (旧: この 3 ファイルに同じ配列を
// コピーしていたため、タブ追加時にここだけ更新漏れが起きていた)。
const SUB_PAGES = SUB_TAB_DEFS;

type Props = {
  initialCategories: Category[];
  /**
   * TODO #19: client-side filter for realtime updates. The server already
   * filters `initialCategories`; this prop lets us keep the filter
   * applied when the realtime hook refetches the raw list after a
   * `categories` table mutation.
   */
  userRoleIds: string[];
};

export function CategorySwitcher({ initialCategories, userRoleIds }: Props) {
  const liveAll = useRealtimeCategories(initialCategories);
  const categories = filterVisibleCategories(liveAll, userRoleIds);
  const pathname = usePathname();
  // Controlled open state. The SiteHeader sits in the persistent
  // layout so the dropdown component instance survives route changes;
  // without this we'd need a way to force-close.
  const [open, setOpen] = useState(false);
  // F-2: prefers-reduced-motion 時は underline の spring を即時化する。
  const reduceMotion = useReducedMotion();
  const underlineTransition = reduceMotion
    ? { duration: 0 }
    : { type: "spring" as const, bounce: 0.2, duration: 0.5 };

  // 2.9 (2026-06-11): メニュー内リンクのクリック後、遷移完了 (pathname
  // 変化) までトリガーに pending ドットを点灯する。menu item はクリックで
  // 即閉じるため `useLinkStatus` (Link 配下限定) は使えず、Link の
  // `onNavigate` (SPA 遷移時のみ発火、修飾キークリックでは発火しない) で
  // 点灯 → 下の pathname effect で消灯する。同一 pathname への遷移は
  // pathname が変化せず消灯契機が無いので点灯させない。
  const [navPending, setNavPending] = useState(false);
  const handleNavigate = (href: string) => {
    if (href !== pathname) setNavPending(true);
  };

  // Close on route change — single source of truth for "navigation
  // happened, dismiss the menu". No per-Link onClick handlers
  // necessary, which keeps the JSX simple.
  useEffect(() => {
    setOpen(false);
    setNavPending(false);
  }, [pathname]);

  // 2.9 follow-up (2026-06-12): 遷移が完了しないケース (サーバーエラー等で
  // pathname が変わらない) では上の effect が走らず点灯しっぱなしになる。
  // safety timeout で自動消灯する。正常系の遷移は cold start 込みでも
  // 数秒で完了して pathname 変化が先に来るので、体感には影響しない。
  useEffect(() => {
    if (!navPending) return;
    const timer = setTimeout(() => setNavPending(false), 15_000);
    return () => clearTimeout(timer);
  }, [navPending]);

  // メニューを開き直した = 直前の遷移は完了しなかったとみなしてリセット
  // (失敗した遷移のドットを引きずったまま次の操作に入らない)。
  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) setNavPending(false);
  };

  const isCategoryRoute = pathname.startsWith("/category");
  const slugMatch = pathname.match(/^\/category\/([^/]+)/);
  const activeSlug = slugMatch ? decodeURIComponent(slugMatch[1]) : null;
  const activeCategory =
    activeSlug != null
      ? (categories.find((c) => c.slug === activeSlug) ?? null)
      : null;

  // 現在開いているサブタブを取得。pathname が /category/{slug}/{sub} 形式で
  // {sub} が CategoryTabId に一致するときだけ採用、それ以外 (非カテゴリ
  // ページから開いた / 子セグメントが規定タブ id でない) は null。
  // 別カテゴリへ切替える時に同じサブタブに着地させるために使う。
  const currentSubFromPath =
    pathname.match(/^\/category\/[^/]+\/([^/]+)/)?.[1] ?? null;
  const candidateTab =
    currentSubFromPath && isCategoryTabId(currentSubFromPath)
      ? currentSubFromPath
      : null;

  const triggerLabel = activeCategory ? activeCategory.name : "コンテンツ";

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger
        data-active={isCategoryRoute}
        aria-current={isCategoryRoute ? "page" : undefined}
        className={cn(
          "neon-edge group relative flex shrink-0 items-center gap-2 rounded-md border border-transparent px-4 py-2 text-[12px] font-medium tracking-normal transition-colors",
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
        {/* 2.9 (2026-06-11): メニュー内リンククリック後の遷移 pending 表示。
            cold start 等で RSC 応答が遅い時の「無音 stuck」対策。
            absolute で右 padding 域に重ね、flow に置かない
            (flow に入れるとタブ内余白が左 16px / 右 30px に偏る)。 */}
        <span
          aria-hidden
          className={cn(
            "link-pending-dot absolute top-1/2 right-1.5 -translate-y-1/2 text-[var(--neon-violet)]",
            navPending && "is-pending",
          )}
        />
        {isCategoryRoute && (
          <motion.span
            layoutId="main-tab-underline"
            transition={underlineTransition}
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
            // 現在のサブタブを引き継ぐ。ただし対象カテゴリでそのタブが
            // tab_config.{tab}.enabled === false で非表示になっている場合、
            // あるいは引き継げる subSegment が取れない場合は defaultTab
            // にフォールバック。判定式は sub-tabs.tsx の描画判定と同一。
            // 5 個のサブページアイコンは特定タブを指す UI なので
            // 引き継がず該当タブに直接遷移する (下の SUB_PAGES.map)。
            const targetTab =
              candidateTab !== null &&
              cat.tabConfig?.[candidateTab]?.enabled !== false
                ? candidateTab
                : cat.defaultTab;
            const defaultHref = `/category/${cat.slug}/${targetTab}`;
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
                      onNavigate={() => handleNavigate(defaultHref)}
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
                  {SUB_PAGES.map((p) => {
                    // 2.9 (2026-06-12): tab_config.{tab}.enabled === false の
                    // タブはアイコン行からも除外、label 上書きは tooltip に
                    // 反映 (sub-tabs.tsx / category-list.tsx と同一判定)。
                    const cfg = cat.tabConfig?.[p.segment];
                    if (cfg?.enabled === false) return null;
                    const labelOverride = cfg?.label?.trim();
                    const label = labelOverride ? labelOverride : p.label;
                    return (
                      <DropdownMenuItem
                        key={p.segment}
                        render={
                          <Link
                            href={`/category/${cat.slug}/${p.segment}`}
                            prefetch
                            title={label}
                            aria-label={`${cat.name} - ${label}`}
                            onNavigate={() =>
                              handleNavigate(`/category/${cat.slug}/${p.segment}`)
                            }
                          />
                        }
                        className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded text-muted-foreground transition-all duration-150 hover:scale-110 hover:bg-[var(--neon-violet)]/15 hover:text-[var(--neon-violet)] active:scale-95"
                      >
                        <p.Icon className="h-3 w-3" aria-hidden />
                      </DropdownMenuItem>
                    );
                  })}
                </nav>
              </div>
            );
          })
        )}

        <DropdownMenuSeparator />

        <DropdownMenuItem
          render={
            <Link
              href="/category"
              prefetch
              onNavigate={() => handleNavigate("/category")}
            />
          }
          className="flex cursor-pointer items-center gap-2"
        >
          <ListChecks className="h-4 w-4 text-muted-foreground" aria-hidden />
          <span className="text-sm">全コンテンツ一覧</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
