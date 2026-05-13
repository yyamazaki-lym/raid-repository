import { cache } from "react";
import { createClient } from "./server";
import {
  rowToCategoryGphotoAlbum,
  type CategoryGphotoAlbum,
  type CategoryGphotoAlbumRow,
} from "./types";

/**
 * Phase 16 (2026-05-13): 攻略タブで使う Google フォトアルバム一覧の
 * server-side fetch。`fetchCategoryLinks` と同じパターンで React.cache 付き。
 */
export const fetchCategoryGphotoAlbums = cache(
  async (categoryId: string): Promise<CategoryGphotoAlbum[]> => {
    try {
      const supabase = await createClient();
      const { data, error } = await supabase
        .from("category_gphoto_albums")
        .select("*")
        .eq("category_id", categoryId)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) {
        console.warn(
          "[supabase/category-gphoto-albums] fetch error:",
          error.message,
        );
        return [];
      }
      return ((data ?? []) as CategoryGphotoAlbumRow[]).map(
        rowToCategoryGphotoAlbum,
      );
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
      console.warn(
        "[supabase/category-gphoto-albums] unexpected error:",
        err,
      );
      return [];
    }
  },
);
