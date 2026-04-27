import { cache } from "react";
import { createClient } from "./server";
import type { RecruitmentTemplate } from "@/lib/recruitment-templates-client";

/**
 * Server-side fetch for `recruitment_templates`. Same shape as the
 * client helper, but using the server Supabase client so we can pull
 * data inside Server Components and pass `initial` down.
 *
 * Wrapped in React.cache so multiple components in the same render
 * tree share one query.
 */
export const fetchRecruitmentTemplatesServer = cache(
  async (): Promise<RecruitmentTemplate[]> => {
    try {
      const supabase = await createClient();
      type Row = {
        id: string;
        label: string;
        body: string;
        sort_order: number;
        category_id: string | null;
        categories: { name: string } | { name: string }[] | null;
      };
      const { data, error } = await supabase
        .from("recruitment_templates")
        .select(
          "id, label, body, sort_order, category_id, categories(name)",
        )
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      if (error || !data) return [];
      const rows = data as unknown as Row[];
      return rows.map((r) => {
        const cat = Array.isArray(r.categories) ? r.categories[0] : r.categories;
        return {
          id: r.id,
          label: r.label ?? "",
          body: r.body,
          sortOrder: r.sort_order,
          categoryId: r.category_id ?? null,
          categoryName: cat?.name ?? null,
        };
      });
    } catch (err) {
      // Re-throw Next.js prerender bailouts so the framework can
      // correctly opt into dynamic rendering.
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
  },
);
