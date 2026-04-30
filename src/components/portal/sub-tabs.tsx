"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Dice5,
  ShieldHalf,
  BookOpen,
  Film,
  Terminal,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useActiveUnderline } from "@/lib/client/use-active-underline";

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
  // TODO #11 phase 8: framer-motion `layoutId` を撤廃し、親 <ul> 共有
  // underline を JS 計測 + CSS transition で実装。`bounce: 0.2` の質感は
  // ease-out に劣化するが 37 KB gz 削減のトレードオフを取る。
  const { containerRef, style } = useActiveUnderline(pathname);

  return (
    <nav
      aria-label="コンテンツ内ナビゲーション"
      className="border-border/40 border-b"
    >
      <div className="mx-auto max-w-5xl px-2 sm:px-6">
        <ul
          ref={containerRef}
          className="relative flex gap-1 overflow-x-auto py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
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
                    "relative flex items-center gap-1.5 rounded-md px-3 py-1.5 font-mono text-[11px] tracking-[0.16em] uppercase transition-colors",
                    active
                      ? "bg-secondary/60 text-foreground"
                      : "text-muted-foreground hover:bg-secondary/40 hover:text-foreground/90",
                  )}
                  aria-current={active ? "page" : undefined}
                >
                  <tab.Icon
                    className={cn(
                      "h-3.5 w-3.5 shrink-0 transition-colors",
                      active
                        ? "text-[var(--neon-violet)]"
                        : "text-muted-foreground/75",
                    )}
                    aria-hidden
                  />
                  <span>{tab.label}</span>
                </Link>
              </li>
            );
          })}
          {style && (
            <span
              aria-hidden
              className="pointer-events-none absolute bottom-1 h-px bg-[var(--neon-violet)] shadow-[0_0_8px_var(--neon-violet)] transition-[left,width] duration-[400ms] ease-out"
              style={{ left: style.left + 6, width: style.width - 12 }}
            />
          )}
        </ul>
      </div>
    </nav>
  );
}
