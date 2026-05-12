"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, MessageSquare, Save } from "lucide-react";
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
 * 2.1 (2026-05-12) PR3-D: native スケジュールのメンバー全体コメント
 * (同期式準拠で 1 メンバー = 1 行) を本人が編集する popover。
 *
 * 名前ヘッダー cell の右側に MessageSquare icon を出し、click で popover を開く。
 * Textarea + 保存 button (500 文字以内、空文字列は NULL 正規化)。
 *
 * popover 構造は `native-attendance-popover.tsx` の TODO #72 教訓踏襲:
 *   - `<Popover open={open} onOpenChange={setOpen}>` controlled
 *   - `{open && <PopoverContent finalFocus={false}>}` で close 時 DOM 残留を回避
 */

type Props = {
  /** 現在のコメント (null / 空文字なら未入力)。Textarea 初期値復元用。 */
  currentComment: string | null;
  /** 表示名 (aria-label / popover header)。 */
  userName: string;
};

export function NativeMemberCommentPopover({ currentComment, userName }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string>(currentComment ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  // open=true 化時に props で local state を再初期化。
  useEffect(() => {
    if (open) {
      setDraft(currentComment ?? "");
      setError(null);
    }
  }, [open, currentComment]);

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

  const hasComment = !!currentComment && currentComment.trim().length > 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={
          "inline-flex h-4 w-4 items-center justify-center rounded-sm border text-[10px] leading-none transition-colors hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--neon-cyan)]/60 " +
          (hasComment
            ? "border-[var(--neon-cyan)]/50 bg-[var(--neon-cyan)]/10 text-[var(--neon-cyan)]"
            : "border-border/40 text-muted-foreground/60 hover:text-foreground")
        }
        aria-label={`${userName} のコメントを編集`}
        title={
          hasComment
            ? `現在のコメント: ${currentComment}`
            : "コメントを追加"
        }
      >
        <MessageSquare className="h-2.5 w-2.5" aria-hidden />
      </PopoverTrigger>
      {open && (
        <PopoverContent
          side="bottom"
          align="center"
          sideOffset={6}
          className="glass-popup w-72 max-w-[80vw] p-0"
          finalFocus={false}
        >
          <div className="flex flex-col gap-3 p-3">
            <div className="flex items-center gap-1.5 border-b border-border/50 pb-1.5">
              <span className="font-mono text-[9px] tracking-[0.2em] text-muted-foreground uppercase">
                {userName} のコメント
              </span>
            </div>

            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="例: 仕事次第、開始時刻 1h 遅れる可能性"
              rows={3}
              className="text-xs"
              spellCheck={false}
              maxLength={500}
              disabled={busy}
            />

            {error && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1.5 text-[11px] text-destructive-foreground/90">
                <AlertTriangle
                  className="mt-0.5 h-3 w-3 shrink-0 text-destructive"
                  aria-hidden
                />
                <span>{error}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-1.5 border-t border-border/40 pt-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setOpen(false)}
                disabled={busy}
                className="font-mono text-[10px] tracking-[0.18em] uppercase"
              >
                キャンセル
              </Button>
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
          </div>
        </PopoverContent>
      )}
    </Popover>
  );
}
