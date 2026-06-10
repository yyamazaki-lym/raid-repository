"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  updateNativeScheduleSessionNoteAction,
  updateNativeScheduleSessionTimeAction,
} from "@/lib/server/native-schedule-actions";

/**
 * 2.1 (2026-05-12): native スケジュールの日個別 raid time を admin が編集する popover。
 *
 * - default 時刻 (app_settings.native_schedule_default_*) を「現在の既定」として
 *   表示し、override されていない (= DB が NULL) row は default の文字列を
 *   placeholder 風に薄く出す。
 * - 入力が default と一致する or 両方 NULL = 「default に戻す」(`startTime: null,
 *   endTime: null` で UPDATE)。
 * - 入力が default と異なる string なら override (`startTime / endTime` 値で UPDATE)。
 *
 * 2.8 (2026-06-10) TODO #81 follow-up: 同 popover に note (備考) Textarea を
 * 追加。save 時に「時刻 diff だけ」「note diff だけ」「両方 diff」で対応する
 * action を呼び分け、無駄な UPDATE と revalidatePath を抑止。「default に戻す」
 * は時刻専用 (note は空文字保存で NULL 化、別経路)。
 *
 * popover 構造は `native-attendance-popover.tsx` の TODO #72 教訓踏襲:
 *   - `<Popover open={open} onOpenChange={setOpen}>` controlled
 *   - `{open && <PopoverContent finalFocus={false}>}` で close 時 DOM 残留を回避
 */

const HHMM_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const NOTE_MAX_LENGTH = 200;

type Props = {
  /** native_schedule_sessions.id (uuid) */
  sessionId: string;
  /** DB に保存されている override 値 (NULL = default 追従) */
  overrideStart: string | null;
  overrideEnd: string | null;
  /** app_settings の default 時刻 (HH:MM)。trigger 文言や placeholder 表示に使用。 */
  defaultStartTime: string;
  defaultEndTime: string;
  /** 表示日 (rawDate の date 部分)。aria-label / toast 文言で使用。 */
  displayDate: string;
  /**
   * 2.8 (2026-06-10) TODO #81 follow-up: 現在の note (NULL = 未設定)。
   * Textarea の初期値 + 「未変更時に action 呼ばない」差分判定に使う。
   */
  note?: string | null;
  /** trigger の追加クラス。schedule-list 側で色味を寄せたい場合用。 */
  triggerClass?: string;
};

export function SessionTimeEditPopover({
  sessionId,
  overrideStart,
  overrideEnd,
  defaultStartTime,
  defaultEndTime,
  displayDate,
  note = null,
  triggerClass = "",
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draftStart, setDraftStart] = useState<string>(
    overrideStart ?? defaultStartTime,
  );
  const [draftEnd, setDraftEnd] = useState<string>(
    overrideEnd ?? defaultEndTime,
  );
  const [draftNote, setDraftNote] = useState<string>(note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  // open=true 化時に props で local state を再初期化。
  useEffect(() => {
    if (open) {
      setDraftStart(overrideStart ?? defaultStartTime);
      setDraftEnd(overrideEnd ?? defaultEndTime);
      setDraftNote(note ?? "");
      setError(null);
    }
  }, [open, overrideStart, overrideEnd, defaultStartTime, defaultEndTime, note]);

  const isOverridden = overrideStart !== null || overrideEnd !== null;

  /**
   * 時刻 + note を Save する複合ハンドラ。
   * - time 差分あり → updateNativeScheduleSessionTimeAction
   * - note 差分あり → updateNativeScheduleSessionNoteAction
   * - 両方差分あり → 順次呼び出し (片方失敗で残りは skip して error 表示)
   * - 両方無差分 → 何もせず close
   */
  const onSave = () => {
    setError(null);

    // time validate
    if (!HHMM_RE.test(draftStart)) {
      setError("開始時刻は HH:MM 形式で入力してください");
      return;
    }
    if (!HHMM_RE.test(draftEnd)) {
      setError("終了時刻は HH:MM 形式で入力してください");
      return;
    }
    if (draftStart === draftEnd) {
      setError("開始時刻と終了時刻が同じです");
      return;
    }

    // note validate (長さは Textarea maxLength でも縛っているが二重 guard)
    const normalizedNote = draftNote.trim();
    if (normalizedNote.length > NOTE_MAX_LENGTH) {
      setError(`備考は ${NOTE_MAX_LENGTH} 文字以内で入力してください`);
      return;
    }
    const nextNote = normalizedNote || null;

    // diff 判定: 現在の DB 値と比較
    const currentDisplayStart = overrideStart ?? defaultStartTime;
    const currentDisplayEnd = overrideEnd ?? defaultEndTime;
    const timeChanged =
      draftStart !== currentDisplayStart || draftEnd !== currentDisplayEnd;
    const noteChanged = nextNote !== (note ?? null);

    if (!timeChanged && !noteChanged) {
      // 何も変わってないので action なしで close
      setOpen(false);
      return;
    }

    startTransition(async () => {
      if (timeChanged) {
        const r = await updateNativeScheduleSessionTimeAction({
          sessionId,
          startTime: draftStart,
          endTime: draftEnd,
        });
        if (!r.ok) {
          setError(r.reason);
          return;
        }
      }
      if (noteChanged) {
        const r = await updateNativeScheduleSessionNoteAction({
          sessionId,
          note: nextNote,
        });
        if (!r.ok) {
          setError(r.reason);
          return;
        }
      }
      const msgs: string[] = [];
      if (timeChanged) msgs.push(`時刻を ${draftStart}〜${draftEnd}`);
      if (noteChanged) {
        msgs.push(nextNote === null ? "備考をクリア" : "備考を更新");
      }
      toast.success(`${displayDate} の ${msgs.join(" / ")} に変更しました`);
      setOpen(false);
      router.refresh();
    });
  };

  /**
   * 「default に戻す」は時刻のみ対象 (note は空文字保存で別経路の NULL 化)。
   */
  const onResetToDefault = () => {
    setError(null);
    startTransition(async () => {
      const r = await updateNativeScheduleSessionTimeAction({
        sessionId,
        startTime: null,
        endTime: null,
      });
      if (!r.ok) {
        setError(r.reason);
        return;
      }
      toast.success(`${displayDate} の時刻を default に戻しました`);
      setOpen(false);
      router.refresh();
    });
  };

  const onCancel = () => setOpen(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={
          "inline-flex h-5 w-5 items-center justify-center rounded-sm border text-[10px] leading-none transition-colors hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--neon-cyan)]/60 " +
          (isOverridden
            ? "border-[var(--neon-cyan)]/50 bg-[var(--neon-cyan)]/10 text-[var(--neon-cyan)]"
            : "border-border/40 text-muted-foreground/70 hover:text-foreground ") +
          " " +
          triggerClass
        }
        aria-label={`${displayDate} の時刻を編集 (現在: ${
          isOverridden
            ? `${overrideStart ?? defaultStartTime}〜${overrideEnd ?? defaultEndTime} (override)`
            : `${defaultStartTime}〜${defaultEndTime} (default)`
        })`}
        title={
          isOverridden ? "個別時刻 (クリックで編集)" : "default 時刻 (クリックで個別変更)"
        }
      >
        <ClockIcon />
      </PopoverTrigger>
      {open && (
        <PopoverContent
          side="bottom"
          align="start"
          sideOffset={6}
          className="glass-popup w-72 max-w-[80vw] p-0"
          finalFocus={false}
        >
          <div className="flex flex-col gap-3 p-3">
            <div className="flex items-center gap-1.5 border-b border-border/50 pb-1.5">
              <span className="font-mono text-[9px] tracking-[0.2em] text-muted-foreground uppercase">
                {displayDate} の時刻
              </span>
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase">
                開始 / 終了
              </span>
              <div className="flex items-center gap-1.5">
                <Input
                  type="time"
                  value={draftStart}
                  onChange={(e) => setDraftStart(e.target.value)}
                  disabled={busy}
                  className="h-7 w-24 text-xs"
                />
                <span className="font-mono text-muted-foreground">〜</span>
                <Input
                  type="time"
                  value={draftEnd}
                  onChange={(e) => setDraftEnd(e.target.value)}
                  disabled={busy}
                  className="h-7 w-24 text-xs"
                />
              </div>
              <span className="text-[10px] text-muted-foreground/80">
                既定 (admin で変更): {defaultStartTime}〜{defaultEndTime}
                {isOverridden ? (
                  <span className="ml-1 text-[var(--neon-cyan)]">
                    (現在この日は個別 override)
                  </span>
                ) : null}
              </span>
            </div>

            {/* 2.8 (2026-06-10) TODO #81 follow-up: note Textarea。空文字で
                NULL 化 (= 備考削除)。CandidateDateDialog と同じ maxLength=200。 */}
            <div className="flex flex-col gap-1.5">
              <span className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase">
                備考
              </span>
              <Textarea
                value={draftNote}
                onChange={(e) => setDraftNote(e.target.value)}
                disabled={busy}
                rows={2}
                maxLength={NOTE_MAX_LENGTH}
                placeholder="例: アルカディア LH4 練習"
                spellCheck={false}
                className="text-sm"
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

            <div className="flex flex-wrap items-center justify-end gap-1.5 border-t border-border/40 pt-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onResetToDefault}
                disabled={busy || !isOverridden}
                className="gap-1 font-mono text-[10px] tracking-[0.18em] uppercase"
                title="この日の時刻を default に戻す"
              >
                <RotateCcw className="h-3 w-3" aria-hidden />
                既定に戻す
              </Button>
              <div className="flex-1" />
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

// lucide-react Clock icon は描画パスが重いので小さい inline SVG を使う。
function ClockIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3 w-3"
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}
