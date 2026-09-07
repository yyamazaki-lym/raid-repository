"use client";

import { useEffect, useState, useTransition } from "react";
import { BellRing, Save } from "lucide-react";
import { toast } from "sonner";
import {
  getLogsNotifySettingsAction,
  setLogsNotifyEnabledAction,
} from "@/lib/server/logs-notify-actions";
import { LOGS_NOTIFY_KINDS, type LogsNotifyKind } from "@/lib/logs-notify";
import {
  getFflogsGuildIdAction,
  setFflogsGuildIdAction,
} from "@/lib/server/fflogs-guild-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMessages } from "@/lib/i18n/client";

/**
 * 練習ログのイベント通知設定 (W-35、2026-09-07)。
 *
 * 同期のたびに「新レポート到着 / ベスト到達更新 / 初討伐」を Discord に
 * 流す。**全部既定 OFF** で、必要なものだけ ON にする (通知過多が調査ノート
 * 第 4 回 W-35 のデメリット欄そのもの)。
 *
 * 通知先は native スケジュール通知と同じチャンネル設定を使うので、ここには
 * チャンネルの入力欄を置かない。
 */
export function LogsNotifySection({
  open,
  canEdit,
}: {
  open: boolean;
  canEdit: boolean;
}) {
  const m = useMessages();
  const [pending, startTransition] = useTransition();
  const [loaded, setLoaded] = useState(false);
  const [enabled, setEnabled] = useState<Record<LogsNotifyKind, boolean>>({
    newReport: false,
    bestUpdate: false,
    firstClear: false,
  });

  // W-5 の前段 (2026-09-07): FFLogs guild ID。**まだ取り込みに使われない** —
  // guild からのレポート自動発見は「レポートを guild に上げる」運用に固定内で
  // 揃えてから実装する前提なので、先に記録場所だけを用意している。
  const [guildId, setGuildId] = useState("");
  const [guildSaved, setGuildSaved] = useState("");

  useEffect(() => {
    if (!open || !canEdit || loaded) return;
    let cancelled = false;
    void Promise.all([
      getLogsNotifySettingsAction(),
      getFflogsGuildIdAction(),
    ]).then(([notify, guild]) => {
      if (cancelled) return;
      setLoaded(true);
      if (notify.ok) setEnabled(notify.enabled);
      if (guild.ok) {
        setGuildId(guild.guildId);
        setGuildSaved(guild.guildId);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open, canEdit, loaded]);

  if (!canEdit) return null;

  const toggle = (kind: LogsNotifyKind, next: boolean) => {
    const prev = enabled[kind];
    setEnabled((cur) => ({ ...cur, [kind]: next }));
    startTransition(async () => {
      const r = await setLogsNotifyEnabledAction(kind, next);
      if (!r.ok) {
        setEnabled((cur) => ({ ...cur, [kind]: prev }));
        toast.error(r.reason);
        return;
      }
      toast.success(
        next
          ? m.logsNotify.toastOn(m.logsNotify.label(kind))
          : m.logsNotify.toastOff(m.logsNotify.label(kind)),
      );
    });
  };

  return (
    <section className="flex flex-col gap-2">
      <header className="flex items-center gap-2 border-b border-border/30 pb-2">
        <BellRing className="h-3.5 w-3.5 text-[var(--neon-cyan)]" aria-hidden />
        <span className="font-mono text-[11px] tracking-[0.22em] text-muted-foreground uppercase">
          {m.logsNotify.title}
        </span>
      </header>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {m.logsNotify.description}
      </p>
      <div className="flex flex-col gap-1.5">
        {LOGS_NOTIFY_KINDS.map((kind) => (
          <label
            key={kind}
            className="flex cursor-pointer items-center justify-between gap-2 rounded-md border border-border/40 bg-secondary/15 px-3 py-2"
          >
            <span className="flex min-w-0 flex-col">
              <span className="text-xs">{m.logsNotify.label(kind)}</span>
              <span className="text-[12px] leading-relaxed text-muted-foreground">
                {m.logsNotify.hint(kind)}
              </span>
            </span>
            <input
              type="checkbox"
              className="h-4 w-4 shrink-0 accent-[var(--neon-cyan)]"
              checked={enabled[kind]}
              disabled={pending || !loaded}
              onChange={(e) => toggle(kind, e.target.checked)}
              aria-label={m.logsNotify.label(kind)}
            />
          </label>
        ))}
      </div>
      <p className="text-[12px] leading-relaxed text-muted-foreground/80">
        {m.logsNotify.channelHint}
      </p>

      {/* W-5 の前段: FFLogs guild ID。取り込みでは未使用なので、期待させない
          よう UI にもその旨を明示する。 */}
      <div className="mt-1 flex flex-col gap-1.5 border-t border-border/30 pt-2">
        <Label htmlFor="fflogs-guild-id" className="text-xs text-foreground/80">
          {m.logsNotify.guildIdLabel}
        </Label>
        <div className="flex items-center gap-1.5">
          <Input
            id="fflogs-guild-id"
            value={guildId}
            inputMode="numeric"
            maxLength={12}
            placeholder={m.logsNotify.guildIdPlaceholder}
            disabled={pending || !loaded}
            onChange={(e) => setGuildId(e.target.value)}
            className="h-7 w-40 font-mono text-[12px]"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending || !loaded || guildId.trim() === guildSaved}
            onClick={() => {
              const next = guildId.trim();
              startTransition(async () => {
                const r = await setFflogsGuildIdAction(next);
                if (!r.ok) {
                  toast.error(r.reason);
                  return;
                }
                setGuildSaved(next);
                toast.success(m.logsNotify.guildIdSaved);
              });
            }}
            className="gap-1.5 text-[11px] tracking-normal"
          >
            <Save className="h-3 w-3" aria-hidden />
            {m.common.save}
          </Button>
        </div>
        <p className="text-[12px] leading-relaxed text-muted-foreground/80">
          {m.logsNotify.guildIdHint}
        </p>
      </div>
    </section>
  );
}
