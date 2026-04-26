"use server";

import { runDiscordImport } from "./discord-import";
import { createClient } from "@/lib/supabase/server";

/**
 * Server Action: trigger the Discord import on demand from the UI.
 *
 * Runs server-side (so DISCORD_BOT_TOKEN and Supabase credentials never
 * leave the server). Anyone hitting the page can call it — there is no
 * user auth model in this single-tenant app, and the action only writes
 * rows that the underlying RLS already permits.
 */
export async function importDiscordNow(): Promise<{
  ok: boolean;
  reason?: string;
  totalScanned: number;
  totalInserted: number;
  byCategory: { category: string; kind: "strategy" | "video"; inserted: number; scanned: number }[];
}> {
  const result = await runDiscordImport();
  if (!result.ok) {
    return {
      ok: false,
      reason: result.reason,
      totalScanned: 0,
      totalInserted: 0,
      byCategory: [],
    };
  }
  let totalScanned = 0;
  let totalInserted = 0;
  const byCategory: {
    category: string;
    kind: "strategy" | "video";
    inserted: number;
    scanned: number;
  }[] = [];
  for (const r of result.results) {
    totalScanned += r.scanned ?? 0;
    totalInserted += r.inserted ?? 0;
    if ((r.scanned ?? 0) + (r.inserted ?? 0) > 0) {
      byCategory.push({
        category: r.category,
        kind: r.kind,
        inserted: r.inserted ?? 0,
        scanned: r.scanned ?? 0,
      });
    }
  }
  return { ok: true, totalScanned, totalInserted, byCategory };
}

/**
 * Recent Discord-imported counts per category (last `daysAgo` days).
 * Used by the category index to render "今週 +N" badges on each card.
 */
export async function fetchRecentImportCountsByCategory(
  daysAgo = 7,
): Promise<Record<string, number>> {
  const supabase = await createClient();
  const sinceIso = new Date(Date.now() - daysAgo * 86400000).toISOString();
  const { data, error } = await supabase
    .from("category_links")
    .select("category_id, created_at")
    .eq("source", "discord")
    .gte("created_at", sinceIso);
  if (error || !data) return {};

  const counts: Record<string, number> = {};
  for (const row of data) {
    const cid = row.category_id as string;
    counts[cid] = (counts[cid] ?? 0) + 1;
  }
  return counts;
}
