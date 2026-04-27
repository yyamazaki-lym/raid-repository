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
      const { data, error } = await supabase
        .from("recruitment_templates")
        .select("*")
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      if (error || !data) return [];
      return data.map((r) => ({
        id: r.id as string,
        label: r.label as string,
        body: r.body as string,
        sortOrder: r.sort_order as number,
      }));
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
