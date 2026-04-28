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
import {
  isClearTitleForCategory,
  isFirstFloorPracticeTitle,
} from "@/lib/clear-detection";
import { videoBelongsToCategory } from "@/lib/content-groups";
import { extractDateFromTitle } from "@/lib/title-date";
import { createClient } from "@/lib/supabase/server";
import {
  fetchGuildRoles,
  type DiscordGuildRole,
} from "./discord-roles";
import { assertAdminResult } from "./auth";
import {
  rowToCategory,
  type Category,
  type CategoryRow,
  type CategoryStatus,
} from "@/lib/supabase/types";

/**
 * Server Action: fetch the Discord guild's role list for the category
 * edit dialog. Returns an empty array when bot/guild env vars are
 * missing, so the UI degrades gracefully (the role section just hides
 * its options instead of crashing).
 */
export async function fetchAvailableGuildRoles(): Promise<DiscordGuildRole[]> {
  return fetchGuildRoles();
}

// =============================================================
// Categories CRUD Server Actions (admin-gated, TODO #21)
// =============================================================
//
// 旧来は `src/lib/categories-client.ts` から anon key で直接 supabase に
// 書き込んでいたが、Discord ロール (DISCORD_ADMIN_ROLE_IDS) で書き込みを
// 制限するため Server Action 経由に変えた。`assertAdminResult()` で
// auth check → 通過時のみ supabase server client (= cookie 経由で auth
// context を持つ) で実行。env 未設定なら全員通る (= 後方互換)。
//
// なお Supabase RLS は依然 anon フル open のままなので、決定的な攻撃者は
// REST API を直接叩いて bypass できる。本番で本気のセキュリティが必要
// なら後続で RLS を `auth.uid() で admin role 持ち以外は INSERT/UPDATE/
// DELETE 拒否` に締める PR を別途立てること。

export type CategoryWriteResult =
  | { ok: true }
  | { ok: false; reason: string };

export type CategoryCreateInput = {
  slug: string;
  name: string;
  status?: CategoryStatus;
};

export type CategoryUpdatePatch = Partial<{
  name: string;
  slug: string;
  status: CategoryStatus;
  loot_sheet_url: string | null;
  mitigation_sheet_url: string | null;
  discord_strategy_channel_id: string | null;
  discord_video_channel_id: string | null;
  discord_import_enabled: boolean;
  first_clear_at: string | null;
  background_image_url: string | null;
  required_role_ids: string[] | null;
}>;

export async function createCategoryAction(
  input: CategoryCreateInput,
): Promise<
  | { ok: true; category: Category }
  | { ok: false; reason: string }
> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: auth.reason };

  const supabase = await createClient();
  // Place new categories at the end (max sort_order + 1).
  const { data: maxRow } = await supabase
    .from("categories")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder = ((maxRow?.sort_order as number | undefined) ?? -1) + 1;

  const { data, error } = await supabase
    .from("categories")
    .insert({
      slug: input.slug,
      name: input.name,
      status: input.status ?? "未着手",
      sort_order: nextOrder,
    })
    .select("*")
    .single();
  if (error || !data) {
    return { ok: false, reason: error?.message ?? "unknown error" };
  }
  return { ok: true, category: rowToCategory(data as CategoryRow) };
}

export async function updateCategoryAction(
  id: string,
  patch: CategoryUpdatePatch,
): Promise<CategoryWriteResult> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: auth.reason };

  const supabase = await createClient();
  const { error } = await supabase
    .from("categories")
    .update(patch)
    .eq("id", id);
  if (error) return { ok: false, reason: error.message };
  return { ok: true };
}

export async function deleteCategoryAction(
  id: string,
): Promise<CategoryWriteResult> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: auth.reason };

  const supabase = await createClient();
  const { error } = await supabase.from("categories").delete().eq("id", id);
  if (error) return { ok: false, reason: error.message };
  return { ok: true };
}

export async function setCategoryOrderAction(
  orderedIds: string[],
): Promise<CategoryWriteResult> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: auth.reason };

  const supabase = await createClient();
  // Postgres has no native multi-row reorder; issue updates in parallel.
  const updates = orderedIds.map((id, index) =>
    supabase.from("categories").update({ sort_order: index }).eq("id", id),
  );
  const results = await Promise.all(updates);
  const failed = results.find((r) => r.error);
  if (failed?.error) return { ok: false, reason: failed.error.message };
  return { ok: true };
}

export async function updateCategoryStatusAction(
  id: string,
  status: CategoryStatus,
): Promise<CategoryWriteResult> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: auth.reason };

  const supabase = await createClient();
  const { error } = await supabase
    .from("categories")
    .update({ status })
    .eq("id", id);
  if (error) return { ok: false, reason: error.message };
  return { ok: true };
}

/**
 * Race-safe NULL→value setter for `first_clear_at`. Triggered automatically
 * when a clear-flagged video appears, so it must NOT require admin (any
 * member's video upload should be able to mark a clear). Returns whether
 * an update actually occurred.
 */
export async function maybeSetFirstClearAtAction(
  categoryId: string,
  isoTimestamp: string,
): Promise<{ updated: boolean; reason?: string }> {
  // Note: NOT admin-gated by design. This fires from the client when a
  // video with a clear keyword is added, and we want any member to be
  // able to surface a clear date — not just admins.
  const supabase = await createClient();
  const { data, error: selErr } = await supabase
    .from("categories")
    .select("first_clear_at")
    .eq("id", categoryId)
    .maybeSingle();
  if (selErr) return { updated: false, reason: selErr.message };
  if (data?.first_clear_at) return { updated: false }; // already set
  const { error: updErr } = await supabase
    .from("categories")
    .update({ first_clear_at: isoTimestamp })
    .eq("id", categoryId)
    .is("first_clear_at", null);
  if (updErr) return { updated: false, reason: updErr.message };
  return { updated: true };
}

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
  filledDetails: Array<{
    slug: string;
    isoDate: string;
    videoTitle: string;
    /**
     * 1.9.17: indicate where the timestamp came from (title-extracted
     * date vs `posted_at` / `created_at`) so the user can see at a
     * glance whether the clear-day matches their video title.
     */
    source: "title" | "posted_at" | "created_at";
    /**
     * Sum of `duration_seconds` for videos in this category between
     * the practice start (1層練習 for Savage; earliest video for
     * Ultimate / 4-person) and the chosen clear timestamp. Same
     * semantics as `fetchTimeToClearByCategory` but computed inline
     * during the backfill so the user sees the resulting time on the
     * action result panel without round-tripping to the cards.
     */
    timeToClearSeconds: number;
    /** Number of foreign-content videos filtered out for this category. */
    excludedForeignCount: number;
    /**
     * 1.9.19: # of videos in the practice→clear window that don't have
     * `duration_seconds` filled. When >0 it means the time-to-clear
     * total is incomplete and the user should run the
     * 「動画時間 + 投稿日時を取得」 action.
     */
    videosWithoutDurationCount: number;
  }>;
  /**
   * 1.9.19: per-category diagnostic for entries that failed to find a
   * clear-flagged video. Lets the user see whether the category had
   * no videos at all, all foreign-content, no 4層クリア title, etc —
   * without having to inspect the DB.
   */
  noMatchDetails: Array<{
    slug: string;
    /** "no-videos" | "all-foreign" | "no-final-floor" | "no-clear-keyword" | "missing-name" */
    reason:
      | "no-videos"
      | "all-foreign"
      | "no-final-floor"
      | "no-clear-keyword"
      | "missing-name";
    videoCount: number;
    inCategoryCount: number;
    /** Up to 5 in-category video titles for visual inspection. */
    titleSamples: string[];
  }>;
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
    .select("id, slug, name, first_clear_at");
  if (catErr || !cats) {
    return {
      ok: false,
      reason: "categories fetch failed: " + (catErr?.message ?? "unknown"),
      alreadySet: 0,
      filled: 0,
      noMatch: 0,
      filledDetails: [],
      noMatchDetails: [],
    };
  }

  let alreadySet = 0;
  let filled = 0;
  let noMatch = 0;
  const filledDetails: BackfillResult["filledDetails"] = [];
  const noMatchDetails: BackfillResult["noMatchDetails"] = [];

  for (const cat of cats) {
    if (cat.first_clear_at && !overwrite) {
      alreadySet += 1;
      continue;
    }
    // Pull all videos in the category. Need duration_seconds so we
    // can compute time-to-clear inline (1.9.17 — used to be a
    // separate render-time aggregation, now surfaced in the action
    // result panel).
    const { data: videos, error: vErr } = await supabase
      .from("category_links")
      .select("title, posted_at, created_at, duration_seconds")
      .eq("category_id", cat.id)
      .eq("kind", "video");
    if (vErr || !videos) {
      noMatch += 1;
      noMatchDetails.push({
        slug: cat.slug as string,
        reason: "no-videos",
        videoCount: 0,
        inCategoryCount: 0,
        titleSamples: [],
      });
      continue;
    }
    const categoryName = (cat as { name?: string | null }).name ?? null;
    const totalVideoCount = videos.length;

    // 1.9.17: filter out videos that classify to a *different* content
    // group than the category. Catches LH-級 videos accidentally added
    // to the Cruiser category etc. Unclassified-on-either-side stays
    // in (lenient — generic titles like "練習会" don't get rejected).
    let excludedForeignCount = 0;
    const inCategory = videos.filter((v) => {
      if (videoBelongsToCategory(v.title as string, categoryName)) return true;
      excludedForeignCount += 1;
      return false;
    });

    // 1.9.17: prefer title-extracted date over `posted_at`. Posts often
    // happen days after the actual raid, so titles like "【2024 08 22】
    // 4層クリア" are a far better signal than the upload time. Fall
    // back to posted_at → created_at for titles without a parseable date.
    type SortedVideo = (typeof inCategory)[number] & {
      effectiveIso: string;
      source: "title" | "posted_at" | "created_at";
    };
    const annotated: SortedVideo[] = inCategory.map((v) => {
      const postedAt = (v.posted_at as string | null) ?? null;
      const createdAt = v.created_at as string;
      const fallbackYear = postedAt
        ? new Date(postedAt).getUTCFullYear()
        : new Date(createdAt).getUTCFullYear();
      const titleD = extractDateFromTitle(v.title as string, fallbackYear);
      if (titleD) {
        // 22:00 JST = 13:00 UTC — pick a stable raid-hour so two
        // videos posted on the same day sort consistently against
        // posted_at fallbacks.
        const iso = new Date(
          Date.UTC(titleD.y, titleD.m - 1, titleD.d, 13, 0, 0),
        ).toISOString();
        return { ...v, effectiveIso: iso, source: "title" as const };
      }
      if (postedAt) {
        return { ...v, effectiveIso: postedAt, source: "posted_at" as const };
      }
      return { ...v, effectiveIso: createdAt, source: "created_at" as const };
    });
    const sorted = [...annotated].sort((a, b) =>
      a.effectiveIso.localeCompare(b.effectiveIso),
    );

    // 1.9.16: tier-aware clear detection. Savage tiers require both a
    // final-floor marker (e.g. "4 層" / "M4S") AND the clear keyword,
    // so a 1-3 層クリア video doesn't prematurely set the date.
    const firstClear = sorted.find((v) =>
      isClearTitleForCategory(v.title as string, categoryName),
    );
    if (!firstClear) {
      noMatch += 1;
      // 1.9.19: classify the failure reason so the user can debug
      // why this category didn't get a clear date set.
      let reason: BackfillResult["noMatchDetails"][number]["reason"];
      if (sorted.length === 0) {
        reason = excludedForeignCount > 0 ? "all-foreign" : "no-videos";
      } else {
        // Did any in-category video have a clear keyword at all?
        // If yes, the issue is the missing final-floor marker
        // (Savage requires "4 層" etc). If no, no clear-flagged video
        // exists yet.
        const anyHasClearKw = sorted.some((v) =>
          /クリア|clear/i.test(v.title as string),
        );
        if (!anyHasClearKw) reason = "no-clear-keyword";
        else reason = "no-final-floor";
      }
      noMatchDetails.push({
        slug: cat.slug as string,
        reason,
        videoCount: totalVideoCount,
        inCategoryCount: sorted.length,
        titleSamples: sorted
          .slice(0, 5)
          .map((v) => v.title as string),
      });
      continue;
    }
    const iso = firstClear.effectiveIso;

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

    // Compute time-to-clear inline using the same in-category sorted
    // list (skips foreign-content videos automatically).
    //   Savage: window starts at the earliest 1-層 practice title.
    //   Ultimate / 4-person: window starts at the earliest video.
    const firstFloorVideo = sorted.find((v) =>
      isFirstFloorPracticeTitle(v.title as string, categoryName),
    );
    const startIso =
      firstFloorVideo?.effectiveIso ?? sorted[0]?.effectiveIso ?? iso;
    let timeToClearSeconds = 0;
    let videosWithoutDurationCount = 0;
    for (const v of sorted) {
      // Only count videos within the practice→clear window.
      if (v.effectiveIso < startIso) continue;
      if (v.effectiveIso > iso) continue;
      const sec = v.duration_seconds as number | null;
      if (typeof sec !== "number" || sec <= 0) {
        videosWithoutDurationCount += 1;
        continue;
      }
      timeToClearSeconds += sec;
    }

    filledDetails.push({
      slug: cat.slug as string,
      isoDate: iso,
      videoTitle: firstClear.title as string,
      source: firstClear.source,
      timeToClearSeconds,
      excludedForeignCount,
      videosWithoutDurationCount,
    });
  }

  return {
    ok: true,
    alreadySet,
    filled,
    noMatch,
    filledDetails,
    noMatchDetails,
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
 * Server Action: set / clear the FFLogs session cookie.
 *
 * SECURITY: This stores the user's logged-in browser session cookie
 * in `app_settings`. Anyone with read access to that table can use
 * the cookie to access the user's FFLogs account. For a small private
 * 固定 with trusted members this is acceptable; for wider access,
 * tighten the RLS policy on the `fflogs_session_cookie` row.
 *
 * The user obtains the cookie value from their browser DevTools while
 * logged into fflogs.com (Application → Cookies → fflogs.com → copy
 * the relevant session cookie value, e.g. `_fflogs_session=...`).
 *
 * Pass empty string to clear.
 */
export async function setFflogsSessionCookie(
  raw: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const trimmed = raw.trim();
  const supabase = await createClient();
  if (!trimmed) {
    const { error } = await supabase
      .from("app_settings")
      .delete()
      .eq("key", "fflogs_session_cookie");
    if (error) return { ok: false, reason: error.message };
    return { ok: true };
  }
  const { error } = await supabase
    .from("app_settings")
    .upsert(
      { key: "fflogs_session_cookie", value: trimmed },
      { onConflict: "key" },
    );
  if (error) return { ok: false, reason: error.message };
  return { ok: true };
}

export async function getFflogsSessionCookieStatus(): Promise<{
  set: boolean;
  preview: string | null;
}> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "fflogs_session_cookie")
    .maybeSingle();
  const value = (data?.value as string | null | undefined) ?? null;
  if (!value) return { set: false, preview: null };
  // Preview just enough to confirm a cookie is stored, without
  // exposing the full value.
  const preview = value.length > 40 ? value.slice(0, 40) + "…" : value;
  return { set: true, preview };
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
    .update({ logs_url: normalized, logs_url_source: "manual" })
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
        logs_url_source: "manual",
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
 * 1.9.21: chunked variant of `backfillVideoDurations` for progress
 * reporting. Each call processes up to `BATCH_SIZE` rows whose `id` is
 * greater than `afterId` (lexicographic ordering — UUIDs sort
 * deterministically), so the client can loop with progress updates.
 *
 * Done when the batch returns fewer than `BATCH_SIZE` rows.
 */
export async function backfillVideoDurationsChunk(opts: {
  afterId?: string | null;
}): Promise<{
  ok: boolean;
  reason?: string;
  /** Rows successfully filled in this chunk. */
  filled: number;
  failed: number;
  skippedNonYoutube: number;
  /** Total pending count snapshot for progress display (computed only
   * on the first call, where afterId is null/undefined). */
  totalPending?: number;
  /** ID of the last row processed in this chunk; pass back as
   * `afterId` on the next call. Null when the batch was empty. */
  lastProcessedId: string | null;
  /** True when there are no more pending rows beyond this chunk. */
  done: boolean;
}> {
  const supabase = await createClient();
  const BATCH_SIZE = 16;
  const FETCH_CONCURRENCY = 8;

  // First-call snapshot: total pending count for progress denominator.
  let totalPending: number | undefined;
  if (!opts.afterId) {
    const { count } = await supabase
      .from("category_links")
      .select("id", { count: "exact", head: true })
      .eq("kind", "video")
      .or("duration_seconds.is.null,posted_at.is.null");
    totalPending = count ?? 0;
    if (totalPending === 0) {
      return {
        ok: true,
        filled: 0,
        failed: 0,
        skippedNonYoutube: 0,
        totalPending: 0,
        lastProcessedId: null,
        done: true,
      };
    }
  }

  // Pull this batch — order by id ascending so afterId pagination is
  // stable across iterations. The pending status itself acts as the
  // primary cursor; the id-GTE filter just prevents reprocessing rows
  // we've already attempted in earlier iterations of this loop.
  const baseQ = supabase
    .from("category_links")
    .select("id, url, duration_seconds, posted_at")
    .eq("kind", "video")
    .or("duration_seconds.is.null,posted_at.is.null");
  const { data, error } = await (opts.afterId
    ? baseQ.gt("id", opts.afterId)
    : baseQ
  )
    .order("id")
    .limit(BATCH_SIZE);
  if (error) {
    return {
      ok: false,
      reason: "fetch failed: " + error.message,
      filled: 0,
      failed: 0,
      skippedNonYoutube: 0,
      totalPending,
      lastProcessedId: null,
      done: false,
    };
  }
  if (!data || data.length === 0) {
    return {
      ok: true,
      filled: 0,
      failed: 0,
      skippedNonYoutube: 0,
      totalPending,
      lastProcessedId: null,
      done: true,
    };
  }

  type Outcome = "filled" | "skipped" | "failed";
  const outcomes = await pmap<(typeof data)[number], Outcome>(
    data,
    FETCH_CONCURRENCY,
    async (row) => {
      const meta = await fetchYouTubeMeta(row.url as string);
      const needsDuration =
        row.duration_seconds === null && meta.durationSeconds !== null;
      const needsPostedAt =
        row.posted_at === null && meta.uploadDate !== null;
      if (!needsDuration && !needsPostedAt) return "skipped";
      const update: { duration_seconds?: number; posted_at?: string } = {};
      if (needsDuration) update.duration_seconds = meta.durationSeconds!;
      if (needsPostedAt) update.posted_at = meta.uploadDate!;
      const { error: updErr } = await supabase
        .from("category_links")
        .update(update)
        .eq("id", row.id as string);
      if (updErr) {
        console.warn(
          "[duration-backfill-chunk] update failed",
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
    filled,
    failed,
    skippedNonYoutube,
    totalPending,
    lastProcessedId: (data[data.length - 1]!.id as string) ?? null,
    done: data.length < BATCH_SIZE,
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
 * "Time to clear" per category — sum of `duration_seconds` between the
 * tier's "1層練習" start and the first-clear timestamp.
 *
 * 1.9.17 added:
 *   - Title-date preferred over posted_at (raid date is a better
 *     signal than upload date)
 *   - Foreign-content videos filtered out via the bilingual classifier
 *     (e.g. an LH-級 video misfiled in the Cruiser category)
 *
 * 1.9.16 had introduced the tier-aware start point:
 *   - Savage tiers: the earliest video whose title matches
 *     `isFirstFloorPracticeTitle` (e.g. "1層", "P1S", "M1S", "M5S").
 *     If none found, falls back to the earliest video.
 *   - Ultimate / 4-person: starts at the earliest video.
 *
 * Returns an empty map for categories without `first_clear_at` set.
 */
export async function fetchTimeToClearByCategory(): Promise<
  Record<string, number>
> {
  const supabase = await createClient();
  // Pull categories that have a first_clear_at + their `name` (needed
  // for tier-aware detection + foreign-video filtering).
  const { data: cats, error: catErr } = await supabase
    .from("categories")
    .select("id, name, first_clear_at")
    .not("first_clear_at", "is", null);
  if (catErr || !cats || cats.length === 0) return {};
  const catIds = cats.map((c) => c.id as string);
  const catInfoMap = new Map<
    string,
    { name: string | null; firstClearAt: string }
  >(
    cats.map((c) => [
      c.id as string,
      {
        name: (c as { name?: string | null }).name ?? null,
        firstClearAt: c.first_clear_at as string,
      },
    ]),
  );

  const { data: videos, error: vErr } = await supabase
    .from("category_links")
    .select("category_id, title, duration_seconds, posted_at, created_at")
    .in("category_id", catIds)
    .eq("kind", "video");
  if (vErr || !videos) return {};

  // Annotate each video with its effective ISO timestamp (title >
  // posted_at > created_at) so subsequent comparisons all use the
  // raid date instead of the upload time.
  const annotated = videos.map((v) => {
    const postedAt = (v.posted_at as string | null) ?? null;
    const createdAt = v.created_at as string;
    const fallbackYear = postedAt
      ? new Date(postedAt).getUTCFullYear()
      : new Date(createdAt).getUTCFullYear();
    const titleD = extractDateFromTitle(v.title as string, fallbackYear);
    const effectiveIso = titleD
      ? new Date(
          Date.UTC(titleD.y, titleD.m - 1, titleD.d, 13, 0, 0),
        ).toISOString()
      : (postedAt ?? createdAt);
    return { ...v, effectiveIso };
  });

  // Group + filter foreign-content videos per category, then sort by
  // effective ISO ascending.
  const byCategory = new Map<string, typeof annotated>();
  for (const v of annotated) {
    const cid = v.category_id as string;
    const info = catInfoMap.get(cid);
    if (!info) continue;
    if (!videoBelongsToCategory(v.title as string, info.name)) continue;
    const list = byCategory.get(cid);
    if (list) list.push(v);
    else byCategory.set(cid, [v]);
  }
  for (const list of byCategory.values()) {
    list.sort((a, b) => a.effectiveIso.localeCompare(b.effectiveIso));
  }

  const totals: Record<string, number> = {};
  for (const cid of catIds) {
    const info = catInfoMap.get(cid);
    if (!info) continue;
    const list = byCategory.get(cid);
    if (!list || list.length === 0) continue;

    const firstFloorVideo = list.find((v) =>
      isFirstFloorPracticeTitle(v.title as string, info.name),
    );
    const startAt = firstFloorVideo?.effectiveIso ?? list[0]!.effectiveIso;

    let total = 0;
    for (const v of list) {
      const sec = v.duration_seconds as number | null;
      if (typeof sec !== "number" || sec <= 0) continue;
      if (v.effectiveIso < startAt) continue;
      if (v.effectiveIso > info.firstClearAt) continue;
      total += sec;
    }
    if (total > 0) totals[cid] = total;
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
