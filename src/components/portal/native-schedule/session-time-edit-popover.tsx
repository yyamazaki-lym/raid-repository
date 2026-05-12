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
import { updateNativeScheduleSessionTimeAction } from "@/lib/server/native-schedule-actions";

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
 * popover 構造は `native-attendance-popover.tsx` の TODO #72 教訓踏襲:
 *   - `<Popover open={open} onOpenChange={setOpen}>` controlled
 *   - `{open && <PopoverContent finalFocus={false}>}` で close 時 DOM 残留を回避
 */

const HHMM_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

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
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  // open=true 化時に props で local state を再初期化。
  useEffect(() => {
    if (open) {
      setDraftStart(overrideStart ?? defaultStartTime);
      setDraftEnd(overrideEnd ?? defaultEndTime);
      setError(null);
    }
  }, [open, overrideStart, overrideEnd, defaultStartTime, defaultEndTime]);

  const isOverridden = overrideStart !== null || overrideEnd !== null;

  const persist = (nextStart: string | null, nextEnd: string | null) => {
    setError(null);
    if (nextStart !== null && !HHMM_RE.test(nextStart)) {
      setError("開始時刻は HH:MM 形式で入力してください");
      return;
    }
    if (nextEnd !== null && !HHMM_RE.test(nextEnd)) {
      setError("終了時刻は HH:MM 形式で入力してください");
      return;
    }
    if (nextStart !== null && nextEnd !== null && nextStart === nextEnd) {
      setError("開始時刻と終了時刻が同じです");
      return;
    }
    startTransition(async () => {
      const result = await updateNativeScheduleSessionTimeAction({
        sessionId,
        startTime: nextStart,
        endTime: nextEnd,
      });
      if (!result.ok) {
        setError(result.reason);
        return;
      }
      toast.success(
        nextStart === null
          ? `${displayDate} の時刻を default に戻しました`
          : `${displayDate} の時刻を ${nextStart}〜${nextEnd} に変更しました`,
      );
      setOpen(false);
      router.refresh();
    });
  };

  const onSave = () => persist(draftStart, draftEnd);
  const onResetToDefault = () => persist(null, null);
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
