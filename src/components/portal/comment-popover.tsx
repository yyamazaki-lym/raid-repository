"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import { useMessages } from "@/lib/i18n/client";

/**
 * 各ユーザーの「コメント変化検知」用 fingerprint。timestamp + body を
 * 連結した文字列。timestamp は character-sheets 側で秒単位まで含むので
 * 同一 body の再投稿も検出できる。
 */
function commentsFingerprint(comments: ScheduleComment[]): string {
  return comments
    .map((c) => `${c.timestamp ?? ""}::${c.body}`)
    .join("\n");
}

/** localStorage キー (user.userId 単位)。 */
function commentsSeenKey(userId: string): string {
  return `raid-portal:user-comment-seen:${userId}`;
}

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
 *
 * 1.9 (2026-04-28+) TODO #14: スケジュール取り込みで各人のコメントに更新が
 * あった場合、トリガーアイコンを amber でハイライト + 右上に dot 表示。
 * 「確認するまで継続」要件のため、popover を開いた瞬間に fingerprint を
 * localStorage に保存して highlight を解除する。初回表示 (stored が
 * null) の場合は「ノイズ抑制」のため silent baseline として現値を保存し
 * highlight しない — その後の変化のみ検出する。
 */
export function CommentPopover({
  user,
  comments,
}: {
  user: ScheduleUser;
  comments: ScheduleComment[];
}) {
  const m = useMessages();
  const [open, setOpen] = useState(false);
  const [hoverEnabled, setHoverEnabled] = useState(false);
  const [updated, setUpdated] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fingerprint = useMemo(
    () => commentsFingerprint(comments),
    [comments],
  );

  // Detect change vs last-seen on mount / fingerprint change. First
  // load (stored=null) silently writes the baseline so we don't show
  // a "new" badge for content the user has had since forever.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const key = commentsSeenKey(user.userId);
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(key);
    } catch {
      // localStorage unavailable (private mode etc.) — skip.
      return;
    }
    if (stored === null) {
      try {
        window.localStorage.setItem(key, fingerprint);
      } catch {
        /* noop */
      }
      setUpdated(false);
      return;
    }
    setUpdated(stored !== fingerprint);
  }, [fingerprint, user.userId]);

  // Mark as seen the moment the popover opens. Writing the current
  // fingerprint so any further sync without changes won't re-trigger
  // the highlight.
  useEffect(() => {
    if (!open) return;
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(commentsSeenKey(user.userId), fingerprint);
    } catch {
      /* noop */
    }
    setUpdated(false);
  }, [open, fingerprint, user.userId]);

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

  // 更新検知時 → amber 系で枠 / glow / 右上ドット表示。確認 (popover 開
  // 操作) で desaturate された通常 cyan 表示に戻る。`relative` を付ける
  // のはドットの absolute 位置決め用。
  const triggerClass = updated
    ? "relative inline-flex h-5 w-5 items-center justify-center rounded-sm border border-amber-300/70 bg-amber-300/15 text-amber-200 transition-colors hover:bg-amber-300/25 shadow-[0_0_8px_-2px_rgba(252,211,77,0.7)]"
    : "relative inline-flex h-5 w-5 items-center justify-center rounded-sm border border-[var(--neon-cyan)]/40 bg-[var(--neon-cyan)]/8 text-[var(--neon-cyan)] transition-colors hover:bg-[var(--neon-cyan)]/15";

  // TODO #72 案 J: open=false の時に <PopoverContent> を React tree から
  // 完全に除外する controlled unmount。観察 (demo 環境 rapid 連続 hover
  // 再現テスト, 2026-05-07) で「複数 Popover 同時 setOpen(false) 並行発火
  // 時に React 19 production batch race で `data-open` 属性が外れない」と
  // 真因確定。案 T (keepMounted) / 案 E (`[&:not([data-open])]:hidden`) は
  // どちらも「`data-open` が外れる」前提だったため両方失効。React レベル
  // で unmount すれば Base UI の `data-open` 属性更新に依存せず確実に
  // node が DOM から外れる。
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        {...hoverProps}
        className={triggerClass}
        aria-label={
          updated
            ? m.comment.updatedAria(user.name)
            : m.schedule.commentView(user.name)
        }
        title={updated ? m.comment.updatedTitle(user.name) : undefined}
      >
        <MessageSquareText className="h-2.5 w-2.5" aria-hidden />
        {updated && (
          <span
            aria-hidden
            className="pointer-events-none absolute -top-1 -right-1 inline-block h-1.5 w-1.5 rounded-full bg-amber-300 shadow-[0_0_6px_rgba(252,211,77,0.9)]"
          />
        )}
      </PopoverTrigger>
      {open && (
        <PopoverContent
          side="bottom"
          align="center"
          sideOffset={6}
          className="glass-popup w-72 max-w-[80vw] p-0"
          // TODO #72 案 K3: close 時の focus restore を無効化。Base UI Popover
          // は controlled mode (React 側 setOpen) では openReason を triggerHover
          // と認識できないため `FloatingFocusManager` が focus management を
          // disabled にしない (PopoverPopup.js:122 参照)。結果 close 時に trigger
          // に programmatic focus が戻り、`:focus-visible: true` で
          // `globals.css * { outline-ring/50 }` の auto outline が visible に
          // (= ユーザー報告の太い白枠)。`finalFocus={false}` で focus restore を
          // 無効化することで trigger に focus が戻らず ring が出ない。
          // a11y trade-off: click outside / escape close でも trigger に focus
          // 戻らないが、CommentPopover は装飾的トリガーで影響軽微。
          finalFocus={false}
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
              <span
                className="min-w-0 truncate text-[9px] tracking-normal text-muted-foreground"
                title={user.name}
              >
                {m.comment.quip(user.name)}
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
      )}
    </Popover>
  );
}
