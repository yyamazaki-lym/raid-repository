/**
 * Hand-rolled types matching `supabase/schema.sql`.
 *
 * Keeping these manually (instead of `supabase gen types`) avoids having to
 * wire the Supabase CLI into the local dev workflow. They are small enough
 * that drift can be caught by code review when the schema changes.
 */

export type CategoryStatus = "未着手" | "練習中" | "クリア済";

export const ALL_STATUSES: readonly CategoryStatus[] = [
  "未着手",
  "練習中",
  "クリア済",
] as const;

export function isCategoryStatus(value: unknown): value is CategoryStatus {
  return value === "未着手" || value === "練習中" || value === "クリア済";
}

export type CategoryRow = {
  id: string;
  slug: string;
  name: string;
  status: CategoryStatus;
  sort_order: number;
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
};

export function rowToCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    status: row.status,
    sortOrder: row.sort_order,
  };
}
