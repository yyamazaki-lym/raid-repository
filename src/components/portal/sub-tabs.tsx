"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import {
  ChevronLeft,
  Dice5,
  ShieldHalf,
  BookOpen,
  Film,
  Terminal,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ActionSlotTarget,
  useActionSlotContext,
} from "@/components/portal/action-slot";

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

// SUB_TABS の id をデフォルトラベルから引くため (form dialog でも参照)。
export const DEFAULT_SUB_TAB_LABELS: Record<string, string> = Object.fromEntries(
  SUB_TABS.map((t) => [t.id, t.label]),
);

type TabConfig = Record<string, { enabled?: boolean; label?: string | null }>;

export function SubTabs({
  baseHref,
  tabConfig,
}: {
  baseHref: string;
  /**
   * Phase 17 (2026-05-13): カテゴリごとの SubTabs 設定。enabled=false の
   * タブは描画から除外、label が非空なら表示名を上書き。未指定 key は
   * 「enabled=true, label はデフォルト」(後方互換)。
   */
  tabConfig?: TabConfig;
}) {
  const pathname = usePathname();
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const tabsListRef = useRef<HTMLUListElement | null>(null);
  const stuckRef = useRef(false);
  const [stuck, setStuck] = useState(false);
  // TODO #58: stuck 状態を ActionSlot context へ push し、各 page のアクション
  // ボタンを SubTabs 右端 portal target へ集約させる。Provider 不在時は無視。
  const slotCtx = useActionSlotContext();
  const setSlotStuck = slotCtx?.setStuck;

  // TODO #56 / #58: sentinel が sticky 行に達した瞬間 (= nav 貼り付き) に
  // collapsed 形へ切替える。IntersectionObserver の単一閾値だと、stuck 化で
  // nav 高が縮む (~6px) → 末端スクロール位置が clamp されて sentinel が
  // 再表示 → unstick → nav 高が戻る → sentinel 隠れる、の振動ループに
  // 入るケースがあった (コンテンツ高がビューポート高ぎりぎりの時)。
  // hysteresis: stick / unstick で異なる閾値を使い、振動を抑止する。
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const STICK_AT = 102; // sentinel.top < STICK_AT で stuck=true (MainTabs bottom + 1px)
    const UNSTICK_AT = 118; // sentinel.top > UNSTICK_AT で stuck=false (16px buffer)
    let raf = 0;
    const apply = (next: boolean) => {
      if (stuckRef.current === next) return;
      stuckRef.current = next;
      setStuck(next);
      setSlotStuck?.(next);
    };
    const check = () => {
      raf = 0;
      const top = sentinel.getBoundingClientRect().top;
      if (!stuckRef.current && top < STICK_AT) apply(true);
      else if (stuckRef.current && top > UNSTICK_AT) apply(false);
    };
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(check);
    };
    check();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [setSlotStuck]);

  // TODO #90 (2026-06-10): タブ列 (overflow-x-auto) は scrollLeft=0 始まり
  // のため、モバイル幅では右端寄りの active tab (動画 / マクロ) が初期表示で
  // 画面外に出る。active tab が可視範囲から見切れている時だけ scrollLeft を
  // 直接代入して中央へ寄せる (見えていれば no-op、overflow しない desktop も
  // no-op)。scrollIntoView は祖先の縦スクロールまで動かし、上の stuck/unstuck
  // hysteresis や Link onClick の window.scrollTo(top) と干渉しうるため使わない。
  useEffect(() => {
    const ul = tabsListRef.current;
    if (!ul) return;
    const el = ul.querySelector<HTMLElement>('[data-active="true"]');
    if (!el) return;
    const ulRect = ul.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    // ul コンテンツ座標系での active tab の位置 (offsetLeft は offsetParent が
    // sticky な nav になるため使わず、rect 差分 + 現 scrollLeft で求める)
    const leftInUl = elRect.left - ulRect.left + ul.scrollLeft;
    const clipped =
      leftInUl < ul.scrollLeft ||
      leftInUl + elRect.width > ul.scrollLeft + ul.clientWidth;
    if (clipped) {
      // scrollLeft 代入は範囲外の値を browser が自動 clamp する
      ul.scrollLeft = leftInUl - (ul.clientWidth - elRect.width) / 2;
    }
  }, [pathname]);

  return (
    <>
      <div ref={sentinelRef} aria-hidden className="h-px" />
      <nav
        aria-label="コンテンツ内ナビゲーション"
        data-stuck={stuck}
        className="glass-bar border-border/40 sticky top-[102px] z-15 border-b transition-[top] sm:top-[110px]"
      >
        <div className="mx-auto flex max-w-5xl items-center gap-1 px-2 sm:px-6">
          <ul
            ref={tabsListRef}
            className={cn(
              "flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
            )}
          >
            <li
              aria-hidden={!stuck}
              className={cn(
                "flex shrink-0 items-center overflow-hidden transition-all duration-200",
                stuck ? "max-w-[120px] opacity-100" : "pointer-events-none max-w-0 opacity-0",
              )}
            >
              <Link
                href="/category"
                tabIndex={stuck ? 0 : -1}
                className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 rounded-md px-2 py-1 font-mono text-[10px] tracking-[0.16em] uppercase whitespace-nowrap transition-colors"
              >
                <ChevronLeft className="h-3 w-3 shrink-0" aria-hidden />
                <span>Contents</span>
              </Link>
              <span className="border-border/40 mx-1 h-3 border-r" aria-hidden />
            </li>
            {SUB_TABS.map((tab) => {
              const cfg = tabConfig?.[tab.id];
              if (cfg?.enabled === false) return null;
              const labelOverride = cfg?.label?.trim();
              const label = labelOverride ? labelOverride : tab.label;
              const href = `${baseHref}/${tab.segment}`;
              const active = pathname === href || pathname.startsWith(`${href}/`);
              return (
                <li key={tab.id} className="shrink-0">
                  <Link
                    href={href}
                    data-active={active}
                    // TODO #58 part2 fix: Next.js 16 の Link デフォルト挙動は
                    // 「Page 要素が viewport 内に visible なら scroll 位置を保持」
                    // (sticky な MainTabs/SubTabs はバイパス判定の対象外)。
                    // sub-nav stuck (= ページ下方) で別 sub-tab に遷移した時、
                    // 新ページの main 上端が画面内に部分 visible → scroll 位置
                    // 維持で sub-nav が stuck 状態のまま再描画されてしまうため、
                    // タブ切替時のみ明示的に top へスクロールする。同タブクリック
                    // (active) では発火させない。
                    onClick={() => {
                      if (!active) window.scrollTo({ top: 0, behavior: "instant" });
                    }}
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
                    <span>{label}</span>
                    {active && (
                      <motion.span
                        layoutId="sub-tab-underline"
                        transition={{ type: "spring", bounce: 0.2, duration: 0.4 }}
                        className={cn(
                          "absolute -bottom-[3px] h-px bg-[var(--neon-violet)]",
                          stuck
                            ? "right-1 left-1 shadow-[0_0_4px_var(--neon-violet)]"
                            : "right-1.5 left-1.5 shadow-[0_0_8px_var(--neon-violet)]",
                        )}
                      />
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
          {/* TODO #58: stuck 時に各 page のアクションボタンが portal される
              右端スロット。ul (overflow-x-auto) の外に置き、tabs スクロール
              時もスロット内ボタンが常に visible になる構造。in-flow 時は空。
              videos page など複数ボタンが portal されるケースで mobile 幅
              を超えるため、mobile では max-w + overflow-x-auto で内部スクロール
              可能にする (sm 以上は通常 layout)。
              `[&>*]:!flex-nowrap` で portaled 直下子の flex-wrap を強制無効化、
              元 page で multi-row 折返ししていた action 群 (videos の 5 ボタン)
              も stuck 時は単一行 + 内部横スクロールに正規化する。 */}
          <ActionSlotTarget className="flex shrink-0 items-center gap-1 max-w-[60vw] overflow-x-auto [scrollbar-width:none] sm:max-w-none [&::-webkit-scrollbar]:hidden [&>*]:!flex-nowrap [&>*]:shrink-0 [&>*>*]:shrink-0" />
        </div>
      </nav>
    </>
  );
}
