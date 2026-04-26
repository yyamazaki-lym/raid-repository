"use client";

import Link from "next/link";
import { Layers } from "lucide-react";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/portal/status-badge";
import type { Category } from "@/lib/placeholder-categories";

export function CategoryList({ categories }: { categories: Category[] }) {
  if (categories.length === 0) {
    return (
      <Card className="glass flex flex-col items-center gap-4 p-10 text-center">
        <span className="grid h-12 w-12 place-items-center rounded-full border border-[var(--neon-violet)]/30 bg-background/60 text-[var(--neon-violet)] shadow-[0_0_24px_-6px_var(--neon-violet)]">
          <Layers className="h-5 w-5" aria-hidden />
        </span>
        <div className="space-y-1">
          <p className="font-display text-foreground text-sm">No categories yet</p>
          <p className="text-muted-foreground text-xs">
            Supabase 連携完了後、ここから追加できるようになります（Phase 3）。
          </p>
        </div>
      </Card>
    );
  }

  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {categories.map((cat) => (
        <li key={cat.slug}>
          <Link
            href={`/category/${cat.slug}/loot`}
            prefetch
            className="block rounded-lg"
          >
            <Card className="glass neon-edge cursor-pointer p-4 transition-transform hover:-translate-y-0.5">
              <div className="flex items-start justify-between gap-3">
                <p className="font-display text-foreground text-sm">{cat.name}</p>
                <StatusBadge
                  slug={cat.slug}
                  defaultStatus={cat.status}
                  readOnly
                  variant="compact"
                />
              </div>
              <p className="text-muted-foreground mt-1 font-mono text-[11px] tracking-widest uppercase">
                /{cat.slug}
              </p>
            </Card>
          </Link>
        </li>
      ))}
    </ul>
  );
}
