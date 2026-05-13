"use client";

import { useEffect, useState } from "react";

/**
 * Phase 17 (2026-05-13): セクションの折りたたみ状態を localStorage と
 * 同期する hook。`raid-repo:` プレフィックスで他キーと衝突しないキー命名
 * (例: "raid-repo:strategy-section-collapsed:links") を呼び出し側で渡す。
 *
 * SSR 時は default を返し、mount 後に localStorage 値で上書きする (hydration
 * mismatch を避けるため初回 render は default 固定)。
 */
export function useCollapsible(
  storageKey: string,
  defaultCollapsed: boolean = false,
): [boolean, (next: boolean) => void] {
  const [collapsed, setCollapsedState] = useState<boolean>(defaultCollapsed);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored === "1") setCollapsedState(true);
      else if (stored === "0") setCollapsedState(false);
    } catch {
      // localStorage 不可 (privacy mode 等) は default のまま継続
    }
  }, [storageKey]);

  const setCollapsed = (next: boolean) => {
    setCollapsedState(next);
    try {
      window.localStorage.setItem(storageKey, next ? "1" : "0");
    } catch {
      // 書き込み不可は無視 (UI 上は state だけ変化)
    }
  };

  return [collapsed, setCollapsed];
}
