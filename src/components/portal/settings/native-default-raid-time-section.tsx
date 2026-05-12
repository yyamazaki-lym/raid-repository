"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Clock, Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setNativeScheduleDefaultRaidTimeAction } from "@/lib/server/categories-actions";

/**
 * TODO #81 (2.1, 2026-05-12): native 経路で `ensureNativeMonthlyPlaceholders()`
 * が auto-insert する placeholder row の開始 / 終了時刻のデフォルト値を編集する。
 *
 * - HH:MM input × 2。保存ボタン押下で `setNativeScheduleDefaultRaidTimeAction`。
 * - 既存 placeholder の遡及更新は **しない** (server action 側コメント参照)。
 *   翌月分や月末閾値到達後に追加される新規 placeholder から新値が反映される。
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
          ? "開始時刻と終了時刻が同じです"
          : "時刻は HH:MM 形式で入力してください",
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
      toast.success(
        `デフォルト時刻を保存しました (${draftStart}〜${draftEnd})`,
      );
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
        当月日付の自動補完で使うレイド開始 / 終了時刻のデフォルト値。
        保存後に新しく自動追加される候補日 (翌月分など) から反映されます。
        既存の候補日は遡及更新されません。
      </p>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Input
            type="time"
            value={draftStart}
            onChange={(e) => setDraftStart(e.target.value)}
            disabled={!canEdit || !loaded || pending}
            className="w-32 font-mono text-[12px]"
            aria-label="開始時刻"
          />
          <span className="text-xs text-muted-foreground">〜</span>
          <Input
            type="time"
            value={draftEnd}
            onChange={(e) => setDraftEnd(e.target.value)}
            disabled={!canEdit || !loaded || pending}
            className="w-32 font-mono text-[12px]"
            aria-label="終了時刻"
          />
        </div>
        <p className="text-muted-foreground text-[10px] leading-relaxed">
          JST 基準。深夜またぎ (例: 22:00〜00:00) も登録できます。
        </p>

        {canEdit && (
          <div className="flex items-center justify-end gap-1.5">
            <Button
              type="button"
              size="sm"
              disabled={!loaded || pending || !dirty || !validRange}
              onClick={onSave}
              className="h-7 gap-1 px-3 text-[10px]"
            >
              {pending ? (
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
              ) : (
                <Save className="h-3 w-3" aria-hidden />
              )}
              保存
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
