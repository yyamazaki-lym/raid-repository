"use client";

import { useEffect } from "react";
import { Trash2, X } from "lucide-react";
import type { ScheduleSessionMemo } from "@/lib/schedule-memos-client";

/**
 * Centered modal asking the user to confirm a memo deletion. Esc to
 * cancel, click-on-backdrop to cancel. Stops mousedown propagation on
 * the panel itself so the parent popover's outside-click handler
 * doesn't close the popover behind the modal.
 *
 * (session-memo-popover.tsx から分離、C-5)
 */
export function DeleteConfirmModal({
  memo,
  busy,
  onCancel,
  onConfirm,
}: {
  memo: ScheduleSessionMemo;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  // Truncate the memo body for the prompt — long memos shouldn't blow
  // out the modal, but a short preview confirms which one is being
  // deleted. 120 chars is enough for context without dominating.
  const preview =
    memo.body.length > 120 ? memo.body.slice(0, 120) + "…" : memo.body;

  return (
    // Transparent click-catcher — keeps the rest of the page fully
    // visible (no dim / blur), but still allows click-outside to
    // cancel and prevents accidental interaction with content
    // underneath while the dialog is up.
    <div
      role="dialog"
      aria-modal="true"
      aria-label="メモ削除の確認"
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          e.stopPropagation();
          onCancel();
        }
      }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="glass-popup w-full max-w-sm rounded-lg border border-rose-400/55 shadow-[0_16px_48px_-12px_rgba(244,63,94,0.4),0_4px_16px_-4px_rgba(0,0,0,0.5)]"
      >
        <header className="flex items-center gap-2 rounded-t-lg border-b border-rose-400/25 bg-rose-500/10 px-4 py-2.5">
          <Trash2 className="h-3.5 w-3.5 text-rose-300" aria-hidden />
          <p className="text-[11px] tracking-normal text-rose-200">
            メモを削除
          </p>
        </header>
        <div className="px-4 py-3">
          <p className="mb-2.5 rounded-md border border-border/40 bg-secondary/20 px-2.5 py-2 text-[12px] leading-relaxed whitespace-pre-wrap break-words text-foreground/85">
            {preview || (
              <span className="text-muted-foreground/70">（本文なし）</span>
            )}
          </p>
          <p className="mb-3 flex items-center gap-1 text-[10px] text-muted-foreground">
            <span
              aria-hidden
              className="inline-block h-1 w-1 rounded-full bg-rose-400/70"
            />
            この操作は元に戻せません
          </p>
          <div className="flex justify-end gap-1.5">
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-md border border-border/50 px-3 py-1.5 text-[10px] tracking-normal text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground disabled:opacity-50"
            >
              <X className="h-3 w-3" aria-hidden />
              キャンセル
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-md border border-rose-400/55 bg-rose-500/15 px-3 py-1.5 text-[10px] tracking-normal text-rose-100 transition-colors hover:border-rose-400/80 hover:bg-rose-500/25 disabled:opacity-50"
            >
              <Trash2 className="h-3 w-3" aria-hidden />
              削除
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
