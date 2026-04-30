import { ChevronLeft } from "lucide-react";
import { SubTabs } from "@/components/portal/sub-tabs";
import { PortalLink } from "@/components/portal/portal-link";
import { StatusBadge } from "@/components/portal/status-badge";
import { findCategoryBySlug } from "@/lib/supabase/categories";
import { requireDiscordRoles } from "@/lib/server/auth";

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
  // TODO #19: defense-in-depth role check. The MainTabs already hide
  // role-restricted categories from the dropdown, but a user with the
  // bookmarked URL would otherwise still load the page. `requireDiscordRoles`
  // redirects to /auth/denied?reason=missing_role when the intersection is
  // empty. Empty `requiredRoleIds` (the default) bypasses the check.
  if (category) {
    await requireDiscordRoles(category.requiredRoleIds);
  }
  const display = category?.name ?? decoded;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <PortalLink
          href="/category"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 font-mono text-[11px] tracking-[0.18em] uppercase transition-colors"
        >
          <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
          Contents
        </PortalLink>
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

      {/* TODO #26 (2.1, 2026-04-29): 自由記述の説明文。空欄なら描画しない。
          whitespace-pre-line で改行を維持。 */}
      {category?.description && (
        <p className="text-muted-foreground text-xs leading-relaxed whitespace-pre-line">
          {category.description}
        </p>
      )}

      <SubTabs baseHref={`/category/${slug}`} />

      <div>{children}</div>
    </div>
  );
}
