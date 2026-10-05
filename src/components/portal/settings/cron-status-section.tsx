"use client";

import { useEffect, useState, useTransition } from "react";
import { Activity, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import {
  getCronStatusAction,
  setCronAlertEnabledAction,
} from "@/lib/server/cron-status-actions";
import {
  isCronDisabledBySetting,
  isCronStale,
  type CronJob,
  type CronStatus,
} from "@/lib/cron-status";
import { jstDateTimeString } from "@/lib/jst-date";
import { Button } from "@/components/ui/button";
import { useMessages } from "@/lib/i18n/client";
import { CollapsibleSection, SectionBadge } from "./collapsible-section";

/**
 * 自動処理 (cron) の最終実行と成否 (2026-10-01 監査 F-2)。admin のみ。
 *
 * 失敗が `console.warn` 止まりで、runtime logs は 1 時間しか残らないため、
 * token や cookie の失効、pg_cron の宛先違いは「静かに止まる」状態だった。
 * ジョブごとに最後の実行・結果・最後の失敗を出し、予定の間隔を過ぎても
 * 走っていないジョブには「止まっている可能性」を出す。
 *
 * 読み込みは logs-notify-section と同じ形 (L-3): 失敗しても節を無言で
 * 固めず、理由と「読み直す」を出す。
 */
export function CronStatusSection({
  open,
  canEdit,
}: {
  open: boolean;
  canEdit: boolean;
}) {
  const m = useMessages();
  const [pending, startTransition] = useTransition();
  const [loaded, setLoaded] = useState(false);
  // 読めなかったことだけを画面に出し、理由はトーストで出す (トーストは
  // 表示言語に訳される — 2026-10-01 監査 U-6)。
  const [loadFailed, setLoadFailed] = useState(false);
  const [jobs, setJobs] = useState<Array<{ job: CronJob; status: CronStatus | null }>>([]);
  const [alertEnabled, setAlertEnabled] = useState(false);
  const [alertChannelSet, setAlertChannelSet] = useState(true);
  const [nowMs, setNowMs] = useState(0);

  useEffect(() => {
    if (!open || !canEdit || loaded) return;
    let cancelled = false;
    void getCronStatusAction()
      .then((r) => {
        if (cancelled) return;
        setLoaded(true);
        if (!r.ok) {
          setLoadFailed(true);
          toast.error(r.reason);
          return;
        }
        setLoadFailed(false);
        setJobs(r.jobs);
        setAlertEnabled(r.alertEnabled);
        setAlertChannelSet(r.alertChannelSet);
        setNowMs(Date.parse(r.now));
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setLoaded(true);
        setLoadFailed(true);
        toast.error(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [open, canEdit, loaded]);

  if (!canEdit) return null;

  const failing = jobs.filter((j) => j.status?.outcome === "error").length;
  const stale = jobs.filter((j) => isCronStale(j.job, j.status, nowMs)).length;
  // 2026-10-05: 設定で止めている (既定 ON の) 処理。正常に見せない。
  const disabled = jobs.filter((j) => isCronDisabledBySetting(j.job, j.status)).length;
  const recorded = jobs.filter((j) => j.status !== null).length;

  const toggleAlert = (next: boolean) => {
    const prev = alertEnabled;
    setAlertEnabled(next);
    startTransition(async () => {
      const r = await setCronAlertEnabledAction(next);
      if (!r.ok) {
        setAlertEnabled(prev);
        toast.error(r.reason);
        return;
      }
      toast.success(next ? m.cronStatus.toastAlertOn : m.cronStatus.toastAlertOff);
    });
  };

  const fmt = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : jstDateTimeString(d);
  };

  return (
    <CollapsibleSection
      id="cron-status"
      icon={<Activity className="h-3.5 w-3.5 text-[var(--neon-cyan)]" aria-hidden />}
      title={m.cronStatus.title}
      badge={
        <SectionBadge
          state={
            !loaded
              ? "loading"
              : failing > 0 || stale > 0 || disabled > 0
                ? "off"
                : recorded > 0
                  ? "on"
                  : "off"
          }
        >
          {!loaded
            ? "…"
            : failing > 0
              ? m.cronStatus.badgeError(failing)
              : stale > 0
                ? m.cronStatus.badgeStale(stale)
                : disabled > 0
                  ? m.cronStatus.badgeDisabled(disabled)
                  : recorded > 0
                  ? m.cronStatus.badgeOk
                  : m.cronStatus.badgeEmpty}
        </SectionBadge>
      }
    >
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {m.cronStatus.description}
      </p>

      {loadFailed ? (
        <div className="flex flex-col gap-2 rounded-md border border-rose-400/40 bg-rose-400/5 px-3 py-2">
          <p className="text-[12px] leading-relaxed text-rose-100/90">
            {m.cronStatus.loadFailed}
          </p>
        </div>
      ) : null}

      <ul className="flex flex-col gap-1.5">
        {jobs.map(({ job, status }) => {
          const isStale = isCronStale(job, status, nowMs);
          const isDisabled = isCronDisabledBySetting(job, status);
          const tone =
            status?.outcome === "error"
              ? "border-rose-400/40 bg-rose-400/5"
              : isStale || isDisabled
                ? "border-amber-400/40 bg-amber-400/5"
                : "border-border/40 bg-secondary/15";
          return (
            <li key={job} className={"flex flex-col gap-0.5 rounded-md border px-3 py-2 " + tone}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                <span className="text-xs">{m.cronStatus.job(job)}</span>
                <span className="text-[11px] text-muted-foreground">
                  {m.cronStatus.schedule(job)}
                </span>
              </div>
              {status === null ? (
                <span className="text-[12px] text-muted-foreground">{m.cronStatus.never}</span>
              ) : (
                <>
                  <span className="text-[12px] text-muted-foreground tabular-nums">
                    {m.cronStatus.lastRun(fmt(status.at))} ·{" "}
                    <span
                      className={
                        status.outcome === "error"
                          ? "text-rose-300"
                          : status.outcome === "partial"
                            ? "text-amber-300"
                            : "text-foreground/85"
                      }
                    >
                      {m.cronStatus.outcome(status.outcome)}
                    </span>
                    {status.reason ? ` — ${status.reason}` : ""}
                  </span>
                  {status.consecutiveErrors > 1 ? (
                    <span className="text-[12px] text-rose-300">
                      {m.cronStatus.consecutive(status.consecutiveErrors)}
                    </span>
                  ) : null}
                  {status.outcome !== "error" && status.lastErrorAt ? (
                    <span className="text-[12px] text-muted-foreground/80 tabular-nums">
                      {m.cronStatus.lastError(fmt(status.lastErrorAt), status.lastErrorReason ?? "")}
                    </span>
                  ) : null}
                  {isStale ? (
                    <span className="text-[12px] text-amber-300">{m.cronStatus.stale}</span>
                  ) : null}
                  {isDisabled ? (
                    <span className="text-[12px] text-amber-300">
                      {m.cronStatus.disabledBySetting}
                    </span>
                  ) : null}
                </>
              )}
            </li>
          );
        })}
      </ul>

      <label className="flex cursor-pointer items-center justify-between gap-2 rounded-md border border-border/40 bg-secondary/15 px-3 py-2">
        <span className="flex min-w-0 flex-col">
          <span className="text-xs">{m.cronStatus.alertLabel}</span>
          <span className="text-[12px] leading-relaxed text-muted-foreground">
            {m.cronStatus.alertHint}
          </span>
          {alertEnabled && !alertChannelSet ? (
            <span className="text-[12px] leading-relaxed text-amber-300">
              {m.cronStatus.alertNoChannel}
            </span>
          ) : null}
        </span>
        <input
          type="checkbox"
          className="h-4 w-4 shrink-0 accent-[var(--neon-cyan)]"
          checked={alertEnabled}
          disabled={pending || !loaded || loadFailed}
          onChange={(e) => toggleAlert(e.target.checked)}
          aria-label={m.cronStatus.alertLabel}
        />
      </label>

      <div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending || !loaded}
          onClick={() => {
            setLoadFailed(false);
            setLoaded(false);
          }}
          className="gap-1.5 text-[11px] tracking-normal"
        >
          <RefreshCw className="h-3 w-3" aria-hidden />
          {m.cronStatus.reload}
        </Button>
      </div>
    </CollapsibleSection>
  );
}
