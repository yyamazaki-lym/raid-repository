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
  discord_import_enabled: boolean;
  /** ISO timestamp of the group's first clear of this content. Nullable. */
  first_clear_at: string | null;
  /** FFLogs zone IDs that this content corresponds to. When set, the
   * auto-link feature filters reports by these zone IDs to prevent
   * cross-content mismatches. Empty/null = fall back to fuzzy matching. */
  expected_fflogs_zone_ids: number[] | null;
  /** Optional background image URL shown behind each card on /category. */
  background_image_url: string | null;
  /**
   * Discord role IDs allowed to view this category. NULL or empty array =
   * visible to every guild member. Non-empty = only users whose
   * `app_metadata.discord_roles` intersects this list can see it.
   */
  required_role_ids: string[] | null;
  /** TODO #26 (2.1, 2026-04-29): 自由記述の説明文。空欄可。 */
  description: string | null;
  /**
   * TODO #25 (2.1, 2026-04-29): 手動上書きの「クリアまでの累計時間 (秒)」。
   * NULL のときは動画 duration の自動集計値が使われる。
   */
  manual_time_to_clear_seconds: number | null;
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
  discordImportEnabled: boolean;
  /** ISO timestamp (or null). Manually-set or auto-detected on first clear video. */
  firstClearAt: string | null;
  /** FFLogs zone IDs (e.g. [65, 66]) that this content is. Empty array = unset. */
  expectedFflogsZoneIds: number[];
  /** Optional background image URL shown behind the card on /category. */
  backgroundImageUrl: string | null;
  /**
   * Discord role IDs allowed to view this category. Empty array = visible
   * to every guild member (default). Non-empty = role-gated.
   */
  requiredRoleIds: string[];
  /** 自由記述の説明文 (TODO #26)。空欄なら null。 */
  description: string | null;
  /**
   * 手動上書きのクリアまでの累計時間 (秒)。NULL のときは動画 duration の
   * 自動集計値が使われる (TODO #25)。
   */
  manualTimeToClearSeconds: number | null;
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
    discordImportEnabled: row.discord_import_enabled ?? true,
    firstClearAt: row.first_clear_at ?? null,
    expectedFflogsZoneIds: row.expected_fflogs_zone_ids ?? [],
    backgroundImageUrl: row.background_image_url ?? null,
    requiredRoleIds: row.required_role_ids ?? [],
    description: row.description ?? null,
    manualTimeToClearSeconds: row.manual_time_to_clear_seconds ?? null,
  };
}

// =============================================================
// category_links
// =============================================================

export type CategoryLinkKind = "strategy" | "video";
export type CategoryLinkSource = "manual" | "discord";

export type CategoryLinkRow = {
  id: string;
  category_id: string;
  kind: CategoryLinkKind;
  title: string;
  url: string;
  description: string | null;
  sort_order: number;
  source: CategoryLinkSource;
  /** Optional secondary URL — videos use this for FFLogs reports. */
  logs_url: string | null;
  /** Video length in seconds. NULL until fetched from YouTube or set manually. */
  duration_seconds: number | null;
  /**
   * Original post timestamp (Discord message time, or YouTube upload date
   * when fetched from a YouTube URL). NULL for pre-migration rows until
   * the duration backfill has run. Falls back to `created_at` in queries.
   */
  posted_at: string | null;
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
  source: CategoryLinkSource;
  logsUrl: string | null;
  durationSeconds: number | null;
  postedAt: string | null;
  createdAt: string;
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
    source: row.source ?? "manual",
    logsUrl: row.logs_url ?? null,
    durationSeconds: row.duration_seconds ?? null,
    postedAt: row.posted_at ?? null,
    createdAt: row.created_at,
  };
}
