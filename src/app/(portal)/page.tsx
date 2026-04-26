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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl text-foreground sm:text-2xl">
            Schedule
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            外部スケジュールサイトから取得した日程一覧（10分キャッシュ）。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={showPast ? "/" : "/?past=1"}
            scroll={false}
            prefetch={false}
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 rounded-md border border-border/60 px-3 py-1.5 font-mono text-[11px] tracking-widest uppercase transition-colors hover:border-[var(--neon-cyan)]/60"
          >
            {showPast ? (
              <>
                <EyeOff className="h-3.5 w-3.5" aria-hidden />
                過去を隠す
              </>
            ) : (
              <>
                <Eye className="h-3.5 w-3.5" aria-hidden />
                過去も表示
              </>
            )}
          </Link>
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
      </div>

      <NextSessionCard result={nextResult} />

      <ScheduleList result={result} showPast={showPast} />
    </div>
  );
}
