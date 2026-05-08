"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Legend, ScheduleList } from "../schedule-list";
import { MonthlySection } from "./monthly-section";
import {
  addMonths,
  getCurrentJstYearMonth,
  isNearMonthEndJst,
  monthKey,
  MONTHLY_NEXT_THRESHOLD_DAYS,
  toJstYearMonth,
  type YearMonth,
} from "@/lib/schedule/jst-month";
import type { JapaneseHolidaysMap } from "@/lib/japanese-holidays";
import type {
  ScheduleFetchResult,
  ScheduleSession,
} from "@/lib/schedule/next-session";
import type { ScheduleSourceMode } from "@/lib/schedule/source-mode";
import type { SessionLogEntry } from "@/lib/schedule/session-logs";
import type { SessionVideoLink } from "@/lib/server/session-video-link";
import type { ScheduleSessionMemo } from "@/lib/schedule-memos-client";

type Props = {
  result: ScheduleFetchResult;
  scheduleUrl?: string | null;
  holidays?: JapaneseHolidaysMap;
  sessionVideoLinks?: Record<string, SessionVideoLink[]>;
  sessionLogsByDate?: Record<string, SessionLogEntry[]>;
  hasUltimateClear?: boolean;
  topTextOverride?: string | null;
  initialMemosByDate?: Record<string, ScheduleSessionMemo[]>;
  mode: ScheduleSourceMode;
  currentDiscordId?: string | null;
  isAdmin?: boolean;
};

/**
 * native mode 専用: スケジュールを月別 collapsible section に分割して表示。
 * 表示月は (a) 当月 (常時) + (b) 翌月 (月末から N 日以内 or 既に sessions
 * あり) + (c) sessions が存在する全月。降順 (未来 → 当月 → 過去) で並べる。
 * Legend は wrapper 上部に 1 度だけ描画し、各 section 内 `<ScheduleList>`
 * は `monthFilter` 経由で flat / Legend 抜きで描画する。
 */
export function NativeMonthlySchedule({
  result,
  scheduleUrl,
  holidays,
  sessionVideoLinks,
  sessionLogsByDate,
  hasUltimateClear = false,
  topTextOverride = null,
  initialMemosByDate = {},
  mode,
  currentDiscordId = null,
  isAdmin = false,
}: Props) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();

  if (!result.ok) {
    return <ScheduleList result={result} />;
  }

  const { sessions, attendanceOptions } = result.data;

  const sessionsByMonth = new Map<string, ScheduleSession[]>();
  for (const s of sessions) {
    const ym = toJstYearMonth(s.date);
    const key = monthKey(ym.year, ym.month);
    const list = sessionsByMonth.get(key);
    if (list) list.push(s);
    else sessionsByMonth.set(key, [s]);
  }

  const current = getCurrentJstYearMonth();
  const next = addMonths(current, 1);
  const includeNext =
    isNearMonthEndJst(MONTHLY_NEXT_THRESHOLD_DAYS) ||
    sessionsByMonth.has(monthKey(next.year, next.month));

  const monthMap = new Map<string, YearMonth>();
  monthMap.set(monthKey(current.year, current.month), current);
  if (includeNext) monthMap.set(monthKey(next.year, next.month), next);
  for (const [key] of sessionsByMonth) {
    if (!monthMap.has(key)) {
      const [y, m] = key.split("-");
      monthMap.set(key, { year: Number(y), month: Number(m) });
    }
  }

  const months = Array.from(monthMap.values()).sort((a, b) =>
    a.year !== b.year ? b.year - a.year : b.month - a.month,
  );

  return (
    <div className="flex flex-col gap-4">
      <Card className="glass overflow-hidden p-0">
        <Legend
          hasUltimateClear={hasUltimateClear}
          onRefresh={() => startRefresh(() => router.refresh())}
          refreshing={refreshing}
          topTextScraped={result.data.topText ?? null}
          topTextOverride={topTextOverride}
          attendanceChoices={attendanceOptions.choices}
        />
      </Card>

      {months.map((ym) => {
        const key = monthKey(ym.year, ym.month);
        const list = sessionsByMonth.get(key) ?? [];
        const isCurrent =
          ym.year === current.year && ym.month === current.month;
        const isNextMonth = ym.year === next.year && ym.month === next.month;
        const defaultExpanded =
          isCurrent || (isNextMonth && list.length > 0);
        return (
          <MonthlySection
            key={key}
            year={ym.year}
            month={ym.month}
            sessionCount={list.length}
            defaultExpanded={defaultExpanded}
            localStorageKey={`raid-repo:native-month:${key}`}
          >
            <ScheduleList
              result={result}
              monthFilter={{ year: ym.year, month: ym.month }}
              scheduleUrl={scheduleUrl}
              holidays={holidays}
              sessionVideoLinks={sessionVideoLinks}
              sessionLogsByDate={sessionLogsByDate}
              hasUltimateClear={hasUltimateClear}
              topTextOverride={topTextOverride}
              initialMemosByDate={initialMemosByDate}
              mode={mode}
              currentDiscordId={currentDiscordId}
              isAdmin={isAdmin}
            />
          </MonthlySection>
        );
      })}
    </div>
  );
}
