import { cache } from "react";
import { createClient } from "./server";
import {
  rowToCategory,
  type Category,
  type CategoryRow,
} from "./types";

/**
 * Server-side category fetch.
 *
 * Wrapped in React `cache()` so multiple components in the same request
 * (layout + page + sub-tab layout) share a single Supabase query.
 *
 * Returns an empty array on any error (table missing during initial Phase 2
 * setup, network glitch, etc.) so the UI degrades gracefully rather than
 * crashing the whole route.
 */
export const fetchCategories = cache(
  async (): Promise<{ ok: boolean; categories: Category[]; reason?: string }> => {
    try {
      const supabase = await createClient();
      const { data, error } = await supabase
        .from("categories")
        .select("*")
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });

      if (error) {
        console.warn("[supabase/categories] fetch error:", error.message);
        return { ok: false, categories: [], reason: error.message };
      }
      const rows = (data ?? []) as CategoryRow[];
      return { ok: true, categories: rows.map(rowToCategory) };
    } catch (err) {
      // Next.js throws sentinel errors (DYNAMIC_SERVER_USAGE, redirect, etc.)
      // when cookies() is used during static prerender. Re-throw so the
      // framework can correctly opt the route into dynamic rendering.
      if (
        err &&
        typeof err === "object" &&
        "digest" in err &&
        typeof (err as { digest?: unknown }).digest === "string"
      ) {
        const digest = (err as { digest: string }).digest;
        if (digest === "DYNAMIC_SERVER_USAGE" || digest.startsWith("NEXT_")) {
          throw err;
        }
      }
      console.warn("[supabase/categories] unexpected error:", err);
      return {
        ok: false,
        categories: [],
        reason: err instanceof Error ? err.message : "unknown error",
      };
    }
  },
);

/** Look up a single category by slug (uses the cached list). */
export async function findCategoryBySlug(slug: string): Promise<Category | null> {
  const result = await fetchCategories();
  if (!result.ok) return null;
  return result.categories.find((c) => c.slug === slug) ?? null;
}
