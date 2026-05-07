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
import { extractDateFromTitle, titleDateToIso } from "@/lib/title-date";
import { createClient } from "@/lib/supabase/server";

/**
 * 2.1 (2026-04-29): 動画の posted_at を決定する優先度ロジック。
 *   1. タイトル日付 (extractDateFromTitle, JST 22:00 ISO) — 最も信頼度高
 *   2. YouTube uploadDate (meta.uploadDate) — publisher 提供日
 *   3. null (= 既存値を維持)
 *
 * Vercel IP の bot 検出で YouTube scrape が頻繁に失敗するため、
 * タイトルから日付が取れる動画はそれを優先採用 (ユーザー要望、
 * 2026-04-29)。タイトルにも YouTube にも日付が無い場合は既存値を
 * いじらない (Discord 時刻フォールバックは別経路で残している)。
 */
function resolvePostedAt(
  title: string,
  meta: { uploadDate: string | null },
  existing: string | null,
): string | null {
  // Year-less タイトル ("4/1" 等) のための fallbackYear: YouTube 値があれば
  // それ、無ければ既存 posted_at の年。
  const youtubeYear = meta.uploadDate
    ? new Date(meta.uploadDate).getUTCFullYear()
    : null;
  const existingYear = existing ? new Date(existing).getUTCFullYear() : null;
  const fallbackYear = youtubeYear ?? existingYear ?? undefined;
  const titleIso = titleDateToIso(title, fallbackYear);
  if (titleIso) return titleIso;
  if (meta.uploadDate) return meta.uploadDate;
  return null;
}
import {
  fetchGuildRoles,
  type DiscordGuildRole,
} from "./discord-roles";
import { assertAdminResult } from "./auth";
import { dbError } from "./db-error";
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
  /** TODO #26 (2.1): 自由記述の説明文。空文字 → null として保存。 */
  description: string | null;
  /** TODO #25 (2.1): 手動入力のクリアまでの累計時間 (秒)。NULL = 自動計算優先。 */
  manual_time_to_clear_seconds: number | null;
  /**
   * TODO #45 (2.1): FFLogs auto-link カスタムマッチワード。配列内の
   * いずれかが report.title / zoneName に部分一致 (大小文字無視) すれば
   * cross-group reject を override して確信マッチ扱い。空配列 / NULL =
   * 従来挙動。重複・空白文字列は呼び出し側で除去想定。
   */
  fflogs_match_keywords: string[] | null;
}>;

/**
 * 2.1 (2026-04-29) hot-fix: server-side cache を invalidate するヘルパー。
 *
 * 旧来は anon key の direct write で Supabase Realtime が postgres_changes
 * を browser に流していた。Server Action 経由になっても Realtime 自体は
 * 動くはずだが、ユーザー報告で「更新後ページ更新しないと UI 反映されない」
 * 事象があるため、念のため Next.js の server-side data cache も叩いて
 * RSC を再実行できるよう /category と / を revalidate する。
 *
 * 実際の UI 反映は client 側の `router.refresh()` (dialog onSubmit) と
 * Realtime の二重で担保される。
 */
function revalidateCategoryPages() {
  try {
    revalidatePath("/category");
    revalidatePath("/");
  } catch {
    // best-effort
  }
}

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
    return { ok: false, reason: dbError("カテゴリ作成", error) };
  }
  revalidateCategoryPages();
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
  if (error) return { ok: false, reason: dbError("カテゴリ更新", error) };
  revalidateCategoryPages();
  return { ok: true };
}

export async function deleteCategoryAction(
  id: string,
): Promise<CategoryWriteResult> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: auth.reason };

  const supabase = await createClient();
  const { error } = await supabase.from("categories").delete().eq("id", id);
  if (error) return { ok: false, reason: dbError("カテゴリ削除", error) };
  revalidateCategoryPages();
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
  if (failed?.error) {
    return { ok: false, reason: dbError("並び替え", failed.error) };
  }
  revalidateCategoryPages();
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
  if (error) return { ok: false, reason: dbError("ステータス更新", error) };
  revalidateCategoryPages();
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
  if (selErr) return { updated: false, reason: dbError("クリア日確認", selErr) };
  if (data?.first_clear_at) return { updated: false }; // already set
  const { error: updErr } = await supabase
    .from("categories")
    .update({ first_clear_at: isoTimestamp })
    .eq("id", categoryId)
    .is("first_clear_at", null);
  if (updErr) return { updated: false, reason: dbError("クリア日更新", updErr) };
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
  const auth = await assertAdminResult();
  if (!auth.ok) {
    return {
      ok: false,
      reason: "ADMIN ロールが必要です",
      totalScanned: 0,
      totalInserted: 0,
      totalFailed: 0,
      items: [],
    };
  }
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
      reason: dbError("カテゴリ取得", catErr),
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
  const auth = await assertAdminResult();
  if (!auth.ok) {
    return {
      ok: false,
      reason: "ADMIN ロールが必要です",
      scanned: 0,
      parsed: 0,
      inserted: 0,
      duplicates: 0,
    };
  }
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
  /**
   * char-sheets で CANDIDATE 状態の rawDate に該当する `source='snapshot'`
   * row を delete した件数。過去のバグで蓄積された CANDIDATE 由来 row を
   * 次回 snapshot 実行時に自動掃除する。
   */
  cleanedCandidates: number;
};

/**
 * Server Action: pull the configured FFLogs username's reports and
 * auto-link each report to a matching video (by ±36h window on the
 * report's start timestamp). Each report claims at most one video.
 */
export async function linkFflogsReports(): Promise<FflogsLinkResult> {
  const auth = await assertAdminResult();
  if (!auth.ok) {
    return {
      ok: false,
      reason: "ADMIN ロールが必要です",
      reportsScanned: 0,
      videosScanned: 0,
      matched: 0,
      sessionsScanned: 0,
      sessionsMatched: 0,
      details: [],
    };
  }
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
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: "ADMIN ロールが必要です" };
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
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: "ADMIN ロールが必要です" };
  const trimmed = raw.trim();
  const supabase = await createClient();
  // 既存 plaintext (旧 app_settings) は念のため常に消す。新 secrets
  // テーブル側で暗号化保存し直す or clear を実行 (TODO #35)。
  await supabase
    .from("app_settings")
    .delete()
    .eq("key", "fflogs_session_cookie");

  if (!trimmed) {
    // clear: secrets 側も消す
    const { deleteSecretValue } = await import("./secret-store");
    await deleteSecretValue("fflogs_session_cookie");
    return { ok: true };
  }

  const { setSecretValue } = await import("./secret-store");
  const stored = await setSecretValue("fflogs_session_cookie", trimmed);
  if (!stored.ok) {
    return {
      ok: false,
      reason:
        "暗号化保存に失敗: " +
        stored.reason +
        " (SECRET_ENCRYPTION_KEY と SUPABASE_SERVICE_ROLE_KEY を env に設定してください)",
    };
  }
  return { ok: true };
}

export async function getFflogsSessionCookieStatus(): Promise<{
  set: boolean;
  preview: string | null;
}> {
  // secrets テーブル (暗号化) を優先、無ければ旧 app_settings (平文)
  // を fallback として確認。preview だけ返すので decrypt 結果は捨てる。
  const { getSecretValue } = await import("./secret-store");
  const encrypted = await getSecretValue("fflogs_session_cookie");
  if (encrypted) {
    const preview =
      encrypted.length > 40 ? encrypted.slice(0, 40) + "…" : encrypted;
    return { set: true, preview };
  }
  const supabase = await createClient();
  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "fflogs_session_cookie")
    .maybeSingle();
  const value = (data?.value as string | null | undefined) ?? null;
  if (!value) return { set: false, preview: null };
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
  const auth = await assertAdminResult();
  if (!auth.ok) {
    return {
      ok: false,
      reason: "ADMIN ロールが必要です",
      videosCleared: 0,
      sessionsCleared: 0,
    };
  }
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
      reason: dbError("動画 logs_url クリア", vidsErr),
      videosCleared: 0,
      sessionsCleared: 0,
    };
  }
  // TODO #64 (2.1, 2026-05-02 part5): wipe all rows in the new
  // `schedule_past_session_logs` table — both 'auto' and 'manual'.
  // Per the existing comment, this matches the legacy behavior of
  // `update logs_url=null` (which cleared everything regardless of
  // source). Users who want to preserve manual entries should delete
  // them individually from the memo popover instead.
  const { data: ses, error: sesErr } = await supabase
    .from("schedule_past_session_logs")
    .delete()
    .not("id", "is", null)
    .select("id");
  if (sesErr) {
    return {
      ok: false,
      reason: dbError("過去予定 logs_url クリア", sesErr),
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
 * TODO #64 (2.1, 2026-05-02 part5): append a new manual FFLogs URL to
 * `schedule_past_session_logs` for the given session date.
 *
 * Replaces the legacy `setSessionLogsUrl` which UPDATE'd a single
 * `schedule_past_sessions.logs_url` text column. The new model
 * supports multiple URLs per date — each call appends one row with
 * `source='manual'`.
 *
 * Upserts the parent row first when `sessionDetails` is supplied so
 * "live session not yet snapshotted" cases still work. The FK from
 * the logs table to `schedule_past_sessions.raw_date` requires the
 * parent row to exist before the child insert.
 */
export async function addSessionLogsUrl(
  rawDate: string,
  logsUrl: string,
  sessionDetails?: {
    parsedDate: string;
    startTime: string;
    endTime: string;
    dayOfWeek: string;
  },
): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: "ADMIN ロールが必要です" };
  const trimmedDate = rawDate.trim();
  if (!trimmedDate) {
    return { ok: false, reason: "rawDate が空です" };
  }
  const t = logsUrl.trim();
  if (!t) {
    return { ok: false, reason: "FFLogs URL を入力してください" };
  }
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

  const supabase = await createClient();
  // Ensure parent row exists. If the session hasn't been snapshotted
  // yet but the caller knows the session shape (passed via the
  // popover), insert a `source='manual'` placeholder row.
  const { data: existing } = await supabase
    .from("schedule_past_sessions")
    .select("raw_date")
    .eq("raw_date", trimmedDate)
    .maybeSingle();
  if (!existing) {
    if (!sessionDetails) {
      return {
        ok: false,
        reason:
          "対象の過去予定が見つかりませんでした — 先にスナップショットを取るか、セッション情報を含めて再度お試しください",
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
      });
    if (insErr) return { ok: false, reason: dbError("過去予定登録", insErr) };
  }

  const { data: inserted, error: logErr } = await supabase
    .from("schedule_past_session_logs")
    .insert({ raw_date: trimmedDate, url: t, source: "manual" })
    .select("id")
    .single();
  if (logErr) {
    // Likely UNIQUE (raw_date, url) violation — surface a friendlier
    // message so users know the URL is already linked.
    if ((logErr as { code?: string }).code === "23505") {
      return { ok: false, reason: "同じ URL が既に紐付いています" };
    }
    return { ok: false, reason: dbError("logs URL 追加", logErr) };
  }
  try {
    revalidatePath("/");
  } catch {
    // best-effort
  }
  return { ok: true, id: inserted.id as string };
}

/**
 * TODO #64: delete a single row from `schedule_past_session_logs` by
 * its primary key. Used by the memo popover to remove an existing
 * URL entry — both 'auto' and 'manual' rows are deletable so the user
 * can clean up wrong auto-matches inline.
 */
export async function deleteSessionLogsUrl(
  id: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: "ADMIN ロールが必要です" };
  const trimmed = id.trim();
  if (!trimmed) {
    return { ok: false, reason: "id が空です" };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("schedule_past_session_logs")
    .delete()
    .eq("id", trimmed);
  if (error) return { ok: false, reason: dbError("logs URL 削除", error) };
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
  const auth = await assertAdminResult();
  if (!auth.ok) {
    return {
      ok: false,
      reason: "ADMIN ロールが必要です",
      scanned: 0,
      inserted: 0,
      updated: 0,
      cleanedCandidates: 0,
    };
  }
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
  /** Recent rows for UI inspection / per-row deletion. */
  recentRows: { rawDate: string; parsedDate: string; source: string | null }[];
}> {
  const supabase = await createClient();
  const { count, error: cErr } = await supabase
    .from("schedule_past_sessions")
    .select("raw_date", { count: "exact", head: true });
  if (cErr) {
    return {
      ok: false,
      reason: dbError("過去予定件数取得", cErr),
      count: 0,
      recentRows: [],
    };
  }
  // Pull recent rows so the user can verify content + delete stale ones
  // (e.g. dates that came from old Discord messages that have since been
  // determined to be non-events).
  const { data } = await supabase
    .from("schedule_past_sessions")
    .select("raw_date, parsed_date, source")
    .order("parsed_date", { ascending: false })
    .limit(20);
  return {
    ok: true,
    count: count ?? 0,
    recentRows: (data ?? []).map((r) => ({
      rawDate: r.raw_date as string,
      parsedDate: r.parsed_date as string,
      source: (r.source as string | null) ?? null,
    })),
  };
}

/**
 * Server Action: delete a single row from `schedule_past_sessions` by
 * `raw_date`. Used by the settings dialog when the user wants to remove
 * a stale entry that shouldn't appear in past history (e.g. a date that
 * was imported from Discord but the session never actually happened, or
 * an older importer leaked a future-dated row that has since aged into
 * the past).
 */
export async function deleteStoredPastSession(rawDate: string): Promise<{
  ok: boolean;
  reason?: string;
}> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: "ADMIN ロールが必要です" };
  const trimmed = rawDate?.trim();
  if (!trimmed) return { ok: false, reason: "raw_date is empty" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("schedule_past_sessions")
    .delete()
    .eq("raw_date", trimmed);
  if (error) return { ok: false, reason: dbError("過去予定削除", error) };
  return { ok: true };
}

/**
 * Server Action wrappers for `app_settings` writes (schedule URL,
 * Discord channel ID, FFLogs username) — assertAdminResult-gated.
 *
 * 旧設計では `schedule-url-store.ts` の "use client" 経由で anon key
 * 直接書き込みしていたため、RLS が締まっていない (HANDOFF 既知) この
 * リポでは誰でも書き換え可能だった。これを admin gate するため、書き
 * 込み path だけ server action 化。reader (client 側 SELECT) は anon
 * key で読めれば良いので schedule-url-store.ts に残置。
 */
export async function setScheduleUrlAction(
  rawUrl: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: "ADMIN ロールが必要です" };
  const url = rawUrl.trim();
  if (!url) return { ok: false, reason: "URLを入力してください" };
  if (!/^https?:\/\//i.test(url)) {
    return { ok: false, reason: "http:// または https:// で始めてください" };
  }
  try {
    new URL(url);
  } catch {
    return { ok: false, reason: "URLの形式が正しくありません" };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("app_settings")
    .upsert({ key: "schedule_url", value: url }, { onConflict: "key" });
  if (error) return { ok: false, reason: dbError("URL 保存", error) };
  try {
    revalidatePath("/");
  } catch {
    // best-effort
  }
  return { ok: true };
}

export async function setDiscordScheduleChannelIdAction(
  rawId: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: "ADMIN ロールが必要です" };
  const id = rawId.trim();
  const supabase = await createClient();
  if (!id) {
    const { error } = await supabase
      .from("app_settings")
      .delete()
      .eq("key", "discord_schedule_channel_id");
    if (error) return { ok: false, reason: dbError("チャンネル ID 削除", error) };
    return { ok: true };
  }
  if (!/^\d{17,20}$/.test(id)) {
    return { ok: false, reason: "チャンネル ID は 17〜20 桁の数字です" };
  }
  const { error } = await supabase
    .from("app_settings")
    .upsert(
      { key: "discord_schedule_channel_id", value: id },
      { onConflict: "key" },
    );
  if (error) return { ok: false, reason: dbError("チャンネル ID 保存", error) };
  return { ok: true };
}

/**
 * Server-action wrappers for `category_links` CRUD — assertAdminResult-gated.
 *
 * 旧設計では `lib/category-links-client.ts` の "use client" 経由で anon
 * key 直接書き込みしていたため、RLS が締まっていない (HANDOFF 既知)
 * このリポでは誰でも書き換え可能だった。これを admin gate するため、
 * 書き込み path だけ server action 化。`useRealtimeCategoryLinks` の
 * subscription / refetch は read-only なので client 側に残置。
 */
export async function createCategoryLinkAction(input: {
  categoryId: string;
  kind: "strategy" | "video";
  title: string;
  url: string;
  description?: string;
  logsUrl?: string | null;
}): Promise<{ ok: true; linkId: string } | { ok: false; reason: string }> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: "ADMIN ロールが必要です" };
  const { isSafeUrl } = await import("@/lib/url-safe");
  if (!isSafeUrl(input.url)) {
    return {
      ok: false,
      reason:
        "URL は http:// または https:// で始まる正しい URL である必要があります",
    };
  }
  if (input.logsUrl && !isSafeUrl(input.logsUrl)) {
    return {
      ok: false,
      reason:
        "Logs URL は http:// または https:// で始まる正しい URL である必要があります",
    };
  }
  const supabase = await createClient();
  const { data: maxRow } = await supabase
    .from("category_links")
    .select("sort_order")
    .eq("category_id", input.categoryId)
    .eq("kind", input.kind)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder = ((maxRow?.sort_order as number | undefined) ?? -1) + 1;
  const { data, error } = await supabase
    .from("category_links")
    .insert({
      category_id: input.categoryId,
      kind: input.kind,
      title: input.title,
      url: input.url,
      description: input.description ?? null,
      logs_url: input.logsUrl ?? null,
      logs_url_source: "manual",
      sort_order: nextOrder,
    })
    .select("id")
    .single();
  if (error || !data) {
    return { ok: false, reason: dbError("リンク作成", error) };
  }
  return { ok: true, linkId: data.id as string };
}

export async function updateCategoryLinkAction(
  id: string,
  patch: Partial<{
    title: string;
    url: string;
    description: string | null;
    logs_url: string | null;
  }>,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: "ADMIN ロールが必要です" };
  const { isSafeUrl } = await import("@/lib/url-safe");
  if (patch.url !== undefined && !isSafeUrl(patch.url)) {
    return {
      ok: false,
      reason:
        "URL は http:// または https:// で始まる正しい URL である必要があります",
    };
  }
  if (
    patch.logs_url !== undefined &&
    patch.logs_url !== null &&
    !isSafeUrl(patch.logs_url)
  ) {
    return {
      ok: false,
      reason:
        "Logs URL は http:// または https:// で始まる正しい URL である必要があります",
    };
  }
  const supabase = await createClient();
  const dbPatch: Record<string, unknown> = { ...patch };
  if ("logs_url" in patch) {
    dbPatch.logs_url_source = "manual";
  }
  const { error } = await supabase
    .from("category_links")
    .update(dbPatch)
    .eq("id", id);
  if (error) return { ok: false, reason: dbError("リンク更新", error) };
  return { ok: true };
}

export async function deleteCategoryLinkAction(
  id: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: "ADMIN ロールが必要です" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("category_links")
    .delete()
    .eq("id", id);
  if (error) return { ok: false, reason: dbError("リンク削除", error) };
  return { ok: true };
}

/**
 * TODO #47 (2.1, 2026-04-30): toggle the per-link favorite flag.
 * Admin-gated to match the rest of `category_links` writes — keeping
 * "shared single-tenant" semantics; everyone sees the same favorites.
 */
export async function setCategoryLinkFavoriteAction(
  id: string,
  isFavorite: boolean,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: "ADMIN ロールが必要です" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("category_links")
    .update({ is_favorite: isFavorite })
    .eq("id", id);
  if (error) return { ok: false, reason: dbError("お気に入り更新", error) };
  return { ok: true };
}

export async function setCategoryLinkOrderAction(
  orderedIds: string[],
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: "ADMIN ロールが必要です" };
  const supabase = await createClient();
  const results = await Promise.all(
    orderedIds.map((id, index) =>
      supabase
        .from("category_links")
        .update({ sort_order: index })
        .eq("id", id),
    ),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) {
    return { ok: false, reason: dbError("リンク並び替え", failed.error) };
  }
  return { ok: true };
}

export async function setFflogsUsernameAction(
  raw: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: "ADMIN ロールが必要です" };
  const trimmed = raw.trim();
  const supabase = await createClient();
  if (!trimmed) {
    const { error } = await supabase
      .from("app_settings")
      .delete()
      .eq("key", "fflogs_username");
    if (error) return { ok: false, reason: dbError("FFLogs ユーザー名削除", error) };
    return { ok: true };
  }
  // URL で渡された場合は表示名部分を抽出 (旧 parseFflogsDisplayName 同等)
  let value = trimmed;
  if (/fflogs\.com/i.test(trimmed)) {
    try {
      const u = new URL(trimmed);
      const segs = u.pathname.split("/").filter(Boolean);
      const userIdx = segs.indexOf("user");
      if (userIdx < 0 || userIdx + 1 >= segs.length) {
        return { ok: false, reason: "URL から表示名を抽出できませんでした" };
      }
      const next = segs[userIdx + 1]!;
      if (next === "reports-list") {
        return {
          ok: false,
          reason:
            "URL 末尾の数字 ID は API で使えません — fflogs.com/profile で表示名を確認してください",
        };
      }
      const name = decodeURIComponent(next);
      if (/^\d+$/.test(name)) {
        return {
          ok: false,
          reason: "数値 ID ではなく表示名（display name）を入力してください",
        };
      }
      value = name;
    } catch {
      return { ok: false, reason: "URL 形式不正" };
    }
  } else {
    const cleaned = trimmed.replace(/^[\s"']+|[\s"']+$/g, "");
    if (!cleaned) return { ok: false, reason: "空文字は受け付けません" };
    if (/^\d+$/.test(cleaned)) {
      return {
        ok: false,
        reason:
          "数値 ID ではなく表示名を入力してください（fflogs.com/profile の見出しに記載）",
      };
    }
    value = cleaned;
  }
  const { error } = await supabase
    .from("app_settings")
    .upsert({ key: "fflogs_username", value }, { onConflict: "key" });
  if (error) return { ok: false, reason: dbError("FFLogs ユーザー名保存", error) };
  return { ok: true };
}

/**
 * Server Action: backfill `category_links.posted_at` from each
 * configured Discord channel's recent message timestamps. Run this
 * before "クリア日時を強制再計算" so the recomputed first-clear dates
 * pick up the actual Discord post times (instead of created_at, which
 * is the same for everything imported in one cron run).
 */
export async function backfillPostedAtFromDiscordChannels(): Promise<PostedAtBackfillResult> {
  const auth = await assertAdminResult();
  if (!auth.ok) {
    return {
      ok: false,
      reason: "ADMIN ロールが必要です",
      scannedMessages: 0,
      scannedUrls: 0,
      matched: 0,
      updated: 0,
      channels: [],
    };
  }
  return backfillPostedAtFromDiscord();
}

/**
 * Server Action: fetch YouTube meta (duration + upload date) for an
 * existing link and persist both columns. Called by the link form
 * dialog after a manual create — the dialog inserts the row first
 * (browser-side), then asks us to enrich.
 *
 * 2.1 (2026-04-29、TODO #22 追加対応): `posted_at` は YouTube uploadDate が
 * 取れた場合 **常に上書き** に変更。旧設計では Discord メッセージ時刻が
 * 真とされていたが、古い動画 (例: 2023 年録画) を 2026 年に Discord に
 * 貼った場合 Discord 時刻 = 2026 となり、スケジュール↔動画紐付けで誤マッチ
 * が起きる問題があった (`session-video-link.ts`)。YouTube uploadDate は
 * publisher 側の真の公開日なので、ある場合はそちらを優先する。
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

  // posted_at: 常に YouTube uploadDate で上書き (TODO #22 追加対応)。
  if (meta.uploadDate !== null) {
    const { error } = await supabase
      .from("category_links")
      .update({ posted_at: meta.uploadDate })
      .eq("id", linkId);
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
 * - `posted_at`: 常に YouTube uploadDate で上書き (TODO #22 追加対応)。
 *   旧設計の「Discord 時刻が真」前提は古い動画の後追い投稿で破綻するため、
 *   YouTube 側の publisher 公開日を優先する。
 *
 * Idempotent — re-running is a no-op once everything fetchable has been
 * filled. Runs fetches concurrently to keep wall-clock time reasonable
 * for groups with hundreds of historical videos.
 */
export async function backfillVideoDurations(): Promise<DurationBackfillResult> {
  const auth = await assertAdminResult();
  if (!auth.ok) {
    return {
      ok: false,
      reason: "ADMIN ロールが必要です",
      scanned: 0,
      filled: 0,
      failed: 0,
      skippedNonYoutube: 0,
    };
  }
  const supabase = await createClient();
  // Pull rows that are missing EITHER column. Without OR, a row that
  // already has duration_seconds (filled in a prior run) but NULL
  // posted_at would be left behind permanently.
  const { data, error } = await supabase
    .from("category_links")
    .select("id, url, title, duration_seconds, posted_at")
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
      // 2.1 (2026-04-29): posted_at は タイトル日付 → YouTube uploadDate
      // の優先度で解決し、現在値と異なれば上書き。YouTube 取得失敗時も
      // タイトルから日付が取れれば反映される (= Vercel の bot 検出で
      // YouTube が動かなくてもクリア紐付けが復旧する)。
      const newPostedAt = resolvePostedAt(
        row.title as string,
        meta,
        (row.posted_at as string | null) ?? null,
      );
      const needsPostedAt =
        newPostedAt !== null && newPostedAt !== (row.posted_at ?? null);
      if (!needsDuration && !needsPostedAt) {
        // Either non-YouTube, or scrape didn't return useful data, or
        // the row already has the value we'd write. Bucket as "skipped".
        return "skipped";
      }
      const update: { duration_seconds?: number; posted_at?: string } = {};
      if (needsDuration) update.duration_seconds = meta.durationSeconds!;
      if (needsPostedAt) update.posted_at = newPostedAt!;
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
 *
 * `forceRefresh`: 全動画 row を対象に YouTube uploadDate を再取得し
 * `posted_at` を上書きする。既に Discord 時刻で埋まっていて TODO #22 の
 * 「古い動画を直近セッションに誤紐付け」を起こしている row を一括修復する
 * 用途。フラグ無し時は従来どおり「missing data 行のみ」処理。
 */
export async function backfillVideoDurationsChunk(opts: {
  afterId?: string | null;
  forceRefresh?: boolean;
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
  const auth = await assertAdminResult();
  if (!auth.ok) {
    return {
      ok: false,
      reason: "ADMIN ロールが必要です",
      filled: 0,
      failed: 0,
      skippedNonYoutube: 0,
      lastProcessedId: null,
      done: true,
    };
  }
  const supabase = await createClient();
  const BATCH_SIZE = 16;
  const FETCH_CONCURRENCY = 8;
  const force = opts.forceRefresh === true;

  // First-call snapshot: total pending count for progress denominator.
  let totalPending: number | undefined;
  if (!opts.afterId) {
    let countQ = supabase
      .from("category_links")
      .select("id", { count: "exact", head: true })
      .eq("kind", "video");
    if (!force) {
      countQ = countQ.or("duration_seconds.is.null,posted_at.is.null");
    }
    const { count } = await countQ;
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
  let baseQ = supabase
    .from("category_links")
    .select("id, url, title, duration_seconds, posted_at")
    .eq("kind", "video");
  if (!force) {
    baseQ = baseQ.or("duration_seconds.is.null,posted_at.is.null");
  }
  const { data, error } = await (opts.afterId
    ? baseQ.gt("id", opts.afterId)
    : baseQ
  )
    .order("id")
    .limit(BATCH_SIZE);
  if (error) {
    return {
      ok: false,
      reason: dbError("動画一覧取得", error),
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
      // 2.1 (2026-04-29): posted_at は タイトル日付 → YouTube uploadDate
      // の優先度で解決 (詳細は resolvePostedAt 定義部参照)。
      const newPostedAt = resolvePostedAt(
        row.title as string,
        meta,
        (row.posted_at as string | null) ?? null,
      );
      const needsPostedAt =
        newPostedAt !== null && newPostedAt !== (row.posted_at ?? null);
      if (!needsDuration && !needsPostedAt) return "skipped";
      const update: { duration_seconds?: number; posted_at?: string } = {};
      if (needsDuration) update.duration_seconds = meta.durationSeconds!;
      if (needsPostedAt) update.posted_at = newPostedAt!;
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
