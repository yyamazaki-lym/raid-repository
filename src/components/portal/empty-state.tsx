import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * 一覧が 0 件のときの共通 empty state (TODO #51 P2-7)。
 *
 * これまで category-list / schedule-list / macros-list が各々 Card +
 * icon chip + テキストを個別実装していたのを統一する。hooks なしの
 * 純粋表示 component なので Server / Client どちらからでも使える。
 *
 * tone:
 * - "violet" (default): 一覧ページの主要 empty state。丸い icon chip +
 *   neon-violet glow (旧 category-list の見た目を全体の規範にする)
 * - "neutral": 控えめな角丸 chip + muted 色 (schedule の「予定なし」等、
 *   データ未登録が異常ではない文脈)
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  tone = "violet",
  className,
}: {
  icon?: LucideIcon;
  title?: string;
  description?: React.ReactNode;
  tone?: "violet" | "neutral";
  className?: string;
}) {
  return (
    <Card
      className={cn(
        "glass flex flex-col items-center gap-3 p-8 text-center",
        className,
      )}
    >
      {Icon && (
        <span
          className={cn(
            "grid place-items-center bg-background/60",
            tone === "violet"
              ? "h-12 w-12 rounded-full border border-[var(--neon-violet)]/30 text-[var(--neon-violet)] shadow-[0_0_24px_-6px_var(--neon-violet)]"
              : "h-10 w-10 rounded-md border border-border/60 text-muted-foreground",
          )}
        >
          <Icon className={tone === "violet" ? "h-5 w-5" : "h-4 w-4"} aria-hidden />
        </span>
      )}
      {title && (
        <p className="font-display text-foreground text-sm">{title}</p>
      )}
      {description && (
        <p className="text-muted-foreground max-w-md text-xs leading-relaxed">
          {description}
        </p>
      )}
    </Card>
  );
}
