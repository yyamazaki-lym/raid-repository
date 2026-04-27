import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchAppSetting } from "@/lib/supabase/app-settings";

/**
 * FFLogs API v1 wrapper. Fetches a user's report list and matches
 * each report to an existing video link by timestamp.
 *
 * Endpoint:
 *   https://www.fflogs.com/v1/reports/user/{username}?api_key=KEY
 *
 * Response shape (each entry):
 *   { id, title, owner, start, end, zone, fights[] }
 *   start/end are unix-millis. We use `start` as the report's
 *   "posted at" for matching.
 *
 * Setup needs:
 *   - FFLOGS_API_KEY env var (server-side)
 *   - `fflogs_username` setting in app_settings
 */

export type FflogsReport = {
  id: string;
  title: string;
  /** Unix millis of the first pull. */
  startMs: number;
  /** Unix millis of the last pull. */
  endMs: number;
  /** FFLogs zone id. Useful for content-name correlation later. */
  zone: number | null;
};

const FFLOGS_API_BASE = "https://www.fflogs.com/v1";

export async function fetchFflogsReports(
  username: string,
  options: { page?: number } = {},
): Promise<{ ok: true; reports: FflogsReport[] } | { ok: false; reason: string }> {
  const apiKey = process.env.FFLOGS_API_KEY?.trim();
  if (!apiKey) return { ok: false, reason: "FFLOGS_API_KEY 未設定" };
  const url = new URL(`${FFLOGS_API_BASE}/reports/user/${encodeURIComponent(username)}`);
  url.searchParams.set("api_key", apiKey);
  if (options.page !== undefined) url.searchParams.set("page", String(options.page));

  try {
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        ok: false,
        reason: `fflogs ${res.status}: ${body.slice(0, 200)}`,
      };
    }
    const data = (await res.json()) as Array<{
      id: string;
      title?: string;
      start: number;
      end: number;
      zone?: number;
    }>;
    if (!Array.isArray(data)) {
      return {
        ok: false,
        reason: "unexpected response shape (expected array)",
      };
    }
    return {
      ok: true,
      reports: data.map((r) => ({
        id: r.id,
        title: r.title ?? "",
        startMs: r.start,
        endMs: r.end,
        zone: r.zone ?? null,
      })),
    };
  } catch (e) {
    return { ok: false, reason: "fetch error: " + String(e) };
  }
}

export type FflogsLinkResult = {
  ok: boolean;
  reason?: string;
  /** Reports retrieved from the FFLogs API. */
  reportsScanned: number;
  /** Videos checked for matching (kind=video, logs_url IS NULL). */
  videosScanned: number;
  /** Videos that got their logs_url set this run. */
  matched: number;
  /** Per-video detail for the result panel. */
  details: Array<{
    videoTitle: string;
    reportTitle: string;
    reportUrl: string;
  }>;
};

const MATCH_WINDOW_MS = 36 * 60 * 60 * 1000;

/**
 * Match FFLogs reports to videos that don't yet have a logs_url.
 *
 * Match rule:
 *   - For each video without `logs_url`, find the FFLogs report
 *     whose `start` is within 36h before the video's posted_at
 *     (created_at fallback). The earliest matching report wins.
 *   - Each report can match at most one video (used-set), mirroring
 *     the video↔session matching heuristic.
 */
export async function linkFflogsReportsToVideos(): Promise<FflogsLinkResult> {
  const username = (await fetchAppSetting("fflogs_username"))?.trim();
  if (!username) {
    return {
      ok: false,
      reason: "FFLogs ユーザー名が未設定（設定ダイアログから保存してください）",
      reportsScanned: 0,
      videosScanned: 0,
      matched: 0,
      details: [],
    };
  }

  const reportsResult = await fetchFflogsReports(username);
  if (!reportsResult.ok) {
    return {
      ok: false,
      reason: reportsResult.reason,
      reportsScanned: 0,
      videosScanned: 0,
      matched: 0,
      details: [],
    };
  }
  const reports = reportsResult.reports;
  if (reports.length === 0) {
    return {
      ok: true,
      reportsScanned: 0,
      videosScanned: 0,
      matched: 0,
      details: [],
    };
  }

  const supabase = await createClient();
  const { data: videos } = await supabase
    .from("category_links")
    .select("id, title, posted_at, created_at, logs_url")
    .eq("kind", "video")
    .is("logs_url", null);
  if (!videos || videos.length === 0) {
    return {
      ok: true,
      reportsScanned: reports.length,
      videosScanned: 0,
      matched: 0,
      details: [],
    };
  }

  // Sort videos oldest-first so each report claims the chronologically
  // earliest unmatched video that fits its window.
  const sortedVideos = [...videos]
    .map((v) => {
      const ts = (v.posted_at as string | null) ?? (v.created_at as string);
      const tMs = new Date(ts).getTime();
      return { ...v, tMs: Number.isNaN(tMs) ? null : tMs };
    })
    .filter((v): v is typeof v & { tMs: number } => v.tMs !== null)
    .sort((a, b) => a.tMs - b.tMs);

  // Sort reports oldest-first too — earlier reports typically match
  // earlier videos.
  const sortedReports = [...reports].sort((a, b) => a.startMs - b.startMs);

  const usedReports = new Set<string>();
  const details: FflogsLinkResult["details"] = [];
  let matched = 0;

  for (const video of sortedVideos) {
    const lo = video.tMs - MATCH_WINDOW_MS;
    const hi = video.tMs + MATCH_WINDOW_MS;
    // Earliest unmatched report in window.
    const report = sortedReports.find(
      (r) =>
        !usedReports.has(r.id) && r.startMs >= lo && r.startMs <= hi,
    );
    if (!report) continue;
    const logsUrl = `https://www.fflogs.com/reports/${report.id}`;
    const { error: updErr } = await supabase
      .from("category_links")
      .update({ logs_url: logsUrl })
      .eq("id", video.id as string)
      .is("logs_url", null);
    if (updErr) {
      console.warn(
        "[fflogs-link] update failed",
        video.id,
        updErr.message,
      );
      continue;
    }
    usedReports.add(report.id);
    matched += 1;
    details.push({
      videoTitle: video.title as string,
      reportTitle: report.title || "(無題のレポート)",
      reportUrl: logsUrl,
    });
  }

  return {
    ok: true,
    reportsScanned: reports.length,
    videosScanned: sortedVideos.length,
    matched,
    details,
  };
}
