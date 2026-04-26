"use server";

import { runDiscordImport } from "./discord-import";
import { fetchYouTubeDuration } from "./youtube-duration";
import { isClearTitle } from "@/lib/clear-detection";
import { createClient } from "@/lib/supabase/server";

export type ImportNowItem = {
  category: string;
  kind: "strategy" | "video";
  ok: boolean;
  scanned: number;
  duplicates: number;
  inserted: number;
  failed: number;
  reason?: string;
  skipped?: "disabled";
};

/**
 * Server Action: trigger the Discord import on demand from the UI.
 *
 * Runs server-side so credentials never leave the server. Returns a
 * detailed per-(category, kind) breakdown so the UI can show exactly
 * what happened — useful when scanned=0 hints at bot permission issues
 * vs duplicates>0/inserted=0 hints at idempotent re-runs.
 */
export async function importDiscordNow(): Promise<{
  ok: boolean;
  reason?: string;
  totalScanned: number;
  totalInserted: number;
  totalFailed: number;
  items: ImportNowItem[];
}> {
  const result = await runDiscordImport();
  if (!result.ok) {
    return {
      ok: false,
      reason: result.reason,
      totalScanned: 0,
      totalInserted: 0,
      totalFailed: 0,
      items: [],
    };
  }
  let totalScanned = 0;
  let totalInserted = 0;
  let totalFailed = 0;
  const items: ImportNowItem[] = [];
  for (const r of result.results) {
    totalScanned += r.scanned ?? 0;
    totalInserted += r.inserted ?? 0;
    totalFailed += r.failed ?? 0;
    items.push({
      category: r.category,
      kind: r.kind,
      ok: r.ok,
      scanned: r.scanned ?? 0,
      duplicates: r.duplicates ?? 0,
      inserted: r.inserted ?? 0,
      failed: r.failed ?? 0,
      reason: r.reason ?? r.failReason,
      skipped: r.skipped,
    });
  }
  return { ok: true, totalScanned, totalInserted, totalFailed, items };
}

export type BackfillResult = {
  ok: boolean;
  reason?: string;
  /** Categories that already had a value — left untouched. */
  alreadySet: number;
  /** Categories that got a new first_clear_at value. */
  filled: number;
  /** Categories with no clear-flagged video — left as NULL. */
  noMatch: number;
  /** Per-category detail for any categories that were updated. */
  filledDetails: Array<{ slug: string; isoDate: string; videoTitle: string }>;
};

/**
 * Server Action: scan all existing video links and back-fill
 * `categories.first_clear_at` for any category that:
 *   1. Currently has `first_clear_at IS NULL`, AND
 *   2. Has at least one video link whose title matches `isClearTitle`
 *
 * The chosen timestamp is the earliest matching video's `created_at`.
 * Race-safe: the UPDATE is guarded by `first_clear_at IS NULL` so a
 * concurrent manual edit can't be clobbered.
 *
 * This is idempotent — running it twice is a no-op the second time.
 */
export async function backfillFirstClearFromExistingVideos(): Promise<BackfillResult> {
  const supabase = await createClient();

  // 1. All categories currently lacking first_clear_at.
  const { data: cats, error: catErr } = await supabase
    .from("categories")
    .select("id, slug, first_clear_at");
  if (catErr || !cats) {
    return {
      ok: false,
      reason: "categories fetch failed: " + (catErr?.message ?? "unknown"),
      alreadySet: 0,
      filled: 0,
      noMatch: 0,
      filledDetails: [],
    };
  }

  let alreadySet = 0;
  let filled = 0;
  let noMatch = 0;
  const filledDetails: BackfillResult["filledDetails"] = [];

  for (const cat of cats) {
    if (cat.first_clear_at) {
      alreadySet += 1;
      continue;
    }
    // 2. Earliest video in this category, ordered by created_at ASC.
    //    We scan in JS rather than via SQL ILIKE because the keyword
    //    rule (incl. "未クリア" exclusion + English word boundary) is
    //    centralized in `isClearTitle` and we want a single source of truth.
    const { data: videos, error: vErr } = await supabase
      .from("category_links")
      .select("title, created_at")
      .eq("category_id", cat.id)
      .eq("kind", "video")
      .order("created_at", { ascending: true });
    if (vErr || !videos) {
      noMatch += 1;
      continue;
    }
    const firstClear = videos.find((v) => isClearTitle(v.title as string));
    if (!firstClear) {
      noMatch += 1;
      continue;
    }
    const iso = firstClear.created_at as string;
    const { error: updErr } = await supabase
      .from("categories")
      .update({ first_clear_at: iso })
      .eq("id", cat.id)
      .is("first_clear_at", null);
    if (updErr) {
      console.warn(
        "[backfill] update failed",
        cat.slug,
        updErr.message,
      );
      noMatch += 1;
      continue;
    }
    filled += 1;
    filledDetails.push({
      slug: cat.slug as string,
      isoDate: iso,
      videoTitle: firstClear.title as string,
    });
  }

  return {
    ok: true,
    alreadySet,
    filled,
    noMatch,
    filledDetails,
  };
}

/**
 * Server Action: fetch YouTube duration for an existing link and persist
 * `category_links.duration_seconds`. Called by the link form dialog
 * after a manual create — the dialog inserts the row first (browser-side),
 * then asks us to enrich with the duration.
 *
 * No-op for non-YouTube URLs or fetch failures; the row stays as NULL.
 */
export async function enrichVideoLinkDuration(
  linkId: string,
  url: string,
): Promise<{ ok: boolean; durationSeconds: number | null }> {
  const seconds = await fetchYouTubeDuration(url);
  if (seconds === null) return { ok: true, durationSeconds: null };
  const supabase = await createClient();
  const { error } = await supabase
    .from("category_links")
    .update({ duration_seconds: seconds })
    .eq("id", linkId);
  if (error) {
    console.warn("[enrich-video] update failed", linkId, error.message);
    return { ok: false, durationSeconds: null };
  }
  return { ok: true, durationSeconds: seconds };
}

export type DurationBackfillResult = {
  ok: boolean;
  reason?: string;
  scanned: number;
  filled: number;
  failed: number;
  /** YouTube URLs only — non-YouTube videos are not attempted. */
  skippedNonYoutube: number;
};

/**
 * Server Action: walk every video link with NULL `duration_seconds` and
 * try to fill it via the YouTube scrape. Idempotent — re-running is a
 * no-op once everything fetchable has been filled.
 */
export async function backfillVideoDurations(): Promise<DurationBackfillResult> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("category_links")
    .select("id, url, duration_seconds")
    .eq("kind", "video")
    .is("duration_seconds", null);
  if (error || !data) {
    return {
      ok: false,
      reason: "video links fetch failed: " + (error?.message ?? "unknown"),
      scanned: 0,
      filled: 0,
      failed: 0,
      skippedNonYoutube: 0,
    };
  }
  let filled = 0;
  let failed = 0;
  let skippedNonYoutube = 0;
  for (const row of data) {
    const seconds = await fetchYouTubeDuration(row.url as string);
    if (seconds === null) {
      // Either non-YouTube or fetch failed — bucket separately so the UI
      // can distinguish "no videos to process" from "real errors".
      skippedNonYoutube += 1;
      continue;
    }
    const { error: updErr } = await supabase
      .from("category_links")
      .update({ duration_seconds: seconds })
      .eq("id", row.id as string);
    if (updErr) {
      console.warn(
        "[duration-backfill] update failed",
        row.id,
        updErr.message,
      );
      failed += 1;
      continue;
    }
    filled += 1;
  }
  return {
    ok: true,
    scanned: data.length,
    filled,
    failed,
    skippedNonYoutube,
  };
}

/**
 * Sum of `duration_seconds` per category across all video links.
 * NULL durations are ignored. Used by the category index to render the
 * "累計練習時間" badge on each card.
 */
export async function fetchPracticeSecondsByCategory(): Promise<
  Record<string, number>
> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("category_links")
    .select("category_id, duration_seconds")
    .eq("kind", "video")
    .not("duration_seconds", "is", null);
  if (error || !data) return {};
  const totals: Record<string, number> = {};
  for (const row of data) {
    const cid = row.category_id as string;
    const sec = row.duration_seconds as number | null;
    if (typeof sec !== "number" || sec <= 0) continue;
    totals[cid] = (totals[cid] ?? 0) + sec;
  }
  return totals;
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
