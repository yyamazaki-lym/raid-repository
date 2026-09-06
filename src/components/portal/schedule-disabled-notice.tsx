import { CalendarOff } from "lucide-react";
import { Card } from "@/components/ui/card";
import { getMessages } from "@/lib/i18n/server";

/**
 * `schedule_source_mode='disabled'` のときに schedule top で表示する
 * 機能停止 notice (TODO #2 phase 1, 2026-05-07)。
 *
 * mode 切替は admin が settings dialog から行う想定なので、ここでは
 * onboarding のような入力 UI は持たず、「停止中」+ 設定 dialog への
 * 案内のみのシンプル表示にとどめる。
 */
export async function ScheduleDisabledNotice() {
  const m = await getMessages();
  return (
    <Card className="glass flex flex-col gap-3 p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-border/40 bg-background/40 text-muted-foreground">
          <CalendarOff className="h-4 w-4" aria-hidden />
        </span>
        <div className="flex flex-col gap-0.5">
          <h2 className="font-display text-base tracking-[0.16em] uppercase">
            {m.disabledNotice.title}
          </h2>
          <p className="text-muted-foreground text-xs leading-relaxed">
            {m.disabledNotice.line1}
            <br />
            {m.disabledNotice.line2Prefix}
            <strong>{m.disabledNotice.line2Settings}</strong>
            {m.disabledNotice.line2Middle}
            <code>{m.disabledNotice.line2Sync}</code>
            {m.disabledNotice.line2Or}
            <code>{m.disabledNotice.line2Native}</code>
            {m.disabledNotice.line2Suffix}
          </p>
        </div>
      </div>
    </Card>
  );
}
