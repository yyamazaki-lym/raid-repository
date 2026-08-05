"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CalendarPlus, Loader2, Plus, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createNativeScheduleSessionAction } from "@/lib/server/native-schedule-actions";
import {
  FALLBACK_DEFAULT_END_TIME,
  FALLBACK_DEFAULT_START_TIME,
} from "@/lib/schedule/native-defaults";

/**
 * TODO #2 phase 2-B: admin が native スケジュールに候補日を追加する dialog。
 *
 * - trigger は ToggleButton 群と並列の 8x8 box icon (Plus)
 * - form: 日付 (`<input type="date">`) + 開始 / 終了時刻 (`<input type="time">`)
 *   + 備考 (任意 textarea)
 * - 曜日は date string から auto 算出 (`["日","月",...,"土"][getDay()]`)
 * - rawDate / parsedDate は sync 互換 format で組立て、`createNativeScheduleSessionAction`
 *   に渡す。同一 raw_date 重複 (PG 23505) は server action 側で「同じ日時の候補日が
 *   すでにあります」に変換済 ([native-schedule-actions.ts:72-74])
 * - 成功時 toast + dialog close + `router.refresh()`
 *
 * TODO #81 follow-up (2.6, 2026-06-10): 時刻初期値の hardcode を撤去し、
 * `app_settings.native_schedule_default_start_time` / `..._end_time` を
 * defaultStartTime / defaultEndTime props 経由で受け取って初期値にする。
 * props 未指定時は `FALLBACK_DEFAULT_*` (= 既存 hardcode 値 21:00 / 23:00)
 * に倒れる graceful degrade。
 */

const DOW_LABELS = ["日", "月", "火", "水", "木", "金", "土"] as const;

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

type CandidateDateDialogProps = {
  /**
   * `app_settings.native_schedule_default_start_time` の値。
   * 候補日追加時の開始時刻 input の初期値に使う。未指定 / 空 / 無効な
   * HH:MM 形式の場合は FALLBACK_DEFAULT_START_TIME ("21:00") にフォールバック。
   */
  defaultStartTime?: string | null;
  /**
   * `app_settings.native_schedule_default_end_time` の値。
   * 候補日追加時の終了時刻 input の初期値に使う。未指定 / 空 / 無効な
   * HH:MM 形式の場合は FALLBACK_DEFAULT_END_TIME ("23:00") にフォールバック。
   */
  defaultEndTime?: string | null;
};

const normalizeTime = (value: string | null | undefined, fallback: string) => {
  if (!value) return fallback;
  const trimmed = value.trim();
  if (!trimmed || !TIME_RE.test(trimmed)) return fallback;
  return trimmed;
};

export function CandidateDateDialog({
  defaultStartTime,
  defaultEndTime,
}: CandidateDateDialogProps = {}) {
  const initialStart = normalizeTime(defaultStartTime, FALLBACK_DEFAULT_START_TIME);
  const initialEnd = normalizeTime(defaultEndTime, FALLBACK_DEFAULT_END_TIME);

  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState(initialStart);
  const [endTime, setEndTime] = useState(initialEnd);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  // Reset on dialog open (新規追加 dialog なので、開くたびに blank に戻す)。
  // 時刻は app_settings default に追従するため、render 時に解決した値を再利用。
  useEffect(() => {
    if (open) {
      setDate("");
      setStartTime(initialStart);
      setEndTime(initialEnd);
      setNote("");
      setError(null);
    }
  }, [open, initialStart, initialEnd]);

  const onSubmit = () => {
    setError(null);

    const trimmedDate = date.trim();
    if (!trimmedDate) {
      setError("日付を入力してください");
      return;
    }
    const [y, m, d] = trimmedDate.split("-").map(Number);
    if (!y || !m || !d) {
      setError("日付の形式が正しくありません");
      return;
    }

    if (!TIME_RE.test(startTime) || !TIME_RE.test(endTime)) {
      setError("時刻は HH:MM 形式で入力してください");
      return;
    }
    const [sh, sm] = startTime.split(":").map(Number);
    const [eh, em] = endTime.split(":").map(Number);
    const startMinutes = sh * 60 + sm;
    const endMinutes = eh * 60 + em;
    // 終了時刻が開始時刻と同じ or 翌日 (eh < sh) は許容。
    // (例: 22:00~0:00 のような深夜またぎ運用がある)
    if (startMinutes === endMinutes) {
      setError("開始時刻と終了時刻が同じです");
      return;
    }

    // 曜日 auto 算出。`<input type="date">` の y/m/d は user 視点のカレンダー日付なので
    // local-TZ Date でその日付の getDay() を取ればユーザーが期待する曜日になる。
    const dayOfWeek = DOW_LABELS[new Date(y, m - 1, d).getDay()] ?? "日";

    // rawDate: sync 互換 format。`yyyy/MM/dd(曜) HH:MM~HH:MM`。
    // sync 側 RAW_DATE_RE は `\d{1,2}` で 1〜2 桁許容なので、ゼロパディングは
    // 統一感のために常時付ける (character-sheets demo は month/day を 2 桁で出すため)。
    const padded = (n: number) => String(n).padStart(2, "0");
    const rawDate = `${y}/${padded(m)}/${padded(d)}(${dayOfWeek}) ${startTime}~${endTime}`;

    // parsedDate: 開始時刻を JST で表した瞬間の UTC ISO string。
    // sync 側 parse.ts:434-444 と同じ式で組立てる。
    const parsedDate = new Date(
      Date.UTC(y, m - 1, d, sh, sm, 0, 0) - JST_OFFSET_MS,
    ).toISOString();

    startTransition(async () => {
      const result = await createNativeScheduleSessionAction({
        rawDate,
        parsedDate,
        startTime,
        endTime,
        dayOfWeek,
        note: note.trim() || undefined,
      });
      if (!result.ok) {
        setError(result.reason);
        return;
      }
      toast.success(`候補日「${rawDate}」を追加しました`);
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border/60 text-muted-foreground transition-colors hover:border-[var(--neon-cyan)]/60 hover:text-foreground"
        aria-label="候補日を追加"
        title="候補日を追加"
      >
        <Plus className="h-4 w-4" aria-hidden />
      </DialogTrigger>

      <DialogContent className="glass top-[8svh] max-w-[calc(100%-1.5rem)] translate-y-0 gap-0 p-0 sm:top-20 sm:max-w-md">
        <DialogHeader className="flex-row items-start gap-3 border-b border-border/40 p-5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-[var(--neon-cyan)]/40 bg-background/40 text-[var(--neon-cyan)] shadow-[0_0_18px_-6px_var(--neon-cyan)]">
            <CalendarPlus className="h-4 w-4" aria-hidden />
          </span>
          <div className="flex flex-col gap-0.5">
            <DialogTitle className="font-display text-base tracking-[0.16em] uppercase">
              候補日を追加
            </DialogTitle>
            <DialogDescription className="text-xs">
              スケジュールに新しい候補日を登録します
            </DialogDescription>
          </div>
        </DialogHeader>

        <div className="flex max-h-[70svh] flex-col gap-4 overflow-y-auto p-5">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="candidate-date" className="text-xs text-foreground/80">
              日付
            </Label>
            <Input
              id="candidate-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="font-mono text-[12px]"
              autoFocus
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-foreground/80">時刻</Label>
            <div className="flex items-center gap-2">
              <Input
                id="candidate-start"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-32 font-mono text-[12px]"
                aria-label="開始時刻"
              />
              <span className="text-xs text-muted-foreground">〜</span>
              <Input
                id="candidate-end"
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-32 font-mono text-[12px]"
                aria-label="終了時刻"
              />
            </div>
            <p className="text-muted-foreground text-[11px] leading-relaxed">
              JST 基準。深夜またぎ (例: <span className="whitespace-nowrap">22:00〜00:00</span>) も登録できます。
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="candidate-note" className="text-xs text-foreground/80">
              備考（任意）
            </Label>
            <Textarea
              id="candidate-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="例: アルカディア LH4 練習"
              rows={2}
              className="text-sm"
              spellCheck={false}
              maxLength={200}
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive-foreground/90">
              <AlertTriangle
                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive"
                aria-hidden
              />
              <span>{error}</span>
            </div>
          )}
        </div>

        <DialogFooter className="-mx-0 -mb-0 mt-0 flex-row items-center justify-end gap-2 rounded-b-xl border-t border-border/40 bg-secondary/30 p-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setOpen(false)}
            disabled={busy}
            className="text-[11px] tracking-normal"
          >
            キャンセル
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={onSubmit}
            disabled={busy}
            className="gap-1.5 text-[11px] tracking-normal"
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Save className="h-3.5 w-3.5" aria-hidden />
            )}
            {busy ? "保存中…" : "追加"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
