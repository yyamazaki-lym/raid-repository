import { cache } from "react";
import { createClient } from "./server";
import {
  rowToCategoryLink,
  type CategoryLink,
  type CategoryLinkKind,
  type CategoryLinkRow,
} from "./types";

/**
 * Server-side fetch of `category_links` for a single category, optionally
 * filtered by kind ("strategy" or "video"). Cached per request via
 * React.cache so multiple sub-tabs in the same render share one query.
 */
export const fetchCategoryLinks = cache(
  async (
    categoryId: string,
    kind?: CategoryLinkKind,
  ): Promise<CategoryLink[]> => {
    try {
      const supabase = await createClient();
      let query = supabase
        .from("category_links")
        .select("*")
        .eq("category_id", categoryId)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      if (kind) query = query.eq("kind", kind);

      const { data, error } = await query;
      if (error) {
        console.warn("[supabase/category-links] fetch error:", error.message);
        return [];
      }
      return ((data ?? []) as CategoryLinkRow[]).map(rowToCategoryLink);
    } catch (err) {
      // Re-throw Next.js prerender bailouts.
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
      console.warn("[supabase/category-links] unexpected error:", err);
      return [];
    }
  },
);
