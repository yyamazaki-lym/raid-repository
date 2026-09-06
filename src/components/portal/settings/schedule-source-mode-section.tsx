"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarRange } from "lucide-react";
import { toast } from "sonner";
import { getScheduleSourceModeFromDb } from "@/lib/schedule-url-store";
import { setScheduleSourceModeAction } from "@/lib/server/categories-actions";
import type { ScheduleSourceMode } from "@/lib/schedule/source-mode";
import { useMessages } from "@/lib/i18n/client";
import type { Messages } from "@/lib/i18n/messages";

/**
 * TODO #2 phase 1 (2026-05-07): スケジュールソースモード選択 section。
 *
 * 3 択 radio:
 *   - sync     既存 character-sheets 同期式 (default)
 *   - native   自前作成式 (候補日 / 出欠 / 確定 / FFLogs / Discord 通知まで実装済)
 *   - disabled 機能無効
 *
 * 値変更で即時 server action を呼び、`router.refresh()` で page を再取得。
 * mode の永続化は他項目 (URL / channel ID 等) と独立に section 内で完結
 * させる方が UX が単純なので、settings-dialog の Save ボタンとは別経路。
 */
function buildModes(
  m: Messages,
): ReadonlyArray<{
  value: ScheduleSourceMode;
  label: string;
  description: string;
}> {
  const t = m.scheduleSourceMode;
  return [
    { value: "sync", label: t.syncLabel, description: t.syncDescription },
    { value: "native", label: t.nativeLabel, description: t.nativeDescription },
    {
      value: "disabled",
      label: t.disabledLabel,
      description: t.disabledDescription,
    },
  ];
}

export function ScheduleSourceModeSection({
  open,
  canEdit,
  onModeChange,
}: {
  open: boolean;
  canEdit: boolean;
  onModeChange?: (mode: ScheduleSourceMode) => void;
}) {
  const router = useRouter();
  const m = useMessages();
  const [mode, setMode] = useState<ScheduleSourceMode>("sync");
  const [loaded, setLoaded] = useState(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      const v = await getScheduleSourceModeFromDb();
      if (cancelled) return;
      if (v === "native" || v === "disabled" || v === "sync") {
        setMode(v);
        onModeChange?.(v);
      } else {
        setMode("sync");
        onModeChange?.("sync");
      }
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, onModeChange]);

  const onChange = (next: ScheduleSourceMode) => {
    if (next === mode) return;
    const prev = mode;
    setMode(next);
    onModeChange?.(next);
    startTransition(async () => {
      const result = await setScheduleSourceModeAction(next);
      if (!result.ok) {
        setMode(prev);
        onModeChange?.(prev);
        toast.error(m.scheduleSourceMode.toastSaveError(result.reason));
        return;
      }
      toast.success(m.scheduleSourceMode.toastSaved);
      router.refresh();
    });
  };

  return (
    <section className="flex flex-col gap-3">
      <header className="flex items-center gap-2 border-b border-border/30 pb-2">
        <CalendarRange
          className="h-3.5 w-3.5 text-muted-foreground"
          aria-hidden
        />
        <span className="font-mono text-[10px] tracking-[0.22em] text-muted-foreground uppercase">
          Schedule Source Mode
        </span>
      </header>

      <fieldset
        className="flex flex-col gap-1.5"
        disabled={!canEdit || !loaded || isPending}
      >
        <legend className="sr-only">{m.scheduleSourceMode.legend}</legend>
        {buildModes(m).map((opt) => {
          const checked = mode === opt.value;
          return (
            <label
              key={opt.value}
              className={
                "flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2 transition-colors " +
                (checked
                  ? "border-[var(--neon-cyan)]/50 bg-[var(--neon-cyan)]/5"
                  : "border-border/40 hover:border-border/70")
              }
            >
              <input
                type="radio"
                name="schedule-source-mode"
                value={opt.value}
                checked={checked}
                onChange={() => onChange(opt.value)}
                className="mt-1 accent-[var(--neon-cyan)]"
              />
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-foreground">{opt.label}</span>
                <span className="text-[10px] leading-relaxed text-muted-foreground">
                  {opt.description}
                </span>
              </div>
            </label>
          );
        })}
      </fieldset>
      {!canEdit && (
        <p className="text-[10px] text-muted-foreground/80">
          {m.scheduleSourceMode.adminRequired}
        </p>
      )}
    </section>
  );
}
