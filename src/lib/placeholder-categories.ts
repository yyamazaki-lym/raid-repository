/**
 * Phase 1 placeholder data.
 * Replaced by Supabase fetch (`categories` table) in Phase 3.
 */

export type CategoryStatus = "未着手" | "練習中" | "クリア済";

export const ALL_STATUSES: readonly CategoryStatus[] = [
  "未着手",
  "練習中",
  "クリア済",
] as const;

export function isCategoryStatus(value: unknown): value is CategoryStatus {
  return (
    value === "未着手" || value === "練習中" || value === "クリア済"
  );
}

export type Category = {
  slug: string;
  name: string;
  /** Default status — actual displayed status may be overridden via the local
   *  category-status-store (Phase 1) or Supabase (Phase 3+). */
  status: CategoryStatus;
};

export const PLACEHOLDER_CATEGORIES: Category[] = [
  { slug: "arc-heavy", name: "アルカディア:ヘビー級", status: "練習中" },
  { slug: "arc-cruiser", name: "アルカディア:クルーザー級", status: "練習中" },
  { slug: "arc-lightheavy", name: "アルカディア:ライトヘビー級", status: "未着手" },
];

export function findCategoryBySlug(slug: string): Category | undefined {
  return PLACEHOLDER_CATEGORIES.find((c) => c.slug === slug);
}
