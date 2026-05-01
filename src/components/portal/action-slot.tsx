"use client";

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

// TODO #58: sub-nav stuck 時に各 page のアクションボタン群を SubTabs 右端へ
// portal で集約する基盤。Provider は category/[slug]/layout.tsx で SubTabs と
// children を包む。SubTabs が stuck 状態を push、各 page は <ActionSlot> で
// 子要素をラップ。stuck=false なら元位置に in-flow、stuck=true で createPortal。

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
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
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
