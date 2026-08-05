"use client";

import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ALL_STATUSES, type CategoryStatus } from "@/lib/supabase/types";

// Semantic task-progress palette — globals.css の `--color-status-*` トークン
// 経由 (総合レビュー F-1)。gray → amber → emerald → slate =
// "未着手 → 練習中 → クリア済 → 休止中"。意味色なので 7 テーマ共通で固定
// (信号機的な明確さを優先)。glow shadow はトークン色に対応する literal。
const STATUS_TONE: Record<CategoryStatus, string> = {
  未着手: "text-status-todo border-status-todo/40 bg-status-todo/10",
  練習中: "text-status-practice border-status-practice/45 bg-status-practice/12",
  クリア済: "text-status-clear border-status-clear/45 bg-status-clear/12",
  休止中: "text-status-idle border-status-idle/45 bg-status-idle/14",
};

const STATUS_DOT: Record<CategoryStatus, string> = {
  未着手: "bg-status-todo/60",
  練習中: "bg-status-practice shadow-[0_0_8px_rgb(251_191_36_/_0.7)]",
  クリア済: "bg-status-clear shadow-[0_0_8px_rgb(52_211_153_/_0.7)]",
  休止中: "bg-status-idle shadow-[0_0_8px_rgb(148_163_184_/_0.6)]",
};

type Variant = "compact" | "default";

type Props = {
  status: CategoryStatus;
  /** When provided, badge is editable; clicking opens a dropdown to switch. */
  onChange?: (next: CategoryStatus) => void;
  readOnly?: boolean;
  variant?: Variant;
  className?: string;
  ariaLabel?: string;
};

export function StatusBadge({
  status,
  onChange,
  readOnly = false,
  variant = "default",
  className,
  ariaLabel,
}: Props) {
  const isEditable = !readOnly && typeof onChange === "function";

  // Fixed min-width + centered content so different status labels
  // (未着手/練習中/クリア済/休止中) all occupy the same horizontal space.
  // Without this, dropdown items show jagged content-name start positions.
  // shrink-0 + whitespace-nowrap: 狭い flex 行 (カード下段や breadcrumb) で
  // バッジが圧縮されてラベルが「練習/中」のように折り返すのを防ぐ。
  const baseBadge = cn(
    "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-sm border font-medium whitespace-nowrap tracking-normal",
    STATUS_TONE[status],
    variant === "compact"
      ? "min-w-[4.5rem] px-1.5 py-px text-[11px]"
      : "min-w-[5.5rem] px-2 py-0.5 text-[11px]",
    className,
  );

  if (!isEditable) {
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
        aria-label={ariaLabel ?? `ステータス: ${status} (クリックして変更)`}
      >
        <span className={cn("h-1 w-1 rounded-full", STATUS_DOT[status])} aria-hidden />
        {status}
        <ChevronDown className="h-2.5 w-2.5 opacity-60" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={6} className="glass-popup min-w-44">
        {ALL_STATUSES.map((s) => {
          const isCurrent = s === status;
          return (
            <DropdownMenuItem
              key={s}
              onClick={() => onChange?.(s)}
              className={cn(
                "flex cursor-pointer items-center gap-2",
                isCurrent && "bg-secondary/40",
              )}
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_DOT[s])} aria-hidden />
              <span className="flex-1 text-sm">{s}</span>
              {isCurrent && (
                <span className="text-muted-foreground font-mono text-[9px] tracking-[0.22em] uppercase">
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
