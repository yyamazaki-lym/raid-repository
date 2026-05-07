"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Save } from "lucide-react";
import { toast } from "sonner";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { upsertNativeScheduleAttendanceAction } from "@/lib/server/native-schedule-actions";
import type { ScheduleAttendanceOptions } from "@/lib/schedule/parse";

/**
 * TODO #2 phase 2-B: native スケジュールの本人専用出欠入力 popover。
 *
 * 自分の出欠 cell click → 開く radio + textarea。`upsertNativeScheduleAttendanceAction`
 * (本人 only via RLS self-row policy) を呼んで symbol + comment を upsert する。
 * 空 symbol は server side で row delete (= 「未回答」状態に戻す)。
 *
 * **TODO #72 教訓** (popover DOM 残留 + focus restore outline):
 * - `<Popover open={open} onOpenChange={setOpen}>` controlled mode
 * - `{open && <PopoverContent ...>}` で React level controlled unmount (rapid 連続
 *   close 時の React 19 production batch race で `data-open` 属性が外れない問題を
 *   構造的に排除)
 * - `<PopoverContent finalFocus={false}>` で close 時の focus restore を無効化、
 *   `:focus-visible` outline ring が trigger に出るのを抑止
 *
 * 凡例マスター (`attendanceOptions.choices`) に `×` / `－` が含まれる前提で全 choices
 * を radio 表示。`×` 選択は不参加意思の明示、空文字列選択 (= 「未回答に戻す」) は
 * row delete。
 */

const SYMBOL_UNANSWERED = "" as const;

type Props = {
  /** native_schedule_sessions.id (uuid) */
  sessionId: string;
  /** 現在の出欠記号 (cell に表示されている値)。"-" なら未回答扱い。 */
  currentSymbol: string;
  /** 現在の comment (空なら "")。textarea 初期値復元用。 */
  currentComment: string;
  /**
   * 凡例マスター。`choices` 配列の symbol 群を radio 表示。
   * `source` は `"edit-page" | "fallback-from-list" | "unavailable"` で
   * native では `"unavailable"` は到達しないが互換のため許容。
   */
  attendanceOptions: ScheduleAttendanceOptions;
  /** Trigger ボタンに当てるクラス (schedule-list 側 ATT_TONE と一致させる)。 */
  triggerClass: string;
  /** aria-label / 表示名用。 */
  userName: string;
  /** 表示日 (rawDate の date 部分)。aria-label / toast 文言で使用。 */
  displayDate: string;
};

export function NativeAttendancePopover({
  sessionId,
  currentSymbol,
  currentComment,
  attendanceOptions,
  triggerClass,
  userName,
  displayDate,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // popover 内 form の local state。open=true 化時に props で初期化。
  const [draftSymbol, setDraftSymbol] = useState<string>(
    currentSymbol === "－" ? SYMBOL_UNANSWERED : currentSymbol,
  );
  const [draftComment, setDraftComment] = useState<string>(currentComment);
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  // open=true 化 (popover が開いた瞬間) に props で local state を再初期化。
  // 別のタイミングで他人の attendance が realtime 更新されたとき current* prop が
  // 変わっても、popover 開いている間は user 入力を上書きしない。
  useEffect(() => {
    if (open) {
      setDraftSymbol(currentSymbol === "－" ? SYMBOL_UNANSWERED : currentSymbol);
      setDraftComment(currentComment);
      setError(null);
    }
  }, [open, currentSymbol, currentComment]);

  const onSave = () => {
    setError(null);

    const trimmedComment = draftComment.trim();
    if (trimmedComment.length > 500) {
      setError("コメントは 500 文字以内で入力してください");
      return;
    }

    startTransition(async () => {
      const result = await upsertNativeScheduleAttendanceAction({
        sessionId,
        symbol: draftSymbol,
        comment: trimmedComment || undefined,
      });
      if (!result.ok) {
        setError(result.reason);
        return;
      }
      toast.success(
        draftSymbol === SYMBOL_UNANSWERED
          ? `${displayDate} の出欠を未回答に戻しました`
          : `${displayDate} の出欠を保存しました`,
      );
      setOpen(false);
      router.refresh();
    });
  };

  const onCancel = () => {
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={
          "inline-flex h-5 min-w-[1.75rem] items-center justify-center rounded-sm border px-1 text-[12px] leading-none transition-transform hover:scale-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--neon-cyan)]/60 " +
          triggerClass
        }
        aria-label={`${userName} ${displayDate} の出欠を編集`}
        title={`出欠を編集 (${userName})`}
      >
        {currentSymbol}
      </PopoverTrigger>
      {/* TODO #72 案 J: open=false 時に <PopoverContent> を React tree から完全除外。
          rapid 連続 close 時の React 19 batch race で data-open 属性が外れない問題を
          構造的に排除。詳細は comment-popover.tsx:145-152 を参照。 */}
      {open && (
        <PopoverContent
          side="bottom"
          align="center"
          sideOffset={6}
          className="glass-popup w-72 max-w-[80vw] p-0"
          // TODO #72 案 K3: close 時の focus restore を無効化。controlled mode では
          // Base UI 内部の openReason が triggerHover と認識されず focus management
          // が常時 enable になり、close 時に trigger へ programmatic focus が戻って
          // `:focus-visible` outline ring が visible になる問題の対策。
          finalFocus={false}
        >
          <div className="flex flex-col gap-3 p-3">
            <div className="flex items-center gap-1.5 border-b border-border/50 pb-1.5">
              <span className="font-mono text-[9px] tracking-[0.2em] text-muted-foreground uppercase">
                {userName} の出欠 — {displayDate}
              </span>
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase">
                参加状況
              </span>
              <div className="flex flex-wrap gap-1">
                {attendanceOptions.choices.map((sym) => (
                  <SymbolRadio
                    key={sym || "__empty"}
                    value={sym}
                    label={sym}
                    selected={draftSymbol === sym}
                    onSelect={() => setDraftSymbol(sym)}
                  />
                ))}
                <SymbolRadio
                  key="__unanswered"
                  value={SYMBOL_UNANSWERED}
                  label="未回答"
                  selected={draftSymbol === SYMBOL_UNANSWERED}
                  onSelect={() => setDraftSymbol(SYMBOL_UNANSWERED)}
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="native-att-comment"
                className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase"
              >
                コメント (任意)
              </label>
              <Textarea
                id="native-att-comment"
                value={draftComment}
                onChange={(e) => setDraftComment(e.target.value)}
                placeholder="例: 仕事次第、開始時刻 1h 遅れる可能性"
                rows={3}
                className="text-xs"
                spellCheck={false}
                maxLength={500}
              />
            </div>

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
                onClick={onCancel}
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

function SymbolRadio({
  value,
  label,
  selected,
  onSelect,
}: {
  value: string;
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={
        "inline-flex min-w-[2.4rem] items-center justify-center rounded-sm border px-2 py-1 font-mono text-[11px] tabular-nums leading-none transition-colors " +
        (selected
          ? "border-[var(--neon-cyan)]/70 bg-[var(--neon-cyan)]/15 text-[var(--neon-cyan)] shadow-[0_0_8px_-3px_var(--neon-cyan)]"
          : "border-border/60 bg-background/40 text-muted-foreground hover:border-[var(--neon-cyan)]/40 hover:text-foreground")
      }
      data-value={value}
    >
      {label}
    </button>
  );
}
