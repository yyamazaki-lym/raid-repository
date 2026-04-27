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
      // 401 = invalid API key. The error message from FFLogs itself
      // ("Invalid key specified.") doesn't tell the user WHAT to do,
      // so surface a concrete remediation hint here.
      if (res.status === 401) {
        return {
          ok: false,
          reason:
            "FFLOGS_API_KEY が無効です — Vercel Settings → Environment Variables で v1 Web API キーを確認してください（fflogs.com/profile の Web API セクション。V2 OAuth の client_id/secret ではなく v1 キー）",
        };
      }
      // 404 on the user endpoint usually means the username doesn't
      // exist or has no public reports.
      if (res.status === 404) {
        return {
          ok: false,
          reason: `fflogs 404: ユーザー「${username}」が見つかりません（綴りまたは公開設定を確認）`,
        };
      }
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
        // FFLogs v1 returns `start`/`end` as Unix MILLISECONDS — but
        // some code paths in the wild treat them as seconds. Detect
        // by magnitude: a seconds-epoch value for a 2024+ raid is
        // ~1.7e9 (10 digits), milliseconds is ~1.7e12 (13 digits).
        // Anything under 1e11 must be seconds → multiply by 1000.
        // Without this normalization, all matches fail because the
        // report timestamps land in 1970 and don't fit any video /
        // session window.
        startMs: r.start < 1e11 ? r.start * 1000 : r.start,
        endMs: r.end < 1e11 ? r.end * 1000 : r.end,
        zone: r.zone ?? null,
      })),
    };
  } catch (e) {
    return { ok: false, reason: "fetch error: " + String(e) };
  }
}

export type FflogsLinkDetail = {
  /** Whether this match was for a video card or a past session. */
  kind: "video" | "session";
  /** Video title for `kind=video`, raw_date string for `kind=session`. */
  label: string;
  reportTitle: string;
  reportUrl: string;
};

export type FflogsLinkResult = {
  ok: boolean;
  reason?: string;
  /** Reports retrieved from the FFLogs API. */
  reportsScanned: number;
  /** Videos checked for matching (kind=video, logs_url IS NULL). */
  videosScanned: number;
  /** Videos that got their logs_url set this run. */
  matched: number;
  /** Past sessions checked (logs_url IS NULL). */
  sessionsScanned: number;
  /** Past sessions that got their logs_url set this run. */
  sessionsMatched: number;
  /** Per-match detail for the result panel. */
  details: FflogsLinkDetail[];
  /** Diagnostic — date range of fetched FFLogs reports (for empty-match debugging). */
  reportsDateRange?: { earliest: string; latest: string };
  /** Diagnostic — date range of unmatched videos. */
  videosDateRange?: { earliest: string; latest: string };
  /** Diagnostic — date range of unmatched sessions. */
  sessionsDateRange?: { earliest: string; latest: string };
};

// Video matching window: ±36h around the video's posted_at. Generous
// because videos are often uploaded the morning after a late-night
// session, and sometimes pre-recorded.
const MATCH_WINDOW_MS = 36 * 60 * 60 * 1000;
// Session matching window: tighter, since sessions are scheduled. The
// FFLogs report's start should land near the session's start_time:
// 1h grace before (people log in early) and 4h after (covers the full
// raid plus overrun).
const SESSION_WINDOW_BEFORE_MS = 1 * 60 * 60 * 1000;
const SESSION_WINDOW_AFTER_MS = 4 * 60 * 60 * 1000;

/**
 * Match FFLogs reports to videos AND past sessions in one pass.
 *
 * The two linkers run independently — the same FFLogs report can be
 * claimed by both one video AND one session (a recorded raid night
 * has both: a video that got uploaded, plus the session itself).
 *
 * Match rules:
 *   - Video: report.start within ±36h of video.posted_at. Generous
 *     because videos are often uploaded the morning after.
 *   - Session: report.start within [session_start - 1h, session_start
 *     + 4h]. Tighter because raid times are scheduled.
 *
 * Each linker greedily claims the earliest unmatched report that fits
 * the target's window — same heuristic as the video↔session matching.
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
      sessionsScanned: 0,
      sessionsMatched: 0,
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
      sessionsScanned: 0,
      sessionsMatched: 0,
      details: [],
    };
  }
  const reports = reportsResult.reports;

  // Run both linkers (independently — they don't share their used-set
  // because each FFLogs report legitimately maps to both a video and
  // a session for the same raid night).
  const supabase = await createClient();
  const [videoResult, sessionResult] = await Promise.all([
    linkReportsToVideos(supabase, reports),
    linkReportsToSessions(supabase, reports),
  ]);

  // Compute report date range for diagnostics — if matched=0 the user
  // can compare this against video / session ranges to see if the
  // problem is "no overlap" (different time periods) vs "match logic
  // bug".
  const sortedReports = [...reports].sort((a, b) => a.startMs - b.startMs);
  const reportsDateRange = sortedReports.length > 0
    ? {
        earliest: new Date(sortedReports[0]!.startMs).toISOString().slice(0, 10),
        latest: new Date(
          sortedReports[sortedReports.length - 1]!.startMs,
        ).toISOString().slice(0, 10),
      }
    : undefined;

  return {
    ok: true,
    reportsScanned: reports.length,
    videosScanned: videoResult.scanned,
    matched: videoResult.matched,
    sessionsScanned: sessionResult.scanned,
    sessionsMatched: sessionResult.matched,
    details: [...videoResult.details, ...sessionResult.details],
    reportsDateRange,
    videosDateRange: videoResult.dateRange,
    sessionsDateRange: sessionResult.dateRange,
  };
}

type SupabaseLike = Awaited<ReturnType<typeof createClient>>;

async function linkReportsToVideos(
  supabase: SupabaseLike,
  reports: FflogsReport[],
): Promise<{
  scanned: number;
  matched: number;
  details: FflogsLinkDetail[];
  dateRange?: { earliest: string; latest: string };
}> {
  if (reports.length === 0) return { scanned: 0, matched: 0, details: [] };

  const { data: videos } = await supabase
    .from("category_links")
    .select("id, title, posted_at, created_at, logs_url")
    .eq("kind", "video")
    .is("logs_url", null);
  if (!videos || videos.length === 0) {
    return { scanned: 0, matched: 0, details: [] };
  }

  const sortedVideos = [...videos]
    .map((v) => {
      const ts = (v.posted_at as string | null) ?? (v.created_at as string);
      const tMs = new Date(ts).getTime();
      return { ...v, tMs: Number.isFinite(tMs) ? tMs : null };
    })
    .filter((v): v is typeof v & { tMs: number } => v.tMs !== null)
    .sort((a, b) => a.tMs - b.tMs);

  const sortedReports = [...reports].sort((a, b) => a.startMs - b.startMs);
  const usedReports = new Set<string>();
  const details: FflogsLinkDetail[] = [];
  let matched = 0;

  for (const video of sortedVideos) {
    const lo = video.tMs - MATCH_WINDOW_MS;
    const hi = video.tMs + MATCH_WINDOW_MS;
    const report = sortedReports.find(
      (r) => !usedReports.has(r.id) && r.startMs >= lo && r.startMs <= hi,
    );
    if (!report) continue;
    const logsUrl = `https://www.fflogs.com/reports/${report.id}`;
    const { error } = await supabase
      .from("category_links")
      .update({ logs_url: logsUrl })
      .eq("id", video.id as string)
      .is("logs_url", null);
    if (error) {
      console.warn("[fflogs-link/video] update failed", video.id, error.message);
      continue;
    }
    usedReports.add(report.id);
    matched += 1;
    details.push({
      kind: "video",
      label: video.title as string,
      reportTitle: report.title || "(無題のレポート)",
      reportUrl: logsUrl,
    });
  }

  const dateRange =
    sortedVideos.length > 0
      ? {
          earliest: new Date(sortedVideos[0]!.tMs).toISOString().slice(0, 10),
          latest: new Date(
            sortedVideos[sortedVideos.length - 1]!.tMs,
          ).toISOString().slice(0, 10),
        }
      : undefined;

  return { scanned: sortedVideos.length, matched, details, dateRange };
}

async function linkReportsToSessions(
  supabase: SupabaseLike,
  reports: FflogsReport[],
): Promise<{
  scanned: number;
  matched: number;
  details: FflogsLinkDetail[];
  dateRange?: { earliest: string; latest: string };
}> {
  if (reports.length === 0) return { scanned: 0, matched: 0, details: [] };

  const { data: sessions } = await supabase
    .from("schedule_past_sessions")
    .select("raw_date, parsed_date, logs_url")
    .is("logs_url", null);
  if (!sessions || sessions.length === 0) {
    return { scanned: 0, matched: 0, details: [] };
  }

  const sortedSessions = sessions
    .map((s) => {
      const tMs = new Date(s.parsed_date as string).getTime();
      return { ...s, tMs: Number.isFinite(tMs) ? tMs : null };
    })
    .filter((s): s is typeof s & { tMs: number } => s.tMs !== null)
    .sort((a, b) => a.tMs - b.tMs);

  const sortedReports = [...reports].sort((a, b) => a.startMs - b.startMs);
  const usedReports = new Set<string>();
  const details: FflogsLinkDetail[] = [];
  let matched = 0;

  for (const session of sortedSessions) {
    const lo = session.tMs - SESSION_WINDOW_BEFORE_MS;
    const hi = session.tMs + SESSION_WINDOW_AFTER_MS;
    const report = sortedReports.find(
      (r) => !usedReports.has(r.id) && r.startMs >= lo && r.startMs <= hi,
    );
    if (!report) continue;
    const logsUrl = `https://www.fflogs.com/reports/${report.id}`;
    const { error } = await supabase
      .from("schedule_past_sessions")
      .update({ logs_url: logsUrl })
      .eq("raw_date", session.raw_date as string)
      .is("logs_url", null);
    if (error) {
      console.warn(
        "[fflogs-link/session] update failed",
        session.raw_date,
        error.message,
      );
      continue;
    }
    usedReports.add(report.id);
    matched += 1;
    details.push({
      kind: "session",
      label: session.raw_date as string,
      reportTitle: report.title || "(無題のレポート)",
      reportUrl: logsUrl,
    });
  }

  const dateRange =
    sortedSessions.length > 0
      ? {
          earliest: new Date(sortedSessions[0]!.tMs)
            .toISOString()
            .slice(0, 10),
          latest: new Date(sortedSessions[sortedSessions.length - 1]!.tMs)
            .toISOString()
            .slice(0, 10),
        }
      : undefined;

  return { scanned: sortedSessions.length, matched, details, dateRange };
}

/**
 * Server-side reader: returns a `rawDate → logs_url` map covering all
 * past sessions whose `logs_url` is non-null. Used by the schedule
 * page to surface a Logs icon on the date row even when no matching
 * video exists.
 */
export async function fetchSessionLogsByDate(): Promise<Record<string, string>> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("schedule_past_sessions")
      .select("raw_date, logs_url")
      .not("logs_url", "is", null);
    if (error || !data) return {};
    const out: Record<string, string> = {};
    for (const row of data) {
      const k = row.raw_date as string;
      const v = row.logs_url as string | null;
      if (k && v) out[k] = v;
    }
    return out;
  } catch (e) {
    console.warn("[fflogs] fetchSessionLogsByDate error:", e);
    return {};
  }
}
