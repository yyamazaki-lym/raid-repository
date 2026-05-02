"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * TODO #65 (2.1, 2026-05-02 part6 / part8): controlled-open helper for
 * Base UI `Menu.Root` (= our `DropdownMenu`).
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
 * - No capture phase. Capture-phase scroll listeners catch ANY nested
 *   scrollable element's scroll event (including the popup's own
 *   `overflow-y-auto` body and Base UI's Positioner / focus-restore
 *   internal scrolls), which caused a flicker right after open
 *   (popup fades in then immediately fades out). Listening on window
 *   without capture only catches the document's own scroll, which is
 *   what we actually care about.
 * - 150ms grace period after open. If scrolling started before the
 *   click reached the trigger (e.g. mid-touch on mobile, or focus
 *   scroll-into-view fires during enter animation), we'd close
 *   instantly. Skipping the first 150ms gives the user a moment to
 *   see the menu before any pending scroll closes it.
 * - 400ms re-open lock after a scroll-triggered close. Even with
 *   `disableAnchorTracking` on the Positioner (part7), production
 *   reproduced a 3-stage flicker: close → momentarily re-open →
 *   close. Something on the Base UI / React 19 side is requesting
 *   `onOpenChange(true)` mid-close (suspected: dismissal handler
 *   re-entry or concurrent-render re-commit). Ignoring `true` for
 *   400ms after a scroll-close kills the visible re-open without
 *   touching the Base UI internals.
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
