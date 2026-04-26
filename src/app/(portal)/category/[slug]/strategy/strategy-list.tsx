"use client";

import { useState } from "react";
import { ExternalLink, BookOpen } from "lucide-react";
import { Card } from "@/components/ui/card";
import { LinkFormDialog } from "@/components/portal/link-form-dialog";
import { LinkCardMenu } from "@/components/portal/link-card-menu";
import { useRealtimeCategoryLinks } from "@/lib/category-links-client";
import type { CategoryLink } from "@/lib/supabase/types";

type Props = {
  categoryId: string;
  initial: CategoryLink[];
};

export function StrategyList({ categoryId, initial }: Props) {
  const links = useRealtimeCategoryLinks(categoryId, "strategy", initial);
  const [editTarget, setEditTarget] = useState<CategoryLink | null>(null);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase">
          {links.length} link{links.length === 1 ? "" : "s"}
        </p>
        <LinkFormDialog categoryId={categoryId} kind="strategy" />
      </div>

      {links.length === 0 ? (
        <Card className="glass flex flex-col items-center gap-3 p-10 text-center">
          <span className="grid h-10 w-10 place-items-center rounded-md border border-[var(--neon-magenta)]/40 bg-background/40 text-[var(--neon-magenta)]">
            <BookOpen className="h-4 w-4" aria-hidden />
          </span>
          <p className="font-display text-foreground text-sm">
            攻略リンク未登録
          </p>
          <p className="text-muted-foreground max-w-md text-xs leading-relaxed">
            wiki / 攻略ブログ / Twitter (X) などの URL を登録できます。
          </p>
        </Card>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {links.map((link) => (
            <li key={link.id}>
              <Card className="glass neon-edge group flex flex-col p-0 transition-transform hover:-translate-y-0.5">
                <div className="flex items-start gap-2 px-4 pt-3 pb-1">
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex flex-1 items-start gap-2"
                  >
                    <ExternalLink
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--neon-magenta)]"
                      aria-hidden
                    />
                    <span className="flex-1 break-words font-display text-sm text-foreground group-hover:text-[var(--neon-cyan)]">
                      {link.title}
                    </span>
                  </a>
                  <LinkCardMenu link={link} onEdit={() => setEditTarget(link)} />
                </div>
                {link.description && (
                  <p className="px-4 text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap">
                    {link.description}
                  </p>
                )}
                <p className="px-4 pt-1 pb-3 font-mono text-[10px] break-all text-muted-foreground/70">
                  {link.url}
                </p>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <LinkFormDialog
        categoryId={categoryId}
        kind="strategy"
        link={editTarget ?? undefined}
        open={editTarget !== null}
        onOpenChange={(o) => {
          if (!o) setEditTarget(null);
        }}
      />
    </div>
  );
}
