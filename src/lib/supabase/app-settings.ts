import { cache } from "react";
import { createClient } from "./server";

/**
 * Server-side reader for the shared `app_settings` table.
 *
 * This replaces the previous per-browser cookie approach for the schedule
 * URL — the value lives in Supabase so registering it once makes it
 * visible to everyone in the固定.
 *
 * Cached per request via React.cache so the same key isn't fetched twice
 * within a single render tree.
 */
export const fetchAppSetting = cache(
  async (key: string): Promise<string | null> => {
    try {
      const supabase = await createClient();
      const { data, error } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", key)
        .maybeSingle();
      if (error) {
        console.warn("[app-settings] fetch error:", key, error.message);
        return null;
      }
      return (data?.value as string | null | undefined) ?? null;
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
      console.warn("[app-settings] unexpected error:", err);
      return null;
    }
  },
);
