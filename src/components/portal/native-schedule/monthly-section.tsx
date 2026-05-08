"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Card } from "@/components/ui/card";
import { monthLabel } from "@/lib/schedule/jst-month";

type Props = {
  year: number;
  month: number;
  sessionCount: number;
  defaultExpanded: boolean;
  /**
   * 例: `raid-repo:native-month:2026-05`。SSR / hydration mismatch 回避の
   * ため初期値は `defaultExpanded`、client mount 後の useEffect で
   * localStorage 値があれば上書きする。
   */
  localStorageKey: string;
  children: React.ReactNode;
};

/**
 * native スケジュールの 1 ヶ月分 collapsible section。中身は children
 * として `<ScheduleList monthFilter={...} />` を受け取り、折りたたみ時は
 * controlled unmount で realtime subscription / DOM コストを節約する。
 */
export function MonthlySection({
  year,
  month,
  sessionCount,
  defaultExpanded,
  localStorageKey,
  children,
}: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(localStorageKey);
      if (stored === "1") setExpanded(true);
      else if (stored === "0") setExpanded(false);
    } catch {
      // ignore — localStorage unavailable in some embedded contexts
    }
  }, [localStorageKey]);

  useEffect(() => {
    try {
      window.localStorage.setItem(localStorageKey, expanded ? "1" : "0");
    } catch {
      // ignore
    }
  }, [expanded, localStorageKey]);

  return (
    <Card className="glass overflow-hidden p-0">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-label={
          expanded
            ? `${monthLabel(year, month)} を折りたたむ`
            : `${monthLabel(year, month)} を展開`
        }
        className="flex w-full items-center justify-between gap-2 border-b border-border/40 bg-secondary/15 px-3 py-2.5 text-left transition-colors hover:bg-secondary/25"
      >
        <div className="flex items-center gap-2">
          <span className="font-display text-[15px] text-foreground">
            {monthLabel(year, month)}
          </span>
          <span className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground tabular-nums">
            {sessionCount} 件
          </span>
        </div>
        {expanded ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" aria-hidden />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden />
        )}
      </button>
      {expanded && <div>{children}</div>}
    </Card>
  );
}
