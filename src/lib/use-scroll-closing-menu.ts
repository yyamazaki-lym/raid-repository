"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * TODO #65 (2.1, 2026-05-02 part6): controlled-open helper for Base UI
 * `Menu.Root` (= our `DropdownMenu`).
 *
 * Default Base UI menus are modal — they lock document scroll while
 * open, which traps users on a long schedule list when they tap the
 * Film / Logs trigger. We want:
 *   1. `modal={false}` so the page keeps scrolling normally
 *   2. close the menu on the first scroll event so the popup doesn't
 *      drift over content the user is now reading
 *
 * Returns a `bind` object that spreads into `<DropdownMenu {...bind}>`
 * along with `modal: false`. Caller controls nothing else.
 */
export function useScrollClosingMenu() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    // Capture-phase so nested scroll containers also trigger the
    // close — the popup itself doesn't scroll long enough to fire its
    // own scroll event in this codebase, so this is safe.
    window.addEventListener("scroll", close, {
      passive: true,
      capture: true,
    });
    return () => {
      window.removeEventListener("scroll", close, { capture: true });
    };
  }, [open]);
  const onOpenChange = useCallback((next: boolean) => setOpen(next), []);
  return { open, onOpenChange, modal: false as const };
}
