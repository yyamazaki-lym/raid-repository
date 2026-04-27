import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { SubTabs } from "@/components/portal/sub-tabs";
import { StatusBadge } from "@/components/portal/status-badge";
import { findCategoryBySlug } from "@/lib/supabase/categories";

export default async function CategoryDetailLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}>) {
  const { slug } = await params;

  const decoded = decodeURIComponent(slug);
  const category = await findCategoryBySlug(slug);
  const display = category?.name ?? decoded;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/category"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 font-mono text-[11px] tracking-[0.18em] uppercase transition-colors"
        >
          <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
          Contents
        </Link>
        <span className="text-muted-foreground/50">/</span>
        <span className="font-display text-foreground text-sm">{display}</span>
        {/* Status here is read-only — editing happens in /category list
            view only, so the per-page status edit doesn't drift across
            multiple sources of truth. */}
        {category && (
          <StatusBadge
            status={category.status}
            readOnly
            className="ml-1"
          />
        )}
      </div>

      <SubTabs baseHref={`/category/${slug}`} />

      <div>{children}</div>
    </div>
  );
}
