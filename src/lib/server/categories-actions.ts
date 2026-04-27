"use server";

import { revalidatePath } from "next/cache";
import { runDiscordImport } from "./discord-import";
import {
  backfillPostedAtFromDiscord,
  type PostedAtBackfillResult,
} from "./discord-postedat-backfill";
import {
  importDiscordScheduleHistory,
  type ScheduleHistoryImportResult,
} from "./discord-schedule";
import { runScheduleSnapshot } from "./schedule-snapshot";
import {
  linkFflogsReportsToVideos,
  type FflogsLinkResult,
} from "./fflogs";
import {
  disconnectFflogsOAuth,
  getFflogsOAuthStatus,
} from "./fflogs-oauth";
import {
  fetchYouTubeMeta,
  fetchYouTubeMetaWithDebug,
  pmap,
  type YouTubeMetaDebug,
} from "./youtube-duration";
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
 * `categories.first_clear_at`. The chosen timestamp is the earliest
 * matching video's `posted_at` (Discord message time / YouTube upload
 * date), falling back to `created_at` only if `posted_at` is NULL.
 *
 * @param opts.overwrite  When true, recompute even for categories that
 *   already have a value set. Use this after running the duration
 *   backfill (which fills `posted_at`) to repair previously-wrong dates
 *   that came from a single batch import sharing one created_at. Default
 *   is false — NULL only — so casual re-runs don't clobber manual edits.
 *
 * Idempotent for the default case. Race-safe: the UPDATE is guarded by
 * `first_clear_at IS NULL` (or unguarded in overwrite mode).
 */
export async function backfillFirstClearFromExistingVideos(
  opts: { overwrite?: boolean } = {},
): Promise<BackfillResult> {
  const supabase = await createClient();
  const overwrite = opts.overwrite === true;

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
    if (cat.first_clear_at && !overwrite) {
      alreadySet += 1;
      continue;
    }
    // Pull all videos in the category. Order by COALESCE(posted_at,
    // created_at) ASC so the first clear-titled match is the earliest.
    // Supabase's PostgREST doesn't support COALESCE in `order`, so we
    // sort client-side after the fetch.
    const { data: videos, error: vErr } = await supabase
      .from("category_links")
      .select("title, posted_at, created_at")
      .eq("category_id", cat.id)
      .eq("kind", "video");
    if (vErr || !videos) {
      noMatch += 1;
      continue;
    }
    const sorted = [...videos].sort((a, b) => {
      const ad = (a.posted_at as string | null) ?? (a.created_at as string);
      const bd = (b.posted_at as string | null) ?? (b.created_at as string);
      return ad.localeCompare(bd);
    });
    const firstClear = sorted.find((v) => isClearTitle(v.title as string));
    if (!firstClear) {
      noMatch += 1;
      continue;
    }
    const iso =
      ((firstClear.posted_at as string | null) ??
        (firstClear.created_at as string));

    // In overwrite mode, skip if the new computed value matches the
    // existing one (avoids reporting "filled" for no-change rows).
    if (overwrite && cat.first_clear_at === iso) {
      alreadySet += 1;
      continue;
    }

    let q = supabase
      .from("categories")
      .update({ first_clear_at: iso })
      .eq("id", cat.id);
    if (!overwrite) q = q.is("first_clear_at", null);
    const { error: updErr } = await q;
    if (updErr) {
      console.warn("[backfill] update failed", cat.slug, updErr.message);
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
 * Server Action: scan the configured Discord schedule channel for past
 * raid-session date notifications and store them in
 * `schedule_past_sessions`. Triggered from the settings dialog (rare —
 * usually a one-shot to seed history, then occasionally for upkeep).
 *
 * Calls `revalidatePath("/")` on success so the schedule page picks up
 * the new rows immediately without a hard reload.
 */
export async function importPastScheduleFromDiscord(): Promise<ScheduleHistoryImportResult> {
  const result = await importDiscordScheduleHistory();
  if (result.ok && result.inserted > 0) {
    try {
      revalidatePath("/");
    } catch {
      // best-effort
    }
  }
  return result;
}

export type ScheduleSnapshotResult = {
  ok: boolean;
  reason?: string;
  scanned: number;
  inserted: number;
  updated: number;
};

/**
 * Server Action: pull the configured FFLogs username's reports and
 * auto-link each report to a matching video (by ±36h window on the
 * report's start timestamp). Each report claims at most one video.
 */
export async function linkFflogsReports(): Promise<FflogsLinkResult> {
  const result = await linkFflogsReportsToVideos();
  if (result.ok && (result.matched > 0 || result.sessionsMatched > 0)) {
    try {
      revalidatePath("/");
    } catch {
      // best-effort
    }
  }
  return result;
}

/**
 * Server Action: read FFLogs OAuth connection status for the settings UI.
 */
export async function fetchFflogsOAuthStatus(): Promise<{
  connected: boolean;
  userName: string | null;
  expiresAt: string | null;
}> {
  return getFflogsOAuthStatus();
}

/**
 * Server Action: clear FFLogs OAuth tokens. Settings UI calls this when
 * the user clicks "Disconnect".
 */
export async function disconnectFflogsOAuthAction(): Promise<
  { ok: true } | { ok: false; reason: string }
> {
  return disconnectFflogsOAuth();
}

/**
 * Server Action: clear all auto-linked `logs_url` values from videos
 * and past sessions. Use this to undo a previous bad sync run (e.g.
 * v1 fallback that linked someone else's reports) and re-sync from
 * a clean slate.
 *
 * Per-date manual entries set via the memo popover are also wiped —
 * if that's a problem, users should restore manually after re-running
 * the OAuth sync.
 */
export async function clearAllFflogsLinks(): Promise<{
  ok: boolean;
  reason?: string;
  videosCleared: number;
  sessionsCleared: number;
}> {
  const supabase = await createClient();
  const { data: vids, error: vidsErr } = await supabase
    .from("category_links")
    .update({ logs_url: null })
    .eq("kind", "video")
    .not("logs_url", "is", null)
    .select("id");
  if (vidsErr) {
    return {
      ok: false,
      reason: "videos: " + vidsErr.message,
      videosCleared: 0,
      sessionsCleared: 0,
    };
  }
  const { data: ses, error: sesErr } = await supabase
    .from("schedule_past_sessions")
    .update({ logs_url: null })
    .not("logs_url", "is", null)
    .select("raw_date");
  if (sesErr) {
    return {
      ok: false,
      reason: "sessions: " + sesErr.message,
      videosCleared: vids?.length ?? 0,
      sessionsCleared: 0,
    };
  }
  try {
    revalidatePath("/");
  } catch {
    // best-effort
  }
  return {
    ok: true,
    videosCleared: vids?.length ?? 0,
    sessionsCleared: ses?.length ?? 0,
  };
}

/**
 * Server Action: manually set / clear a session's `logs_url`.
 *
 * Workaround for the v1 API limitation: it returns ONLY public reports,
 * so Unlisted / Private FFLogs reports can't be auto-linked. Users
 * paste the URL by hand from the memo popover for the date.
 *
 * Upserts: if the past_session row doesn't exist yet (live session
 * that hasn't been snapshotted), insert it using the provided session
 * details. Pass `null` (or empty string) for `logsUrl` to clear the
 * value.
 */
export async function setSessionLogsUrl(
  rawDate: string,
  logsUrl: string | null,
  sessionDetails?: {
    parsedDate: string;
    startTime: string;
    endTime: string;
    dayOfWeek: string;
  },
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const trimmedDate = rawDate.trim();
  if (!trimmedDate) {
    return { ok: false, reason: "rawDate が空です" };
  }
  // Normalize: empty string → null (clear). Anything else gets a basic
  // shape check.
  let normalized: string | null = null;
  if (logsUrl && logsUrl.trim()) {
    const t = logsUrl.trim();
    if (!/^https?:\/\//i.test(t)) {
      return {
        ok: false,
        reason: "FFLogs URL は http:// か https:// で始めてください",
      };
    }
    if (!/fflogs\.com\/reports\//i.test(t)) {
      return {
        ok: false,
        reason:
          "FFLogs レポート URL を入力してください (例: https://www.fflogs.com/reports/abc123)",
      };
    }
    normalized = t;
  }

  const supabase = await createClient();
  // Try UPDATE first. If 0 rows affected and we have session details,
  // INSERT a new row. This covers both "live session not yet
  // snapshotted" and "past session that's been snapshotted" cases.
  const { data: updated, error: updErr } = await supabase
    .from("schedule_past_sessions")
    .update({ logs_url: normalized })
    .eq("raw_date", trimmedDate)
    .select("raw_date")
    .maybeSingle();
  if (updErr) return { ok: false, reason: updErr.message };

  if (!updated) {
    if (!sessionDetails) {
      return {
        ok: false,
        reason:
          "対象の過去予定が見つかりませんでした — 先にスナップショットを取るか、メモポップオーバーから手動で紐づけてください",
      };
    }
    const { error: insErr } = await supabase
      .from("schedule_past_sessions")
      .insert({
        raw_date: trimmedDate,
        parsed_date: sessionDetails.parsedDate,
        start_time: sessionDetails.startTime,
        end_time: sessionDetails.endTime,
        day_of_week: sessionDetails.dayOfWeek,
        source: "manual",
        logs_url: normalized,
      });
    if (insErr) return { ok: false, reason: insErr.message };
  }
  try {
    revalidatePath("/");
  } catch {
    // best-effort
  }
  return { ok: true };
}

/**
 * Server Action: take a snapshot of the current character-sheets
 * attendance into `schedule_past_sessions`. Triggered manually from
 * the maintenance menu (rare) — the typical run is the daily Vercel
 * Cron at 21:50 JST (just before raid time, latest answers in).
 */
export async function snapshotScheduleNow(): Promise<ScheduleSnapshotResult> {
  const result = await runScheduleSnapshot();
  if (result.ok) {
    try {
      revalidatePath("/");
    } catch {
      // best-effort
    }
  }
  return result;
}

/**
 * Server Action: peek at how many rows are currently stored in
 * `schedule_past_sessions`. Surfaced in the settings dialog so the
 * user can verify the DB read path is actually working when something
 * looks off (e.g. import succeeded but rows don't appear on schedule).
 */
export async function countStoredPastSessions(): Promise<{
  ok: boolean;
  reason?: string;
  count: number;
  sampleRawDates: string[];
}> {
  const supabase = await createClient();
  const { count, error: cErr } = await supabase
    .from("schedule_past_sessions")
    .select("raw_date", { count: "exact", head: true });
  if (cErr) {
    return {
      ok: false,
      reason: cErr.message,
      count: 0,
      sampleRawDates: [],
    };
  }
  // Also pull a small sample so the user can eyeball the raw_date format.
  const { data } = await supabase
    .from("schedule_past_sessions")
    .select("raw_date")
    .order("parsed_date", { ascending: false })
    .limit(5);
  return {
    ok: true,
    count: count ?? 0,
    sampleRawDates: (data ?? []).map((r) => r.raw_date as string),
  };
}

/**
 * Server Action: backfill `category_links.posted_at` from each
 * configured Discord channel's recent message timestamps. Run this
 * before "クリア日時を強制再計算" so the recomputed first-clear dates
 * pick up the actual Discord post times (instead of created_at, which
 * is the same for everything imported in one cron run).
 */
export async function backfillPostedAtFromDiscordChannels(): Promise<PostedAtBackfillResult> {
  return backfillPostedAtFromDiscord();
}

/**
 * Server Action: fetch YouTube meta (duration + upload date) for an
 * existing link and persist both columns. Called by the link form
 * dialog after a manual create — the dialog inserts the row first
 * (browser-side), then asks us to enrich.
 *
 * `posted_at` is only set when the row currently has it NULL, so we
 * never clobber a more accurate Discord message timestamp.
 *
 * No-op for non-YouTube URLs or fetch failures; the row stays as-is.
 */
export async function enrichVideoLinkDuration(
  linkId: string,
  url: string,
): Promise<{ ok: boolean; durationSeconds: number | null }> {
  const meta = await fetchYouTubeMeta(url);
  if (meta.durationSeconds === null && meta.uploadDate === null) {
    return { ok: true, durationSeconds: null };
  }
  const supabase = await createClient();

  // duration_seconds: always overwrite (it's deterministic).
  if (meta.durationSeconds !== null) {
    const { error } = await supabase
      .from("category_links")
      .update({ duration_seconds: meta.durationSeconds })
      .eq("id", linkId);
    if (error) {
      console.warn("[enrich-video] duration update failed", linkId, error.message);
      return { ok: false, durationSeconds: null };
    }
  }

  // posted_at: only fill when currently NULL — Discord-supplied
  // timestamps are more authoritative than YouTube upload dates.
  if (meta.uploadDate !== null) {
    const { error } = await supabase
      .from("category_links")
      .update({ posted_at: meta.uploadDate })
      .eq("id", linkId)
      .is("posted_at", null);
    if (error) {
      console.warn("[enrich-video] posted_at update failed", linkId, error.message);
    }
  }

  return { ok: true, durationSeconds: meta.durationSeconds };
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

export type YouTubeDiagnosticResult = {
  url: string;
  durationSeconds: number | null;
  uploadDate: string | null;
  attempts: YouTubeMetaDebug["attempts"];
};

/**
 * Server Action: fetch one YouTube URL with full debug instrumentation.
 *
 * Surfaced in the maintenance menu so when the bulk backfill fails on
 * Vercel (consent gate, bot detection, IP-based block, regex miss), the
 * user can pick any one of their stored URLs and see exactly which step
 * failed — host attempted, HTTP status, html size, whether
 * lengthSeconds / uploadDate matched.
 */
export async function diagnoseYouTubeUrl(
  url: string,
): Promise<YouTubeDiagnosticResult> {
  const { meta, debug } = await fetchYouTubeMetaWithDebug(url);
  return {
    url,
    durationSeconds: meta.durationSeconds,
    uploadDate: meta.uploadDate,
    attempts: debug.attempts,
  };
}

/**
 * Server Action: walk every video link missing `duration_seconds` AND/OR
 * `posted_at` and try to fill both via a single YouTube scrape per row.
 *
 * - `duration_seconds`: written (overwriting NULL) when the scrape succeeds
 * - `posted_at`: written only when currently NULL (don't clobber Discord
 *   timestamps from the import path, which are more authoritative)
 *
 * Idempotent — re-running is a no-op once everything fetchable has been
 * filled. Runs fetches concurrently to keep wall-clock time reasonable
 * for groups with hundreds of historical videos.
 */
export async function backfillVideoDurations(): Promise<DurationBackfillResult> {
  const supabase = await createClient();
  // Pull rows that are missing EITHER column. Without OR, a row that
  // already has duration_seconds (filled in a prior run) but NULL
  // posted_at would be left behind permanently.
  const { data, error } = await supabase
    .from("category_links")
    .select("id, url, duration_seconds, posted_at")
    .eq("kind", "video")
    .or("duration_seconds.is.null,posted_at.is.null");
  if (error || !data) {
    const msg = error?.message ?? "unknown";
    // Most common failure: schema not re-run after the posted_at column
    // was added. Surface a concrete remediation hint.
    const hint =
      msg.includes("posted_at") || msg.includes("duration_seconds")
        ? " — Supabase の SQL Editor で supabase/schema.sql を再実行してください"
        : "";
    return {
      ok: false,
      reason: "video links fetch failed: " + msg + hint,
      scanned: 0,
      filled: 0,
      failed: 0,
      skippedNonYoutube: 0,
    };
  }

  // Parallelize with a small pool to dramatically speed up the bulk
  // scrape (sequential @ ~1s/req → ~⌈N/8⌉ × 1s with concurrency=8).
  const FETCH_CONCURRENCY = 8;
  type Outcome = "filled" | "skipped" | "failed";
  const outcomes = await pmap<typeof data[number], Outcome>(
    data,
    FETCH_CONCURRENCY,
    async (row) => {
      const meta = await fetchYouTubeMeta(row.url as string);
      const needsDuration =
        row.duration_seconds === null && meta.durationSeconds !== null;
      const needsPostedAt =
        row.posted_at === null && meta.uploadDate !== null;
      if (!needsDuration && !needsPostedAt) {
        // Either non-YouTube, or scrape didn't return useful data, or
        // the row already has the value we'd write. Bucket as "skipped".
        return "skipped";
      }
      const update: { duration_seconds?: number; posted_at?: string } = {};
      if (needsDuration) update.duration_seconds = meta.durationSeconds!;
      if (needsPostedAt) update.posted_at = meta.uploadDate!;
      const { error: updErr } = await supabase
        .from("category_links")
        .update(update)
        .eq("id", row.id as string);
      if (updErr) {
        console.warn(
          "[duration-backfill] update failed",
          row.id,
          updErr.message,
        );
        return "failed";
      }
      return "filled";
    },
  );

  let filled = 0;
  let failed = 0;
  let skippedNonYoutube = 0;
  for (const o of outcomes) {
    if (o === "filled") filled += 1;
    else if (o === "failed") failed += 1;
    else skippedNonYoutube += 1;
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
 * "Time to clear" per category — sum of `duration_seconds` for all
 * videos in that category whose `posted_at` (or `created_at` fallback)
 * is on-or-before the category's `first_clear_at`.
 *
 * Conceptually: "how much footage did the group accumulate from start
 * of practice up to the clear?" Useful as a parallel to total practice
 * time — the "until clear" partial.
 *
 * Returns an empty map for categories without `first_clear_at` set.
 */
export async function fetchTimeToClearByCategory(): Promise<
  Record<string, number>
> {
  const supabase = await createClient();
  // Pull the categories that have a first_clear_at, plus all their
  // videos with non-null durations. Doing this in two queries + JS
  // aggregation keeps RLS-safe and avoids needing a custom RPC.
  const { data: cats, error: catErr } = await supabase
    .from("categories")
    .select("id, first_clear_at")
    .not("first_clear_at", "is", null);
  if (catErr || !cats || cats.length === 0) return {};
  const catIds = cats.map((c) => c.id as string);
  const firstClearMap = new Map<string, string>(
    cats.map((c) => [c.id as string, c.first_clear_at as string]),
  );

  const { data: videos, error: vErr } = await supabase
    .from("category_links")
    .select("category_id, duration_seconds, posted_at, created_at")
    .in("category_id", catIds)
    .eq("kind", "video")
    .not("duration_seconds", "is", null);
  if (vErr || !videos) return {};

  const totals: Record<string, number> = {};
  for (const v of videos) {
    const cid = v.category_id as string;
    const fc = firstClearMap.get(cid);
    if (!fc) continue;
    const sec = v.duration_seconds as number | null;
    if (typeof sec !== "number" || sec <= 0) continue;
    const at =
      (v.posted_at as string | null) ?? (v.created_at as string);
    // Inclusive cutoff — a video posted on the clear day itself counts.
    if (at > fc) continue;
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
