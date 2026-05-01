"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import {
  Dice5,
  ShieldHalf,
  BookOpen,
  Film,
  Terminal,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

type SubTab = {
  id: string;
  label: string;
  segment: string;
  Icon: LucideIcon;
};

// Order = use frequency: 軽減表 > ロット管理 > 攻略情報 > 動画 > マクロ.
const SUB_TABS: SubTab[] = [
  { id: "mitigation", label: "軽減表", segment: "mitigation", Icon: ShieldHalf },
  { id: "loot", label: "ロット管理", segment: "loot", Icon: Dice5 },
  { id: "strategy", label: "攻略情報", segment: "strategy", Icon: BookOpen },
  { id: "videos", label: "動画", segment: "videos", Icon: Film },
  { id: "macros", label: "マクロ", segment: "macros", Icon: Terminal },
];

export function SubTabs({ baseHref }: { baseHref: string }) {
  const pathname = usePathname();
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const [stuck, setStuck] = useState(false);

  // TODO #56: sentinel が画面外 = nav が sticky で stuck している状態。
  // collapsed 形 (padding / icon / text サイズ縮小) に切替える。
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    // rootMargin で sticky top 値ぶん上端を引き上げ、nav が貼り付く
    // 瞬間 (sentinel が sticky 行に達した時) に切替えが発火するようにする。
    // 110px = mobile sticky top (sm 以上は 118px だが 8px 差は視覚的に無視可)。
    const observer = new IntersectionObserver(
      ([entry]) => setStuck(!entry.isIntersecting),
      { threshold: 0, rootMargin: "-110px 0px 0px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <div ref={sentinelRef} aria-hidden className="h-px" />
      <nav
        aria-label="コンテンツ内ナビゲーション"
        data-stuck={stuck}
        className="glass-bar border-border/40 sticky top-[110px] z-15 border-b transition-[top] sm:top-[118px]"
      >
        <div className="mx-auto max-w-5xl px-2 sm:px-6">
          <ul
            className={cn(
              "flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
              "transition-[padding] duration-200",
              stuck ? "py-1" : "py-2",
            )}
          >
            {SUB_TABS.map((tab) => {
              const href = `${baseHref}/${tab.segment}`;
              const active = pathname === href || pathname.startsWith(`${href}/`);
              return (
                <li key={tab.id} className="shrink-0">
                  <Link
                    href={href}
                    data-active={active}
                    className={cn(
                      "relative flex items-center rounded-md font-mono tracking-[0.16em] uppercase transition-all duration-200",
                      stuck
                        ? "gap-1 px-2 py-1 text-[10px]"
                        : "gap-1.5 px-3 py-1.5 text-[11px]",
                      active
                        ? "bg-secondary/60 text-foreground"
                        : "text-muted-foreground hover:bg-secondary/40 hover:text-foreground/90",
                    )}
                    aria-current={active ? "page" : undefined}
                  >
                    <tab.Icon
                      className={cn(
                        "shrink-0 transition-all duration-200",
                        stuck ? "h-3 w-3" : "h-3.5 w-3.5",
                        active
                          ? "text-[var(--neon-violet)]"
                          : "text-muted-foreground/75",
                      )}
                      aria-hidden
                    />
                    <span>{tab.label}</span>
                    {active && (
                      <motion.span
                        layoutId="sub-tab-underline"
                        transition={{ type: "spring", bounce: 0.2, duration: 0.4 }}
                        className={cn(
                          "absolute h-px bg-[var(--neon-violet)]",
                          stuck
                            ? "right-1 -bottom-[5px] left-1 shadow-[0_0_4px_var(--neon-violet)]"
                            : "right-1.5 -bottom-[7px] left-1.5 shadow-[0_0_8px_var(--neon-violet)]",
                        )}
                      />
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </nav>
    </>
  );
}
