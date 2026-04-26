/**
 * Hand-rolled types matching `supabase/schema.sql`.
 *
 * Keeping these manually (instead of `supabase gen types`) avoids having to
 * wire the Supabase CLI into the local dev workflow. They are small enough
 * that drift can be caught by code review when the schema changes.
 */

export type CategoryStatus = "未着手" | "練習中" | "クリア済" | "休止中";

export const ALL_STATUSES: readonly CategoryStatus[] = [
  "未着手",
  "練習中",
  "クリア済",
  "休止中",
] as const;

export function isCategoryStatus(value: unknown): value is CategoryStatus {
  return (
    value === "未着手" ||
    value === "練習中" ||
    value === "クリア済" ||
    value === "休止中"
  );
}

export type CategoryRow = {
  id: string;
  slug: string;
  name: string;
  status: CategoryStatus;
  sort_order: number;
  loot_sheet_url: string | null;
  mitigation_sheet_url: string | null;
  discord_strategy_channel_id: string | null;
  discord_video_channel_id: string | null;
  created_at: string;
  updated_at: string;
};

/** App-facing shape (camelCase, only fields used by the UI). */
export type Category = {
  id: string;
  slug: string;
  name: string;
  status: CategoryStatus;
  sortOrder: number;
  lootSheetUrl: string | null;
  mitigationSheetUrl: string | null;
  discordStrategyChannelId: string | null;
  discordVideoChannelId: string | null;
};

export function rowToCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    status: row.status,
    sortOrder: row.sort_order,
    lootSheetUrl: row.loot_sheet_url ?? null,
    mitigationSheetUrl: row.mitigation_sheet_url ?? null,
    discordStrategyChannelId: row.discord_strategy_channel_id ?? null,
    discordVideoChannelId: row.discord_video_channel_id ?? null,
  };
}

// =============================================================
// category_links
// =============================================================

export type CategoryLinkKind = "strategy" | "video";

export type CategoryLinkRow = {
  id: string;
  category_id: string;
  kind: CategoryLinkKind;
  title: string;
  url: string;
  description: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type CategoryLink = {
  id: string;
  categoryId: string;
  kind: CategoryLinkKind;
  title: string;
  url: string;
  description: string | null;
  sortOrder: number;
};

export function rowToCategoryLink(row: CategoryLinkRow): CategoryLink {
  return {
    id: row.id,
    categoryId: row.category_id,
    kind: row.kind,
    title: row.title,
    url: row.url,
    description: row.description,
    sortOrder: row.sort_order,
  };
}
