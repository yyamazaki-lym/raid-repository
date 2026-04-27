import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getValidFflogsOAuthToken } from "./fflogs-oauth";

/**
 * FFLogs v2 GraphQL wrapper.
 *
 * Endpoint:
 *   https://www.fflogs.com/api/v2/user (GraphQL POST)
 *   Authorization: Bearer <oauth_access_token>
 *
 * Returns reports the OAuth-authenticated user owns, including
 * Public + Unlisted + Private (subject to scope `view-user-profile`).
 *
 * The previous v1 REST wrapper was removed in 1.7.3 — v1 only
 * exposes Public reports and required a separate FFLOGS_API_KEY.
 * v2 OAuth is now the sole path.
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

const FFLOGS_GRAPHQL_URL = "https://www.fflogs.com/api/v2/user";

/**
 * v2 GraphQL fetcher — uses the OAuth access token to fetch reports
 * including Unlisted / Private (subject to scope). Returns reports in
 * the same shape as `fetchFflogsReports` so the linker doesn't care
 * which API path was used.
 *
 * Note: GraphQL `reports` is paginated by ReportPagination. We fetch
 * the first ~16 pages (well over typical activity for one user) by
 * walking `has_more_pages`.
 */
/**
 * Introspect the GraphQL schema to list all fields available on the
 * `User` type. Used as a diagnostic to find any hidden / undocumented
 * field that might expose Private reports of the OAuth user (the
 * documented `reportData.reports(userID:)` only returns Public).
 */
export async function introspectUserFields(
  accessToken: string,
): Promise<string[]> {
  try {
    const res = await fetch(FFLOGS_GRAPHQL_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        query: `query { __type(name: "User") { fields { name type { name kind ofType { name kind } } } } }`,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as {
      data?: {
        __type?: {
          fields?: Array<{
            name: string;
            type?: {
              name?: string | null;
              kind?: string;
              ofType?: { name?: string | null; kind?: string } | null;
            };
          }>;
        } | null;
      };
    };
    const fields = json.data?.__type?.fields ?? [];
    return fields.map((f) => {
      const typeName =
        f.type?.name ?? f.type?.ofType?.name ?? f.type?.kind ?? "";
      return `${f.name}${typeName ? `: ${typeName}` : ""}`;
    });
  } catch {
    return [];
  }
}

/**
 * Fetch the authenticated user's profile (id + name). Used as the
 * first step before paginating their reports — `User` type does NOT
 * have a `reports` field per introspection, so we have to filter
 * `reportData.reports` by owner client-side.
 */
async function fetchCurrentUser(
  accessToken: string,
): Promise<
  { ok: true; id: number; name: string } | { ok: false; reason: string }
> {
  try {
    const res = await fetch(FFLOGS_GRAPHQL_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        query: `query { userData { currentUser { id name } } }`,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      if (res.status === 401) {
        return {
          ok: false,
          reason:
            "FFLogs OAuth トークンが無効です — 設定で再認証してください",
        };
      }
      return {
        ok: false,
        reason: `fflogs v2 ${res.status}: ${text.slice(0, 200)}`,
      };
    }
    const json = (await res.json()) as {
      errors?: Array<{ message?: string }>;
      data?: {
        userData?: {
          currentUser?: { id?: number; name?: string } | null;
        };
      };
    };
    if (json.errors?.length) {
      return {
        ok: false,
        reason: "fflogs v2 GraphQL error: " + json.errors[0]!.message,
      };
    }
    const u = json.data?.userData?.currentUser;
    if (!u || typeof u.id !== "number") {
      return {
        ok: false,
        reason:
          "現在のユーザー情報が取得できません — OAuth scope が view-user-profile を含んでいるか確認してください",
      };
    }
    return { ok: true, id: u.id, name: u.name ?? "" };
  } catch (e) {
    return { ok: false, reason: "fetch error: " + String(e) };
  }
}

export type FflogsV2Result =
  | {
      ok: true;
      reports: FflogsReport[];
      /** Diagnostic: total reports across pages before owner filter. */
      rawCount: number;
      /** Diagnostic: how many passed `owner.id == me.id || owner.name == me.name`. */
      ownedCount: number;
      /** Diagnostic: the authenticated user identity used. */
      me: { id: number; name: string };
      /** Diagnostic: top owners of fetched reports (helps diagnose why ownedCount = 0). */
      ownersSample: Array<{ id: number | null; name: string | null; count: number }>;
    }
  | { ok: false; reason: string };

export async function fetchFflogsReportsV2(
  accessToken: string,
): Promise<FflogsV2Result> {
  // Step 1: identify the authenticated user.
  const me = await fetchCurrentUser(accessToken);
  if (!me.ok) return me;

  // Step 2: query `reports(userID: me.id)` — this is the API's
  // canonical way to fetch reports OWNED BY a specific user. The
  // alternative `reports()` (no filter) returns reports the OAuth
  // scope can SEE (= guild-shared / friends' reports of others),
  // NOT the user's own. Diagnosis from a real run showed that
  // unfiltered `reports()` returned 625 reports owned by River810,
  // 공야, AyyJay, etc. — none owned by the actual current user.
  //
  // Caveat: `reports(userID:)` returns Public reports of that user.
  // Unlisted / Private reports are not exposed via this path even
  // when OAuth-authenticated as the same user. Those need manual
  // binding via the memo popover (or change visibility on FFLogs
  // to Public).

  // Step 2: paginate `reportData.reports` WITHOUT a userID filter.
  //
  // Why no filter: applying `reports(userID: ...)` causes FFLogs to
  // restrict results to the user's PUBLIC reports only (12 stale
  // public ones from 2017-2022 in our case). Without the filter the
  // query returns ALL reports the OAuth-authenticated client has
  // visibility on — which DOES include the authenticated user's
  // Unlisted / Private reports (alongside guild-shared ones from
  // other members).
  //
  // We then filter client-side by `owner.id === me.id` to keep only
  // the OAuth user's own reports. This is the only known way through
  // the v2 GraphQL schema to retrieve OAuth-user-owned non-public
  // reports.
  const all: FflogsReport[] = [];
  const allOwners = new Map<string, { id: number | null; name: string | null; count: number }>();
  let rawCount = 0;
  // FFLogs v2 caps page at 25 ("maximum allowed page is 25 until the
  // performance of paginated queries can be improved"). With limit=25
  // per page, total cap = 25 × 25 = 625 reports, which is plenty for
  // any active group.
  const MAX_PAGES = 25;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const query = `query ($userID: Int!, $page: Int!) {
      reportData {
        reports(userID: $userID, limit: 25, page: $page) {
          has_more_pages
          data {
            code
            title
            startTime
            endTime
            zone { id }
            owner { id name }
          }
        }
      }
    }`;
    try {
      const res = await fetch(FFLOGS_GRAPHQL_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ query, variables: { userID: me.id, page } }),
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        if (res.status === 401) {
          return {
            ok: false,
            reason:
              "FFLogs OAuth トークンが無効です — 設定で再認証してください",
          };
        }
        return {
          ok: false,
          reason: `fflogs v2 ${res.status}: ${text.slice(0, 200)}`,
        };
      }
      const json = (await res.json()) as {
        errors?: Array<{ message?: string }>;
        data?: {
          reportData?: {
            reports?: {
              has_more_pages?: boolean;
              data?: Array<{
                code: string;
                title?: string | null;
                startTime: number;
                endTime: number;
                zone?: { id?: number | null } | null;
                owner?: { id?: number | null; name?: string | null } | null;
              }>;
            };
          };
        };
      };
      if (json.errors?.length) {
        return {
          ok: false,
          reason: "fflogs v2 GraphQL error: " + json.errors[0]!.message,
        };
      }
      const reports = json.data?.reportData?.reports;
      if (!reports?.data) break;
      for (const r of reports.data) {
        rawCount += 1;
        // Track owners for diagnostic.
        const ownerKey = String(r.owner?.id ?? r.owner?.name ?? "(unknown)");
        const existing = allOwners.get(ownerKey);
        if (existing) {
          existing.count += 1;
        } else {
          allOwners.set(ownerKey, {
            id: typeof r.owner?.id === "number" ? r.owner.id : null,
            name: r.owner?.name ?? null,
            count: 1,
          });
        }
        // Sanity check: reports(userID:) should only return reports
        // owned by that user, but just in case the API changes,
        // cross-verify owner.id matches. Skip with NO match required
        // (since the userID filter already enforces ownership).
        const ownerIdStr = r.owner?.id != null ? String(r.owner.id) : null;
        if (
          ownerIdStr !== null &&
          ownerIdStr !== String(me.id) &&
          r.owner?.name !== me.name
        ) {
          // owner is provided AND differs from me — skip defensively
          continue;
        }
        // v2 GraphQL `startTime` / `endTime` are documented to return
        // Unix milliseconds. Defensive magnitude check protects
        // against future spec changes.
        const sMs = r.startTime < 1e11 ? r.startTime * 1000 : r.startTime;
        const eMs = r.endTime < 1e11 ? r.endTime * 1000 : r.endTime;
        all.push({
          id: r.code,
          title: r.title ?? "",
          startMs: sMs,
          endMs: eMs,
          zone: r.zone?.id ?? null,
        });
      }
      if (!reports.has_more_pages) break;
    } catch (e) {
      return { ok: false, reason: "fetch error: " + String(e) };
    }
  }
  // Top 5 owners for the diagnostic panel.
  const ownersSample = [...allOwners.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
  return {
    ok: true,
    reports: all,
    rawCount,
    ownedCount: all.length,
    me: { id: me.id, name: me.name },
    ownersSample,
  };
}

/**
 * HTML scrape fallback — fetches the public reports-list page
 * (`https://www.fflogs.com/user/reports-list/{userId}`) and parses
 * the report rows out. Used when the v2 GraphQL endpoint returns 0
 * owned reports despite OAuth auth (apparently a v2 schema limitation
 * for some users).
 *
 * Limitations:
 *   - Only fetches Public + (probably) Unlisted reports — the public
 *     web page doesn't expose Private reports without login session.
 *     Truly Private reports still need manual binding via the memo
 *     popover.
 *   - HTML parser uses regex (no cheerio dep) so it's brittle to
 *     FFLogs page redesigns. If FFLogs ships a layout change, this
 *     function will start returning 0 reports — at which point we'd
 *     either need to update the regex or return to API-only.
 */
async function fetchFflogsReportsHtmlScrape(
  userId: number,
): Promise<
  | {
      ok: true;
      reports: FflogsReport[];
      htmlPageSize: number;
      htmlCodesFound: number;
    }
  | { ok: false; reason: string }
> {
  const all: FflogsReport[] = [];
  const seen = new Set<string>();
  const MAX_PAGES = 25;
  let firstPageSize = 0;
  let totalCodesSeen = 0;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `https://www.fflogs.com/user/reports-list/${userId}?page=${page}`;
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; RaidRepository/1.0; +https://github.com)",
          Accept: "text/html,application/xhtml+xml",
          // Some pages serve different content based on language pref.
          "Accept-Language": "ja-JP,ja;q=0.9,en;q=0.8",
        },
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) {
        return {
          ok: false,
          reason: `fflogs HTML scrape ${res.status} (page ${page})`,
        };
      }
      const html = await res.text();
      if (page === 1) firstPageSize = html.length;
      const before = all.length;
      // Permissive: scan for any `/reports/{code}` link (both `<a>` and
      // bare URL forms) and try to extract a date from the surrounding
      // ~500 chars of context. Modern FFLogs pages may inject content
      // via JS, but the report links are typically still in the SSR'd
      // HTML.
      const linkPattern =
        /\/reports\/([A-Za-z0-9]{8,})(?:[?#"\s]|$)/g;
      const dateRegexEn =
        /([A-Z][a-z]+\s+\d{1,2},\s+\d{4}(?:\s+\d{1,2}:\d{2}\s*(?:AM|PM)?)?)/;
      const dateRegexIso =
        /(\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:\s+\d{1,2}:\d{2})?)/;
      let m;
      while ((m = linkPattern.exec(html)) !== null) {
        const code = m[1]!;
        if (seen.has(code)) continue;
        totalCodesSeen += 1;
        // Look at ±500 chars of context for date / title.
        const ctxStart = Math.max(0, m.index - 200);
        const ctxEnd = Math.min(html.length, m.index + 500);
        const ctx = html.slice(ctxStart, ctxEnd);
        const dateStr =
          ctx.match(dateRegexEn)?.[1] ??
          ctx.match(dateRegexIso)?.[1] ??
          null;
        const tMs = dateStr ? Date.parse(dateStr) : NaN;
        if (!Number.isFinite(tMs)) continue;
        // Title: try `<a href="/reports/CODE">TITLE</a>` form first.
        const titleMatch = ctx.match(
          new RegExp(
            `<a[^>]+href="/reports/${code}[^"]*"[^>]*>([^<]+)</a>`,
          ),
        );
        const title = titleMatch?.[1]?.replace(/\s+/g, " ").trim() ?? "";
        seen.add(code);
        all.push({
          id: code,
          title,
          startMs: tMs,
          endMs: tMs,
          zone: null,
        });
      }
      // Stop once a page yields no new reports (end of list).
      if (all.length === before) break;
    } catch (e) {
      return { ok: false, reason: "HTML scrape fetch error: " + String(e) };
    }
  }
  return {
    ok: true,
    reports: all,
    htmlPageSize: firstPageSize,
    htmlCodesFound: totalCodesSeen,
  };
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
  /** Diagnostic — fields available on FFLogs `User` type (introspected). */
  userTypeFields?: string[];
  /** Diagnostic — date range of unmatched videos. */
  videosDateRange?: { earliest: string; latest: string };
  /** Diagnostic — date range of unmatched sessions. */
  sessionsDateRange?: { earliest: string; latest: string };
  /** Diagnostic — sample of fetched reports (most recent first). */
  reportSamples?: Array<{ date: string; title: string; url: string }>;
  /** Diagnostic — the username actually queried (echo back to verify). */
  queriedUsername?: string;
  /** Which API path was used: v1 (display-name + key) or v2 (OAuth). */
  apiPath?: "v1" | "v2";
  /**
   * Deep diagnostic info for empty-results debugging. Surfaces what
   * each fetch attempt actually returned at the wire level so we can
   * tell if the query is hitting the API correctly but no rows pass
   * the owner filter, vs. the API itself returns nothing.
   */
  diag?: {
    /** GraphQL: total reports across all pages BEFORE owner filter. */
    v2RawCount?: number;
    /** GraphQL: reports passing the owner filter (this becomes our reports). */
    v2OwnedCount?: number;
    /** GraphQL: currentUser id + name resolved via the auth context. */
    v2Me?: { id: number; name: string };
    /** GraphQL: sample of owners from raw results (first 5 unique). */
    v2OwnersSample?: Array<{ id: number | null; name: string | null; count: number }>;
    /** HTML scrape: page 1 response size in bytes. */
    htmlPageSize?: number;
    /** HTML scrape: number of /reports/CODE links found (before any filter). */
    htmlCodesFound?: number;
  };
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
  // v2 OAuth only. The previous v1 fallback (display name + API key)
  // was removed in 1.7.3 because it returned Public reports only AND
  // sometimes returned reports owned by other users with the same name.

  // One-time cleanup: drop the deprecated `fflogs_username` row from
  // app_settings if it's still around. Idempotent — runs on every
  // linker invocation but does nothing once the row is gone.
  try {
    const cleanupClient = await createClient();
    await cleanupClient
      .from("app_settings")
      .delete()
      .eq("key", "fflogs_username");
  } catch {
    // best-effort
  }

  const oauthToken = await getValidFflogsOAuthToken();
  if (!oauthToken) {
    return {
      ok: false,
      reason:
        "FFLogs OAuth 未接続 — 設定ダイアログから「FFLogs と OAuth 接続」を実行してください",
      reportsScanned: 0,
      videosScanned: 0,
      matched: 0,
      sessionsScanned: 0,
      sessionsMatched: 0,
      details: [],
    };
  }
  const v2Result = await fetchFflogsReportsV2(oauthToken);
  if (!v2Result.ok) {
    return {
      ok: false,
      reason: v2Result.reason,
      reportsScanned: 0,
      videosScanned: 0,
      matched: 0,
      sessionsScanned: 0,
      sessionsMatched: 0,
      details: [],
    };
  }
  let reports = v2Result.reports;
  let usedSource: "v2-owned" | "html-scrape" | "v2+html" = "v2-owned";
  let htmlPageSize: number | undefined;
  let htmlCodesFound: number | undefined;

  // 戦略: ユーザー自身のレポート**だけ**を確実に取得する。
  //   1. v2 GraphQL の owner-filtered 結果 (= 自分が所有するレポート)
  //   2. HTML スクレイプ (= 自分のプロフィールページの reports-list)
  //   両者を union + dedupe。1.7.8 の Layer 2 (raw 全件採用) は
  //   別人のレポートを巻き込んでいたため撤廃。
  //
  // Public レポートの取得には強い: v2 + HTML どちらかには出てくる。
  // Private / Unlisted は API/HTML どちらにも露出しないことが多いので、
  // メモポップオーバーから手動紐づけする必要がある。
  // Introspect the User type so the diagnostic panel can surface any
  // undocumented fields that might unlock Private/Unlisted access.
  const userTypeFields = await introspectUserFields(oauthToken);

  const me = await fetchCurrentUser(oauthToken);
  if (me.ok) {
    const scrapeResult = await fetchFflogsReportsHtmlScrape(me.id);
    if (scrapeResult.ok) {
      htmlPageSize = scrapeResult.htmlPageSize;
      htmlCodesFound = scrapeResult.htmlCodesFound;
      if (scrapeResult.reports.length > 0) {
        // Union + dedupe — keep v2-owned reports first (they have
        // richer metadata like zone id), append unique HTML scrape
        // reports.
        const byCode = new Map<string, FflogsReport>();
        for (const r of reports) byCode.set(r.id, r);
        for (const r of scrapeResult.reports) {
          if (!byCode.has(r.id)) byCode.set(r.id, r);
        }
        const merged = [...byCode.values()];
        if (merged.length > reports.length) {
          usedSource = reports.length > 0 ? "v2+html" : "html-scrape";
          reports = merged;
        }
      }
    }
  }

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
  const reportsDateRange =
    sortedReports.length > 0
      ? {
          earliest: new Date(sortedReports[0]!.startMs)
            .toISOString()
            .slice(0, 10),
          latest: new Date(sortedReports[sortedReports.length - 1]!.startMs)
            .toISOString()
            .slice(0, 10),
        }
      : undefined;

  // Sample (newest first) so the user can verify what FFLogs returned
  // — useful when the reports are surprisingly old or unfamiliar.
  const reportSamples = [...reports]
    .sort((a, b) => b.startMs - a.startMs)
    .slice(0, 10)
    .map((r) => ({
      date: new Date(r.startMs).toISOString().slice(0, 10),
      title: r.title || "(無題のレポート)",
      url: `https://www.fflogs.com/reports/${r.id}`,
    }));

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
    reportSamples,
    queriedUsername:
      usedSource === "html-scrape"
        ? "(HTML スクレイプ — 自分のプロフィールページ)"
        : usedSource === "v2+html"
          ? "(v2 GraphQL owner-filter + HTML スクレイプ)"
          : "(v2 GraphQL — 自分所有のレポートのみ)",
    apiPath: "v2",
    userTypeFields,
    diag: {
      v2RawCount: v2Result.rawCount,
      v2OwnedCount: v2Result.ownedCount,
      v2Me: v2Result.me,
      v2OwnersSample: v2Result.ownersSample,
      htmlPageSize,
      htmlCodesFound,
    },
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
