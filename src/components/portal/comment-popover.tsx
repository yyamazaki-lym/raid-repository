"use client";

import { useEffect, useRef, useState } from "react";
import { MessageSquareText } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type {
  ScheduleComment,
  ScheduleUser,
} from "@/lib/schedule/next-session";

/**
 * Per-user comment popover.
 *
 * - Hover-capable devices (desktop with mouse): mouseenter on the trigger
 *   opens; leaving both the trigger and the popup closes after a short grace
 *   period so the user can move from the icon to the popup contents without
 *   it disappearing.
 * - Touch devices: hover handlers are no-ops (matchMedia `hover: hover` is
 *   false) — falls back to the popover's default tap-to-toggle behavior.
 * - Click also works on both kinds of devices via the underlying Popover.
 */
export function CommentPopover({
  user,
  comments,
}: {
  user: ScheduleUser;
  comments: ScheduleComment[];
}) {
  const [open, setOpen] = useState(false);
  const [hoverEnabled, setHoverEnabled] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setHoverEnabled(window.matchMedia("(hover: hover)").matches);
  }, []);

  useEffect(() => {
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, []);

  const cancelClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  };

  const hoverProps = hoverEnabled
    ? {
        onMouseEnter: () => {
          cancelClose();
          setOpen(true);
        },
        onMouseLeave: scheduleClose,
      }
    : {};

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        {...hoverProps}
        className="inline-flex h-5 w-5 items-center justify-center rounded-sm border border-[var(--neon-cyan)]/40 bg-[var(--neon-cyan)]/8 text-[var(--neon-cyan)] transition-colors hover:bg-[var(--neon-cyan)]/15"
        aria-label={`${user.name} のコメントを表示`}
      >
        <MessageSquareText className="h-2.5 w-2.5" aria-hidden />
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="center"
        sideOffset={6}
        className="glass-popup w-72 max-w-[80vw] p-0"
        // Same hover semantics on the popup so moving the cursor onto the
        // content keeps it open.
        onMouseEnter={hoverEnabled ? cancelClose : undefined}
        onMouseLeave={hoverEnabled ? scheduleClose : undefined}
      >
        <div className="flex flex-col gap-1 p-3 text-left">
          <div className="flex items-center gap-1.5 border-b border-border/50 pb-1.5">
            <MessageSquareText
              className="h-3 w-3 text-[var(--neon-cyan)]"
              aria-hidden
            />
            <span className="font-mono text-[9px] tracking-[0.2em] text-muted-foreground uppercase">
              {user.name} の一言
            </span>
          </div>
          <ul className="flex flex-col gap-1.5 pt-1">
            {comments.map((c, idx) => (
              <li key={idx} className="flex flex-col gap-0.5">
                <p className="text-[11px] leading-relaxed text-foreground/95 whitespace-pre-wrap break-words">
                  {c.body || "—"}
                </p>
                {c.timestamp && (
                  <span className="font-mono text-[9px] text-muted-foreground">
                    {c.timestamp}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      </PopoverContent>
    </Popover>
  );
}
