import { createClient } from "./server";
import type { CategoryWaymark } from "@/lib/category-waymarks-client";

/**
 * Server-side fetch of `category_waymarks` for a single category
 * (TODO #94 / A-5)。`category-macros.ts` と同型。
 */
export async function fetchCategoryWaymarks(
  categoryId: string,
): Promise<CategoryWaymark[]> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("category_waymarks")
      .select("*")
      .eq("category_id", categoryId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error || !data) return [];
    return data.map((r) => ({
      id: r.id as string,
      categoryId: r.category_id as string,
      kind: (r as { kind?: string }).kind === "board" ? "board" : "waymark",
      label: (r.label as string) ?? "",
      body: r.body as string,
      note: (r.note as string | null) ?? null,
      sortOrder: r.sort_order as number,
    }));
  } catch (err) {
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
    console.warn("[category-waymarks] unexpected error:", err);
    return [];
  }
}
