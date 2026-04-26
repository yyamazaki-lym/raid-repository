import Link from "next/link";
import { ExternalLink, Eye, EyeOff } from "lucide-react";
import { NextSessionCard } from "@/components/portal/next-session-card";
import { ScheduleList } from "@/components/portal/schedule-list";
import {
  fetchSchedule,
  pickNextDecision,
} from "@/lib/schedule/next-session";
import { getScheduleSourceUrl } from "@/lib/schedule/source-url";

export const metadata = {
  title: "スケジュール",
};

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ past?: string }>;
}) {
  // Resolve params + active URL + schedule data in parallel.
  const [sp, url, result] = await Promise.all([
    searchParams,
    getScheduleSourceUrl(),
    fetchSchedule(),
  ]);

  const showPast = sp.past === "1";
  const nextResult = result.ok
    ? ({ ok: true, session: pickNextDecision(result.data.sessions) } as const)
    : ({ ok: false, reason: result.reason } as const);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-xl leading-tight text-foreground sm:text-2xl">
            Schedule
          </h1>
          <p className="text-muted-foreground mt-0.5 truncate font-mono text-[10px] tracking-[0.18em] uppercase sm:text-[11px]">
            10分キャッシュ
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Link
            href={showPast ? "/" : "/?past=1"}
            scroll={false}
            prefetch={false}
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 rounded-md border border-border/60 px-2.5 py-1.5 font-mono text-[11px] tracking-widest uppercase transition-colors hover:border-[var(--neon-cyan)]/60 sm:px-3"
            aria-label={showPast ? "過去日程を非表示にする" : "過去日程を表示する"}
          >
            {showPast ? (
              <>
                <EyeOff className="h-3.5 w-3.5" aria-hidden />
                <span className="hidden sm:inline">過去</span>非表示
              </>
            ) : (
              <>
                <Eye className="h-3.5 w-3.5" aria-hidden />
                過去<span className="hidden sm:inline">日程</span>表示
              </>
            )}
          </Link>
          {url && (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 rounded-md border border-border/60 px-2.5 py-1.5 font-mono text-[11px] tracking-widest uppercase transition-colors hover:border-[var(--neon-cyan)]/60 sm:px-3"
              aria-label="元サイトを開く"
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              <span className="hidden sm:inline">元サイト</span>
            </a>
          )}
        </div>
      </div>

      <NextSessionCard result={nextResult} />

      <ScheduleList result={result} showPast={showPast} scheduleUrl={url} />
    </div>
  );
}
