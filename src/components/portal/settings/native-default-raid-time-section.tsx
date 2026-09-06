"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Clock, Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setNativeScheduleDefaultRaidTimeAction } from "@/lib/server/categories-actions";
import { useMessages } from "@/lib/i18n/client";

/**
 * TODO #81 (2.1, 2026-05-12) / TODO #85 (2.6, 2026-06-10): native 経路で
 * `ensureNativeMonthlyPlaceholders()` が auto-insert する placeholder row の
 * 開始 / 終了時刻のデフォルト値を編集する。
 *
 * - HH:MM input × 2。保存ボタン押下で `setNativeScheduleDefaultRaidTimeAction`。
 * - **TODO #85 (2.6)**: 保存時に未来日付 (JST 今日 0:00 以降) の placeholder
 *   行を新 default で自動的に遡及更新する。手動で同じ raw_date を追加済の
 *   候補日と衝突した場合は placeholder 側を削除して手動行を温存する。
 *   toast に「候補日 N 件を更新 / M 件を削除」を表示する。
 */

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

export function NativeDefaultRaidTimeSection({
  canEdit,
  loaded,
  defaultStartTime,
  defaultEndTime,
  onChanged,
}: {
  canEdit: boolean;
  loaded: boolean;
  defaultStartTime: string;
  defaultEndTime: string;
  onChanged: () => void;
}) {
  const router = useRouter();
  const m = useMessages();
  const [pending, startTransition] = useTransition();
  const [draftStart, setDraftStart] = useState(defaultStartTime);
  const [draftEnd, setDraftEnd] = useState(defaultEndTime);

  // 親からの最新値で draft を同期 (CRUD 後の reload も含む)。
  // 既存 NativeChoiceValuesSection / NativeDiscordNotifySection と同じ
  // 「親 prop → 子 useState」の同期パターン。
  useEffect(() => {
    if (loaded) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDraftStart(defaultStartTime);
       
      setDraftEnd(defaultEndTime);
    }
  }, [defaultStartTime, defaultEndTime, loaded]);

  const dirty =
    draftStart !== defaultStartTime || draftEnd !== defaultEndTime;
  const validStart = TIME_RE.test(draftStart);
  const validEnd = TIME_RE.test(draftEnd);
  const validRange = validStart && validEnd && draftStart !== draftEnd;

  const onSave = () => {
    if (!validRange) {
      toast.error(
        draftStart === draftEnd
          ? m.nativeRaidTime.errSameTime
          : m.nativeRaidTime.errFormat,
      );
      return;
    }
    startTransition(async () => {
      const r = await setNativeScheduleDefaultRaidTimeAction({
        startTime: draftStart,
        endTime: draftEnd,
      });
      if (!r.ok) {
        toast.error(r.reason);
        return;
      }
      // TODO #85 (2.6, 2026-06-10): 遡及更新の件数を toast に併記。
      // 0 件のときは詳細を省略し従来通り簡素に。M>0 (= 衝突で DELETE
      // が発生) のときは admin に衝突の発生を意識させる文言を付ける。
      const total = r.updatedCount + r.deletedCount;
      const detail =
        total === 0
          ? ""
          : m.nativeRaidTime.toastDetail(
              r.updatedCount,
              r.deletedCount > 0
                ? m.nativeRaidTime.toastDeleted(r.deletedCount)
                : "",
            );
      toast.success(m.nativeRaidTime.toastSaved(draftStart, draftEnd, detail));
      onChanged();
      router.refresh();
    });
  };

  return (
    <section className="flex flex-col gap-3">
      <header className="flex items-center gap-2 border-b border-border/30 pb-2">
        <Clock
          className="h-3.5 w-3.5 text-muted-foreground"
          aria-hidden
        />
        <span className="font-mono text-[10px] tracking-[0.22em] text-muted-foreground uppercase">
          Native Default Raid Time
        </span>
      </header>

      <p className="text-[10px] leading-relaxed text-muted-foreground">
        {m.nativeRaidTime.description}
      </p>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Input
            type="time"
            value={draftStart}
            onChange={(e) => setDraftStart(e.target.value)}
            disabled={!canEdit || !loaded || pending}
            className="h-7 w-32 font-mono text-[12px]"
            aria-label={m.nativeRaidTime.startAria}
          />
          <span className="text-xs text-muted-foreground">〜</span>
          <Input
            type="time"
            value={draftEnd}
            onChange={(e) => setDraftEnd(e.target.value)}
            disabled={!canEdit || !loaded || pending}
            className="h-7 w-32 font-mono text-[12px]"
            aria-label={m.nativeRaidTime.endAria}
          />
        </div>
        <p className="text-muted-foreground text-[10px] leading-relaxed">
          {m.nativeRaidTime.jstNoteBefore}{" "}
          <span className="whitespace-nowrap">22:00〜00:00</span>
          {m.nativeRaidTime.jstNoteAfter}
        </p>

        {canEdit && (
          <div className="flex items-center justify-end gap-1.5">
            <Button
              type="button"
              size="sm"
              disabled={!loaded || pending || !dirty || !validRange}
              onClick={onSave}
              className="h-7 gap-1 px-3 text-[10px] tracking-normal"
            >
              {pending ? (
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
              ) : (
                <Save className="h-3 w-3" aria-hidden />
              )}
              {m.common.save}
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
