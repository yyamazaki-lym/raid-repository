"use client";

import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ALL_STATUSES,
  type CategoryStatus,
} from "@/lib/placeholder-categories";
import {
  setCategoryStatus,
  useCategoryStatusMap,
} from "@/lib/category-status-store";

// Semantic task-progress palette — stays distinct across all themes.
// Gray → amber → emerald = "未着手 → 練習中 → クリア済".
const STATUS_TONE: Record<CategoryStatus, string> = {
  未着手: "text-zinc-300 border-zinc-500/40 bg-zinc-500/10",
  練習中: "text-amber-300 border-amber-400/45 bg-amber-400/12",
  クリア済: "text-emerald-300 border-emerald-400/45 bg-emerald-400/12",
};

const STATUS_DOT: Record<CategoryStatus, string> = {
  未着手: "bg-zinc-400/60",
  練習中: "bg-amber-400 shadow-[0_0_8px_rgb(251_191_36_/_0.7)]",
  クリア済: "bg-emerald-400 shadow-[0_0_8px_rgb(52_211_153_/_0.7)]",
};

type Variant = "compact" | "default";

type Props = {
  slug: string;
  /** Status to show until localStorage hydration / when no override exists. */
  defaultStatus: CategoryStatus;
  /** Disable the editor (read-only display). */
  readOnly?: boolean;
  variant?: Variant;
  className?: string;
};

/**
 * A clickable status badge. In Phase 1 the value is persisted to localStorage;
 * Phase 3 will swap to a Supabase mutation.
 */
export function StatusBadge({
  slug,
  defaultStatus,
  readOnly = false,
  variant = "default",
  className,
}: Props) {
  const overrides = useCategoryStatusMap();
  const status = overrides[slug] ?? defaultStatus;

  const baseBadge = cn(
    "inline-flex items-center gap-1.5 rounded-sm border font-mono uppercase",
    STATUS_TONE[status],
    variant === "compact"
      ? "px-1.5 py-px text-[9px] tracking-widest"
      : "px-2 py-0.5 text-[10px] tracking-[0.18em]",
    className,
  );

  if (readOnly) {
    return (
      <span className={baseBadge}>
        <span className={cn("h-1 w-1 rounded-full", STATUS_DOT[status])} aria-hidden />
        {status}
      </span>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          baseBadge,
          "cursor-pointer transition-shadow hover:shadow-[0_0_12px_-4px_currentColor]",
        )}
        aria-label={`ステータス: ${status} (クリックして変更)`}
      >
        <span className={cn("h-1 w-1 rounded-full", STATUS_DOT[status])} aria-hidden />
        {status}
        <ChevronDown className="h-2.5 w-2.5 opacity-60" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={6} className="glass min-w-44">
        {ALL_STATUSES.map((s) => {
          const isCurrent = s === status;
          return (
            <DropdownMenuItem
              key={s}
              onClick={() => setCategoryStatus(slug, s)}
              className={cn(
                "flex cursor-pointer items-center gap-2",
                isCurrent && "bg-secondary/40",
              )}
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_DOT[s])} aria-hidden />
              <span className="flex-1 text-sm">{s}</span>
              {isCurrent && (
                <span className="text-muted-foreground font-mono text-[9px] tracking-widest uppercase">
                  current
                </span>
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
