"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarRange, Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { setNativeScheduleRecurringDowsAction } from "@/lib/server/native-schedule-actions";
import {
  describeRecurringDows,
  dowLabel,
  parseRecurringDows,
} from "@/lib/schedule/recurring-frames";
import { useLocale, useMessages } from "@/lib/i18n/client";

/**
 * 定期枠 (W-15、2026-09-08)。
 *
 * 「うちは毎週 火・木・土」を 1 度決めておくと、
 *   - 候補日の自動敷設が**その曜日だけ**になる (`ensureNativeMonthlyPlaceholders`)
 *   - 候補日ダイアログの「繰り返し」で曜日が最初から入る
 *   - 予定表で枠から外れた日に「臨時」「今回だけ」が付く
 *
 * 曜日を 1 つも選ばない = **定期枠なし**で、従来どおり当月の全日付が候補に
 * なる。「0 件の枠」と解釈して候補日を 1 つも作らない挙動にすると、設定を
 * いじった瞬間に予定表が空になり、候補日が無いので戻す導線も消える
 * (`recurring-frames.ts` の docstring)。
 *
 * ⚠ 保存しても**既にある候補日は消えない**。消すと、その日に入っていた
 * 出欠やメモまで巻き添えになるため。要らない日は従来どおり status を中止に
 * する (取り消した日の一覧はこの下の節にある)。
 */
export function NativeRecurringFrameSection({
  canEdit,
  loaded,
  recurringDows,
  onChanged,
}: {
  canEdit: boolean;
  loaded: boolean;
  /** `app_settings.native_schedule_recurring_dows` の生の値 (CSV)。 */
  recurringDows: string | null;
  onChanged: () => void;
}) {
  const router = useRouter();
  const m = useMessages();
  const locale = useLocale();
  const [pending, startTransition] = useTransition();
  const saved = parseRecurringDows(recurringDows);
  const [draft, setDraft] = useState<number[]>(saved);

  // 親からの最新値で draft を同期 (他の節と同じ「親 prop → 子 useState」)。
  useEffect(() => {
    if (loaded) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDraft(parseRecurringDows(recurringDows));
    }
  }, [recurringDows, loaded]);

  const dirty = draft.join(",") !== saved.join(",");
  const summary = describeRecurringDows(draft, locale);

  const onSave = () => {
    startTransition(async () => {
      const r = await setNativeScheduleRecurringDowsAction(draft);
      if (!r.ok) {
        toast.error(r.reason);
        return;
      }
      toast.success(
        summary
          ? m.nativeRecurring.toastSaved(summary)
          : m.nativeRecurring.toastCleared,
      );
      onChanged();
      router.refresh();
    });
  };

  return (
    <section className="flex flex-col gap-3">
      <header className="flex items-center gap-2 border-b border-border/30 pb-2">
        <CalendarRange className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
        <span className="font-mono text-[11px] tracking-[0.22em] text-muted-foreground uppercase">
          Recurring Slot
        </span>
      </header>

      <p className="text-[12px] leading-relaxed text-muted-foreground">
        {m.nativeRecurring.description}
      </p>

      <div
        role="group"
        aria-label={m.nativeRecurring.dowAria}
        className="flex flex-wrap gap-1"
      >
        {[0, 1, 2, 3, 4, 5, 6].map((d) => {
          const on = draft.includes(d);
          return (
            <button
              key={d}
              type="button"
              disabled={!canEdit || pending}
              onClick={() =>
                setDraft((cur) =>
                  cur.includes(d)
                    ? cur.filter((x) => x !== d)
                    : [...cur, d].sort((a, b) => a - b),
                )
              }
              aria-pressed={on}
              className={
                // en は "Tue" と 3 文字になるので幅は min-w + padding で持つ
                // (固定 w-8 だと英語表示で文字が溢れる)。
                "h-8 min-w-8 rounded-md border px-2 font-mono text-[12px] transition-colors disabled:opacity-50 " +
                (on
                  ? "border-[var(--neon-cyan)]/60 bg-[var(--neon-cyan)]/12 text-[var(--neon-cyan)]"
                  : "border-border/50 text-muted-foreground hover:text-foreground")
              }
            >
              {dowLabel(d, locale)}
            </button>
          );
        })}
      </div>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {summary
          ? m.nativeRecurring.currentEvery(summary)
          : m.nativeRecurring.currentNone}
      </p>
      <p className="text-[11px] leading-relaxed text-muted-foreground/80">
        {m.nativeRecurring.keepsExisting}
      </p>

      {canEdit && (
        <Button
          type="button"
          size="sm"
          onClick={onSave}
          disabled={!dirty || pending}
          className="w-fit gap-1.5 text-[11px] tracking-normal"
        >
          {pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <Save className="h-3.5 w-3.5" aria-hidden />
          )}
          {pending ? m.common.saving : m.common.save}
        </Button>
      )}
    </section>
  );
}
