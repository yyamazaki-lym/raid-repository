import { CalendarOff } from "lucide-react";
import { Card } from "@/components/ui/card";

/**
 * `schedule_source_mode='disabled'` のときに schedule top で表示する
 * 機能停止 notice (TODO #2 phase 1, 2026-05-07)。
 *
 * mode 切替は admin が settings dialog から行う想定なので、ここでは
 * onboarding のような入力 UI は持たず、「停止中」+ 設定 dialog への
 * 案内のみのシンプル表示にとどめる。
 */
export function ScheduleDisabledNotice() {
  return (
    <Card className="glass flex flex-col gap-3 p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-border/40 bg-background/40 text-muted-foreground">
          <CalendarOff className="h-4 w-4" aria-hidden />
        </span>
        <div className="flex flex-col gap-0.5">
          <h2 className="font-display text-base tracking-[0.16em] uppercase">
            Schedule 機能停止中
          </h2>
          <p className="text-muted-foreground text-xs leading-relaxed">
            スケジュール機能は現在無効化されています。
            <br />
            再開するには、ヘッダー右上の <strong>設定</strong> ダイアログから
            ソースモードを <code>同期式</code> または <code>自前作成式</code>
            に切替えてください (ADMIN ロール必須)。
          </p>
        </div>
      </div>
    </Card>
  );
}
