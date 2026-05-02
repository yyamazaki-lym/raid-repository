"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * TODO #65 (2.1, 2026-05-02): controlled-open helper for Base UI
 * `Menu.Root` (= our `DropdownMenu`).
 *
 * Default Base UI menus are modal — they lock document scroll while
 * open, which traps users on a long schedule list when they tap the
 * Film / Logs trigger. We want:
 *   1. `modal={false}` so the page keeps scrolling normally
 *   2. close the menu on document scroll so the popup doesn't drift
 *      over content the user is now reading
 *
 * Returns a `bind` object that spreads into `<DropdownMenu {...bind}>`
 * along with `modal: false`. Caller controls nothing else.
 *
 * Implementation notes:
 * - 150ms grace period before scroll-close arms. Scroll events fired
 *   during the open animation (focus scroll-into-view, mid-touch on
 *   mobile) would otherwise close the menu the moment it appeared.
 * - 400ms re-open lock after a scroll-triggered close. Defensive
 *   guard against a Base UI / React 19 race that could re-issue
 *   `onOpenChange(true)` mid-close. Production debug logging
 *   (PR #21, removed in PR #22) confirmed the actual flicker root
 *   cause was CSS exit-transition (data-closed:fade-out + animate-out
 *   rebound during the 100ms duration), fixed in dropdown-menu.tsx
 *   by removing the data-closed:* classes. The lock is kept as a
 *   harmless guard.
 */
export function useScrollClosingMenu() {
  const [open, setOpen] = useState(false);
  const reopenLockedUntilRef = useRef(0);
  useEffect(() => {
    if (!open) return;
    let armed = false;
    const arm = setTimeout(() => {
      armed = true;
    }, 150);
    const close = () => {
      if (!armed) return;
      reopenLockedUntilRef.current = Date.now() + 400;
      setOpen(false);
    };
    window.addEventListener("scroll", close, { passive: true });
    return () => {
      clearTimeout(arm);
      window.removeEventListener("scroll", close);
    };
  }, [open]);
  const onOpenChange = useCallback((next: boolean) => {
    if (next && Date.now() < reopenLockedUntilRef.current) return;
    setOpen(next);
  }, []);
  return { open, onOpenChange, modal: false as const };
}
