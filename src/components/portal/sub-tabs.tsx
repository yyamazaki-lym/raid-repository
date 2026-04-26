"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import {
  Dice5,
  ShieldHalf,
  BookOpen,
  Film,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

type SubTab = {
  id: string;
  label: string;
  segment: string;
  Icon: LucideIcon;
};

// Order = use frequency: 軽減表 > ロット管理 > 攻略情報 > 動画.
const SUB_TABS: SubTab[] = [
  { id: "mitigation", label: "軽減表", segment: "mitigation", Icon: ShieldHalf },
  { id: "loot", label: "ロット管理", segment: "loot", Icon: Dice5 },
  { id: "strategy", label: "攻略情報", segment: "strategy", Icon: BookOpen },
  { id: "videos", label: "動画", segment: "videos", Icon: Film },
];

export function SubTabs({ baseHref }: { baseHref: string }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="カテゴリー内ナビゲーション"
      className="border-border/40 border-b"
    >
      <div className="mx-auto max-w-6xl px-2 sm:px-6">
        <ul className="flex gap-1 overflow-x-auto py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {SUB_TABS.map((tab) => {
            const href = `${baseHref}/${tab.segment}`;
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <li key={tab.id} className="shrink-0">
                <Link
                  href={href}
                  data-active={active}
                  className={cn(
                    "relative flex items-center gap-2 rounded-md px-3 py-1.5 font-mono text-[11px] tracking-[0.14em] uppercase transition-colors",
                    active
                      ? "bg-secondary/60 text-foreground"
                      : "text-muted-foreground hover:bg-secondary/40 hover:text-foreground/90",
                  )}
                  aria-current={active ? "page" : undefined}
                >
                  <tab.Icon
                    className={cn(
                      "h-3.5 w-3.5",
                      active
                        ? "text-[var(--neon-violet)]"
                        : "text-muted-foreground/80",
                    )}
                    aria-hidden
                  />
                  <span>{tab.label}</span>
                  {active && (
                    <motion.span
                      layoutId="sub-tab-underline"
                      transition={{ type: "spring", bounce: 0.2, duration: 0.4 }}
                      className="absolute right-1.5 -bottom-[7px] left-1.5 h-px bg-[var(--neon-violet)] shadow-[0_0_8px_var(--neon-violet)]"
                    />
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
