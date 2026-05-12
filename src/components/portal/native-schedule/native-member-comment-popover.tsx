"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  MessageSquareText,
  Save,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { updateNativeScheduleMemberCommentAction } from "@/lib/server/native-schedule-actions";

/**
 * 2.1 (2026-05-12) PR3-D + follow-ups: native スケジュールのメンバー全体コメント
 * (同期式準拠で 1 メンバー = 1 行) を表示・編集する popover。
 *
 * 同期式 (`comment-popover.tsx`) と同じ hover-open + grace period パターン:
 * - desktop (`hover: hover`): trigger hover で popover open、trigger ↔ popup 移動
 *   猶予 120ms、両方から離脱で close
 * - touch: hover handlers no-op、tap で open
 * - click も常に動作 (Popover の controlled open)
 *
 * 親 (UserHeaderCell) から `open` / `onOpenChange` を渡すと controlled mode に
 * なり、名前 cell の click でも popover を開けるようになる。省略時は uncontrolled。
 *
 * 入力中の誤 close を防ぐため、textarea が focus を持っている間 (`isFocused`) と
 * server action 走行中 (`busy`) は hover close を抑止する。
 *
 * 本人 (`isOwn=true`) は popover 内で textarea + 保存 + クリア button で編集可能、
 * 他人 (`isOwn=false`) は popover 内で read-only 表示。
 *
 * popover 構造は TODO #72 教訓 (controlled unmount + finalFocus=false) を踏襲。
 */

type Props = {
  /** 現在のコメント (null / 空文字なら未入力)。 */
  currentComment: string | null;
  /** 表示名 (aria-label / popover header)。 */
  userName: string;
  /** true = 本人 cell (編集可能)、false = 他人 cell (read-only)。 */
  isOwn: boolean;
  /**
   * controlled mode の open 値。省略時は uncontrolled (内部 state)。親側で名前
   * cell click 等から popover を開きたいときに利用する。
   */
  open?: boolean;
  /** controlled mode の change handler。 */
  onOpenChange?: (open: boolean) => void;
};

export function NativeMemberCommentPopover({
  currentComment,
  userName,
  isOwn,
  open: openProp,
  onOpenChange,
}: Props) {
  const router = useRouter();
  const [openInner, setOpenInner] = useState(false);
  const open = openProp ?? openInner;
  const setOpen = (next: boolean) => {
    if (openProp === undefined) setOpenInner(next);
    onOpenChange?.(next);
  };

  const [hoverEnabled, setHoverEnabled] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [draft, setDraft] = useState<string>(currentComment ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();
  // 入力中 (textarea focus 中) は hover の自動 close を抑止する。
  const [isFocused, setIsFocused] = useState(false);

  // open=true 化時に props で local state を再初期化。
  useEffect(() => {
    if (open) {
      setDraft(currentComment ?? "");
      setError(null);
    }
  }, [open, currentComment]);

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
    // textarea focus 中 / server action 走行中は自動 close しない。
    if (isFocused || busy) return;
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  };

  // hover handlers (desktop のみ)。tap デバイスでは Popover の click open で動く。
  const hoverProps = hoverEnabled
    ? {
        onMouseEnter: () => {
          cancelClose();
          setOpen(true);
        },
        onMouseLeave: scheduleClose,
      }
    : {};

  const onSave = () => {
    setError(null);
    const trimmed = draft.trim();
    if (trimmed.length > 500) {
      setError("コメントは 500 文字以内で入力してください");
      return;
    }
    startTransition(async () => {
      const result = await updateNativeScheduleMemberCommentAction({
        comment: trimmed || null,
      });
      if (!result.ok) {
        setError(result.reason);
        return;
      }
      toast.success(
        trimmed
          ? "コメントを保存しました"
          : "コメントを削除しました",
      );
      setOpen(false);
      router.refresh();
    });
  };

  const onClear = () => {
    setDraft("");
  };

  const hasComment = !!currentComment && currentComment.trim().length > 0;

  // 同期式の CommentPopover と同じ trigger デザイン (cyan / 5×5 / MessageSquareText icon)。
  // 本人 cell でコメントなしのときだけ「outline-only」風に薄く出して「追加できる」hint。
  const triggerClass = hasComment
    ? "inline-flex h-5 w-5 items-center justify-center rounded-sm border border-[var(--neon-cyan)]/40 bg-[var(--neon-cyan)]/8 text-[var(--neon-cyan)] transition-colors hover:bg-[var(--neon-cyan)]/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--neon-cyan)]/60"
    : "inline-flex h-5 w-5 items-center justify-center rounded-sm border border-border/40 bg-transparent text-muted-foreground/50 transition-colors hover:bg-secondary/40 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--neon-cyan)]/60";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        {...hoverProps}
        className={triggerClass}
        aria-label={
          isOwn
            ? `${userName} のコメントを編集`
            : `${userName} のコメントを表示`
        }
        title={
          hasComment
            ? `${userName} のコメント`
            : isOwn
              ? "コメントを追加"
              : undefined
        }
      >
        <MessageSquareText className="h-2.5 w-2.5" aria-hidden />
      </PopoverTrigger>
      {open && (
        <PopoverContent
          side="bottom"
          align="center"
          sideOffset={6}
          className="glass-popup w-72 max-w-[80vw] p-0"
          finalFocus={false}
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
                {userName} のコメント
              </span>
            </div>

            {isOwn ? (
              <>
                <Textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onFocus={() => setIsFocused(true)}
                  onBlur={() => setIsFocused(false)}
                  placeholder="例: 仕事次第、開始時刻 1h 遅れる可能性"
                  rows={3}
                  className="mt-1 text-xs"
                  spellCheck={false}
                  maxLength={500}
                  disabled={busy}
                />

                {error && (
                  <div className="mt-1 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1.5 text-[11px] text-destructive-foreground/90">
                    <AlertTriangle
                      className="mt-0.5 h-3 w-3 shrink-0 text-destructive"
                      aria-hidden
                    />
                    <span>{error}</span>
                  </div>
                )}

                <div className="mt-2 flex items-center justify-end gap-1.5 border-t border-border/40 pt-2">
                  {hasComment && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={onClear}
                      disabled={busy || !draft}
                      className="gap-1 font-mono text-[10px] tracking-[0.18em] uppercase"
                      title="textarea をクリア (保存すると DB から削除)"
                    >
                      <Trash2 className="h-3 w-3" aria-hidden />
                      クリア
                    </Button>
                  )}
                  <div className="flex-1" />
                  <Button
                    type="button"
                    size="sm"
                    onClick={onSave}
                    disabled={busy}
                    className="gap-1 font-mono text-[10px] tracking-[0.18em] uppercase"
                  >
                    <Save className="h-3 w-3" aria-hidden />
                    {busy ? "保存中..." : "保存"}
                  </Button>
                </div>
              </>
            ) : (
              <p className="pt-1 text-[11px] leading-relaxed text-foreground/95 whitespace-pre-wrap break-words">
                {hasComment ? currentComment : "—"}
              </p>
            )}
          </div>
        </PopoverContent>
      )}
    </Popover>
  );
}
