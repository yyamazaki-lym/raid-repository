"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

// TODO #58: sub-nav stuck 時に各 page のアクションボタン群を SubTabs 右端へ
// portal で集約する基盤。Provider は category/[slug]/layout.tsx で SubTabs と
// children を包む。SubTabs が stuck 状態を push、各 page は <ActionSlot> で
// 子要素をラップ。stuck=false なら元位置に in-flow、stuck=true で createPortal。
//
// part2 (2026-05-01): /category 一覧用に MainActionSlot 一式を追加。MainTabs
// 右端 portal target + 内部 sentinel + scroll listener で stuck 判定する別系統
// (SubTabs 用 ActionSlot とは独立した context)。
// あわせて、macro page 用に MirrorActionSlot を追加。stuck 時のみ portal target
// に「複製ボタン」を render し、元位置の in-flow ボタンはそのまま残す形。
// macros は量が少なく中途半端なスクロール位置で元ボタンが見える状態が起こり得るため。

type ActionSlotCtx = {
  stuck: boolean;
  setStuck: (v: boolean) => void;
  target: HTMLElement | null;
  setTarget: (el: HTMLElement | null) => void;
};

const Ctx = createContext<ActionSlotCtx | null>(null);

export function ActionSlotProvider({ children }: { children: ReactNode }) {
  const [stuck, setStuck] = useState(false);
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const value = useMemo<ActionSlotCtx>(
    () => ({ stuck, setStuck, target, setTarget }),
    [stuck, target],
  );
  return <Ctx value={value}>{children}</Ctx>;
}

export function useActionSlotContext() {
  return useContext(Ctx);
}

export function ActionSlotTarget({ className }: { className?: string }) {
  const ctx = useContext(Ctx);
  if (!ctx) return null;
  return <div ref={ctx.setTarget} className={className} />;
}

export function ActionSlot({ children }: { children: ReactNode }) {
  const ctx = useContext(Ctx);
  if (!ctx) return <>{children}</>;
  if (ctx.stuck && ctx.target) {
    return createPortal(<>{children}</>, ctx.target);
  }
  return <>{children}</>;
}

/**
 * stuck 時のみ portal target に children を render。in-flow に何も出さない。
 * 元位置の in-flow ボタンを別途並べた上で、stuck 時に同じハンドラの
 * 「複製ボタン」を上部 nav へ追加表示するのに使う (macro page 用)。
 */
export function MirrorActionSlot({ children }: { children: ReactNode }) {
  const ctx = useContext(Ctx);
  if (!ctx || !ctx.stuck || !ctx.target) return null;
  return createPortal(<>{children}</>, ctx.target);
}

// ---------- MainActionSlot (TODO #58 part2: /category 一覧用) ---------------

const MainCtx = createContext<ActionSlotCtx | null>(null);

export function MainActionSlotProvider({ children }: { children: ReactNode }) {
  const [stuck, setStuck] = useState(false);
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const value = useMemo<ActionSlotCtx>(
    () => ({ stuck, setStuck, target, setTarget }),
    [stuck, target],
  );
  return <MainCtx value={value}>{children}</MainCtx>;
}

export function MainActionSlotTarget({ className }: { className?: string }) {
  const ctx = useContext(MainCtx);
  if (!ctx) return null;
  return <div ref={ctx.setTarget} className={className} />;
}

/**
 * /category 一覧の Maintenance + 追加ボタンを MainTabs 右端へ追従表示する。
 * 内部に sentinel を持ち、scroll listener + hysteresis で MainTabs bottom 通過時に
 * stuck=true を context に push、stuck 時は createPortal で children を MainTabs
 * 右端 target へ移送、それ以外は in-flow render。
 *
 * stuck 閾値は MainTabs bottom (= --header-h + --nav-h) を getComputedStyle で
 * 算出し、breakpoint (sm で header 64) を resize で再計算する (F-3 / 監査 P3-k)。
 * SubTabs ActionSlot と同じ hysteresis パターン (UNSTICK = STICK + 16px) で振動を抑止。
 */
export function MainActionSlot({ children }: { children: ReactNode }) {
  const ctx = useContext(MainCtx);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const stuckRef = useRef(false);
  const setStuck = ctx?.setStuck;

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !setStuck) return;
    // F-3 / 監査 P3-k: MainTabs bottom (= --header-h + --nav-h) を globals.css の
    // CSS 変数から算出し、breakpoint (sm で header 64) を resize で再計算する。
    // 旧来の magic number (92 / 108) は header 高変更で無言ズレし、desktop では
    // 実通過位置 (110px) より早発火していた。CSS 変数が読めない環境は従来値に fallback。
    let STICK_AT = 102; // header 56 + nav 46
    let UNSTICK_AT = 118; // +16px buffer
    const recomputeThresholds = () => {
      const cs = getComputedStyle(document.documentElement);
      const px = (v: string) => parseFloat(cs.getPropertyValue(v)) * 16; // rem→px
      const h = px("--header-h") + px("--nav-h");
      if (Number.isFinite(h) && h > 0) {
        STICK_AT = h;
        UNSTICK_AT = h + 16;
      }
    };
    recomputeThresholds();
    let raf = 0;
    const apply = (next: boolean) => {
      if (stuckRef.current === next) return;
      stuckRef.current = next;
      setStuck(next);
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
    const onResize = () => {
      recomputeThresholds(); // breakpoint 跨ぎで header 高が変わるため再算出
      onScroll();
    };
    check();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [setStuck]);

  // unmount 時に stuck=false にリセット (ページ遷移で MainActionSlot を使わない
  // ページに移った時、portal target に残骸が残らないようにする)
  useEffect(() => {
    return () => {
      stuckRef.current = false;
      setStuck?.(false);
    };
  }, [setStuck]);

  if (!ctx) {
    return (
      <>
        <div ref={sentinelRef} aria-hidden className="h-px" />
        {children}
      </>
    );
  }
  return (
    <>
      <div ref={sentinelRef} aria-hidden className="h-px" />
      {ctx.stuck && ctx.target
        ? createPortal(<>{children}</>, ctx.target)
        : children}
    </>
  );
}
