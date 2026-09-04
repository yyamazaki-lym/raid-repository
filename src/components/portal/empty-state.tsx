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
        <p className="font-display text-sm text-balance text-foreground">{title}</p>
      )}
      {/* 2026-09-04 実機要望「改行をもう少し綺麗にして揃えてほしい」。
          中央寄せの 2〜3 行は行の長さがばらつくと特に目立つので `text-balance`
          で行を均す (長文では効かない仕様なので、説明が長い呼び出し元では
          自動的に通常の折り返しに戻る)。日本語の文節単位の改行は globals.css
          の `word-break: auto-phrase` が全体に効いている。
          要素が `<p>` だと箇条書き (`<ul>`) を渡せない (phrasing content しか
          置けず parser に閉じられる) ため `<div>` にしてある。 */}
      {description && (
        <div className="max-w-md text-xs leading-relaxed text-balance text-muted-foreground">
          {description}
        </div>
      )}
    </Card>
  );
}
