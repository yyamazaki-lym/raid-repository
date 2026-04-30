"use client";

import { useLayoutEffect, useRef, useState, type RefObject } from "react";

/**
 * Track an "active" descendant inside a container and return its left/width
 * so a parent-level underline can transition between positions via plain
 * CSS (`transition: left/width`). 旧 framer-motion `layoutId` の代替実装
 * (TODO #11 phase 8, 2.1, 2026-04-30)。
 *
 * 使い方:
 *   const { containerRef, style } = useActiveUnderline(pathname);
 *   <ul ref={containerRef as RefObject<HTMLUListElement>}>
 *     <li><Link data-active={...}>...</Link></li>
 *     ...
 *     {style && <span style={style} className="absolute ..." />}
 *   </ul>
 *
 * 検出: `[data-active="true"]` 属性を持つ最初の子孫要素。
 * 計測は `useLayoutEffect` で paint 前に確定 + ResizeObserver で
 * 親サイズ変化 / フォントロード後の再計算もカバー。
 *
 * inset 調整 (e.g. underline を tab の左右 6px 内側に置きたい) は
 * 呼び出し側で `style.left + 6, style.width - 12` 等で行う想定。
 */
export function useActiveUnderline(key: string): {
  containerRef: RefObject<HTMLUListElement | null>;
  style: { left: number; width: number } | null;
} {
  const containerRef = useRef<HTMLUListElement | null>(null);
  const [style, setStyle] = useState<{ left: number; width: number } | null>(
    null,
  );

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const update = () => {
      const active = container.querySelector<HTMLElement>(
        '[data-active="true"]',
      );
      if (!active) {
        setStyle(null);
        return;
      }
      const cRect = container.getBoundingClientRect();
      const aRect = active.getBoundingClientRect();
      setStyle({
        left: aRect.left - cRect.left,
        width: aRect.width,
      });
    };

    update();

    const ro = new ResizeObserver(update);
    ro.observe(container);
    // フォントロード等で個別 active タブの幅が変わるケースに備えて
    // 子孫すべてを監視するのは過剰なので、window resize だけ追加で
    // 拾う (タブ追加 / 削除は React 再 mount で key 変化により update)。
    window.addEventListener("resize", update);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [key]);

  return { containerRef, style };
}
