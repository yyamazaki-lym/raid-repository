import { cache } from "react";
import { createClient } from "./server";

/**
 * 1.9 (2026-04-28) TODO #11: 複数 app_settings キーを 1 round-trip で
 * 取得する bulk 版。`page.tsx` のように 2+ keys を必要とするページで
 * `fetchAppSetting()` を複数呼ぶより 1 SELECT で済ませる方が DB
 * round-trip が削減できる。
 *
 * `React.cache` で memoize してあるので同一 render 内で重複呼び出し
 * してもクエリは 1 度きり。
 */
export const fetchAppSettings = cache(
  async (keys: string[]): Promise<Record<string, string | null>> => {
    if (keys.length === 0) return {};
    try {
      const supabase = await createClient();
      const { data, error } = await supabase
        .from("app_settings")
        .select("key, value")
        .in("key", keys);
      if (error) {
        console.warn("[app-settings] bulk fetch error:", error.message);
        return Object.fromEntries(keys.map((k) => [k, null]));
      }
      const out: Record<string, string | null> = Object.fromEntries(
        keys.map((k) => [k, null]),
      );
      for (const row of (data ?? []) as Array<{ key: string; value: string | null }>) {
        out[row.key] = row.value ?? null;
      }
      return out;
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
      console.warn("[app-settings] bulk fetch unexpected error:", err);
      return Object.fromEntries(keys.map((k) => [k, null]));
    }
  },
);

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
