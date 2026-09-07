/**
 * 練習ログ: 取り込めなかったレポートの一覧。
 *
 * 2026-09-07 に `logs-view.tsx` から切り出した (#20)。分割の経緯と依存の
 * 向きは `./README.md` を参照。
 */
"use client";

import { humanizeFflogsSyncReason } from "@/lib/fflogs-sync-reason";
import { useMessages } from "@/lib/i18n/client";

export function FailedList({
  failedSyncs,
}: {
  failedSyncs: Array<{
    reportCode: string;
    reason: string | null;
    unassigned: boolean;
  }>;
}) {
  const m = useMessages();
  return (
    <section className="rounded-md border border-amber-400/30 bg-amber-400/5 px-3 py-2">
      <h3 className="font-mono text-[10px] tracking-[0.16em] text-amber-200 uppercase">
        {m.logs.failedTitle}
      </h3>
      <ul className="mt-1 flex flex-col gap-1">
        {failedSyncs.map((f) => (
          <li key={f.reportCode} className="text-[11px] leading-relaxed text-muted-foreground">
            <a
              href={`https://www.fflogs.com/reports/${encodeURIComponent(f.reportCode)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-amber-200/90 underline underline-offset-2 hover:text-amber-100"
            >
              {f.reportCode}
            </a>
            {f.unassigned && (
              <span className="ml-1.5 rounded-sm border border-border/50 px-1 py-0.5 font-mono text-[9px] tracking-[0.1em] uppercase">
                {m.logs.unassigned}
              </span>
            )}
            {f.reason ? (
              <span className="block pl-2">
                {humanizeFflogsSyncReason(f.reason)}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
