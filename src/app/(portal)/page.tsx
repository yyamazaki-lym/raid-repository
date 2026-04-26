import { ExternalLink } from "lucide-react";
import { NextSessionCard } from "@/components/portal/next-session-card";
import { ScheduleList } from "@/components/portal/schedule-list";
import {
  fetchSchedule,
  pickNextDecision,
} from "@/lib/schedule/next-session";

export const metadata = {
  title: "スケジュール",
};

export default async function SchedulePage() {
  const url = process.env.NEXT_PUBLIC_SCHEDULE_URL;
  // Single fetch — `pickNextDecision` derives the next-session card from the
  // same payload, so we hit the upstream once per revalidation window.
  const result = await fetchSchedule();
  const nextResult = result.ok
    ? ({ ok: true, session: pickNextDecision(result.data.sessions) } as const)
    : ({ ok: false, reason: result.reason } as const);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl text-foreground sm:text-2xl">
            Schedule
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            外部スケジュールサイトから取得した日程一覧（10分キャッシュ）。
          </p>
        </div>
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 rounded-md border border-border/60 px-3 py-1.5 font-mono text-[11px] tracking-widest uppercase transition-colors hover:border-[var(--neon-cyan)]/60"
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            元サイトを開く
          </a>
        )}
      </div>

      <NextSessionCard result={nextResult} />

      <ScheduleList result={result} />
    </div>
  );
}
