import { createClient } from "./server";
import type { CategoryMacro } from "@/lib/category-macros-client";

/**
 * Server-side fetch of `category_macros` for a single category.
 * No React.cache wrap — invoked once per page render and the
 * volume is tiny (handful of rows per category).
 */
export async function fetchCategoryMacros(
  categoryId: string,
): Promise<CategoryMacro[]> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("category_macros")
      .select("*")
      .eq("category_id", categoryId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error || !data) return [];
    return data.map((r) => ({
      id: r.id as string,
      categoryId: r.category_id as string,
      label: (r.label as string) ?? "",
      body: r.body as string,
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
    console.warn("[category-macros] unexpected error:", err);
    return [];
  }
}

/**
 * Server-side fetch of recruitment_templates filtered to a single
 * category. Used by the macros sub-tab to show "templates linked to
 * this category" alongside the macros.
 */
export async function fetchRecruitmentTemplatesForCategory(
  categoryId: string,
): Promise<
  Array<{ id: string; label: string; body: string; sortOrder: number }>
> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("recruitment_templates")
      .select("id, label, body, sort_order")
      .eq("category_id", categoryId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error || !data) return [];
    return data.map((r) => ({
      id: r.id as string,
      label: (r.label as string) ?? "",
      body: r.body as string,
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
    console.warn("[recruitment-templates] unexpected error:", err);
    return [];
  }
}
