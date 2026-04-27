import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchAppSetting } from "@/lib/supabase/app-settings";
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
const FFLOGS_V1_BASE = "https://www.fflogs.com/v1";

/**
 * v1 REST fetcher — restored in 1.8.5 as the default/simplest path.
 * Requires `FFLOGS_API_KEY` env var + a display name in app_settings.
 * Returns ONLY Public reports (FFLogs API spec limit). v2 OAuth and
 * Cookie scrape are layered on top for users who need more visibility.
 */
export async function fetchFflogsReportsV1(
  username: string,
): Promise<{ ok: true; reports: FflogsReport[] } | { ok: false; reason: string }> {
  const apiKey = process.env.FFLOGS_API_KEY?.trim();
  if (!apiKey) return { ok: false, reason: "FFLOGS_API_KEY 未設定" };
  const url = new URL(
    `${FFLOGS_V1_BASE}/reports/user/${encodeURIComponent(username)}`,
  );
  url.searchParams.set("api_key", apiKey);
  try {
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      if (res.status === 401) {
        return {
          ok: false,
          reason:
            "FFLOGS_API_KEY が無効です — fflogs.com/profile の Web API セクションで v1 Public Key を確認、Vercel に設定後 redeploy",
        };
      }
      if (res.status === 400 && /invalid user name/i.test(body)) {
        return {
          ok: false,
          reason: /^\d+$/.test(username)
            ? `数値 ID「${username}」は使えません — fflogs.com/profile の表示名（display name）を入力してください`
            : `表示名「${username}」が API に拒否されました — fflogs.com/profile と一致しているか確認`,
        };
      }
      if (res.status === 404) {
        return {
          ok: false,
          reason: `ユーザー「${username}」が見つかりません`,
        };
      }
      return {
        ok: false,
        reason: `fflogs v1 ${res.status}: ${body.slice(0, 200)}`,
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
      return { ok: false, reason: "v1 レスポンス形式不正" };
    }
    return {
      ok: true,
      reports: data.map((r) => ({
        id: r.id,
        title: r.title ?? "",
        // v1 returns seconds (10 digits); convert to ms.
        startMs: r.start < 1e11 ? r.start * 1000 : r.start,
        endMs: r.end < 1e11 ? r.end * 1000 : r.end,
        zone: r.zone ?? null,
      })),
    };
  } catch (e) {
    return { ok: false, reason: "v1 fetch error: " + String(e) };
  }
}

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
 * Introspect a GraphQL type's fields. Used as a diagnostic to find
 * any hidden / undocumented field that might expose Private reports
 * of the OAuth user.
 */
async function introspectType(
  accessToken: string,
  typeName: string,
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
        query: `query Q($n: String!) { __type(name: $n) { name fields { name args { name type { name kind ofType { name kind } } } type { name kind ofType { name kind } } } } }`,
        variables: { n: typeName },
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as {
      data?: {
        __type?: {
          name?: string;
          fields?: Array<{
            name: string;
            args?: Array<{
              name: string;
              type?: { name?: string | null; kind?: string; ofType?: { name?: string | null; kind?: string } | null };
            }>;
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
      const argList = (f.args ?? [])
        .map((a) => {
          const t = a.type?.name ?? a.type?.ofType?.name ?? a.type?.kind ?? "";
          return `${a.name}: ${t}`;
        })
        .join(", ");
      const argStr = argList ? `(${argList})` : "";
      return `${f.name}${argStr}${typeName ? `: ${typeName}` : ""}`;
    });
  } catch {
    return [];
  }
}

/**
 * Comprehensive introspection across types likely to contain
 * report-related fields. Returns a structured map for the diag panel.
 */
export async function introspectFflogsSchema(
  accessToken: string,
): Promise<{ user: string[]; reportData: string[]; query: string[] }> {
  const [user, reportData, query] = await Promise.all([
    introspectType(accessToken, "User"),
    introspectType(accessToken, "ReportData"),
    introspectType(accessToken, "Query"),
  ]);
  return { user, reportData, query };
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
/**
 * Extract a Unix timestamp (ms) from arbitrary HTML context. Tries
 * multiple formats because FFLogs may render dates differently per
 * locale (en / ja) or use JavaScript-friendly attributes
 * (data-timestamp, datetime). Returns null if no parseable date is
 * found.
 */
function extractTimestampMs(ctx: string): number | null {
  // 1. data-timestamp="..." — most reliable when present (FFLogs
  //    often renders timestamps this way for client-side formatting).
  const ts = ctx.match(/data-timestamp\s*=\s*"(\d{10,13})"/);
  if (ts) {
    const n = parseInt(ts[1]!, 10);
    return n > 1e11 ? n : n * 1000;
  }
  // 2. data-time / data-start / similar attributes.
  const ts2 = ctx.match(
    /data-(?:time|start|started|datetime)\s*=\s*"(\d{10,13})"/,
  );
  if (ts2) {
    const n = parseInt(ts2[1]!, 10);
    return n > 1e11 ? n : n * 1000;
  }
  // 3. <time datetime="ISO"> element.
  const dt = ctx.match(/datetime\s*=\s*"([^"]+)"/);
  if (dt) {
    const t = Date.parse(dt[1]!);
    if (Number.isFinite(t)) return t;
  }
  // 4. Japanese: 2026年4月17日 [HH:MM]
  const jp = ctx.match(
    /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日(?:\s*(\d{1,2}):(\d{2}))?/,
  );
  if (jp) {
    const y = jp[1]!;
    const mo = jp[2]!.padStart(2, "0");
    const d = jp[3]!.padStart(2, "0");
    const h = (jp[4] ?? "0").padStart(2, "0");
    const mi = (jp[5] ?? "0").padStart(2, "0");
    const t = Date.parse(`${y}-${mo}-${d}T${h}:${mi}:00`);
    if (Number.isFinite(t)) return t;
  }
  // 5. English: April 17, 2026 12:33 AM
  const en = ctx.match(
    /([A-Z][a-z]+\s+\d{1,2},\s+\d{4}(?:\s+\d{1,2}:\d{2}\s*(?:AM|PM)?)?)/,
  );
  if (en) {
    const t = Date.parse(en[1]!);
    if (Number.isFinite(t)) return t;
  }
  // 6. ISO-ish: 2026-04-17 / 2026/04/17 [HH:MM]
  const iso = ctx.match(
    /(\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:\s+\d{1,2}:\d{2})?)/,
  );
  if (iso) {
    const t = Date.parse(iso[1]!);
    if (Number.isFinite(t)) return t;
  }
  // 7. Any standalone Unix timestamp number in context (10 or 13
  //    digits, in 2010-2030 range to avoid false positives).
  const num = ctx.match(/\b(1[0-9]{9}|1[5-9][0-9]{11})\b/);
  if (num) {
    const n = parseInt(num[1]!, 10);
    return n > 1e11 ? n : n * 1000;
  }
  return null;
}

async function fetchFflogsReportsHtmlScrape(
  userId: number,
  sessionCookie?: string | null,
): Promise<
  | {
      ok: true;
      reports: FflogsReport[];
      htmlPageSize: number;
      htmlCodesFound: number;
      /** Sample of HTML around the first detected report code — for debugging. */
      htmlSample?: string;
    }
  | { ok: false; reason: string }
> {
  const all: FflogsReport[] = [];
  const seen = new Set<string>();
  const MAX_PAGES = 25;
  let firstPageSize = 0;
  let totalCodesSeen = 0;
  let htmlSample: string | undefined;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `https://www.fflogs.com/user/reports-list/${userId}?page=${page}`;
    try {
      const headers: Record<string, string> = {
        "User-Agent":
          "Mozilla/5.0 (compatible; RaidRepository/1.0; +https://github.com)",
        Accept: "text/html,application/xhtml+xml",
        // Some pages serve different content based on language pref.
        "Accept-Language": "ja-JP,ja;q=0.9,en;q=0.8",
      };
      if (sessionCookie && sessionCookie.trim()) {
        headers.Cookie = sessionCookie.trim();
      }
      const res = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(20000),
        // Don't auto-follow login redirects — if the cookie is invalid
        // FFLogs will redirect to /login, and a redirect signals "not
        // really logged in". We want to detect that.
        redirect: "manual",
      });
      // Manual redirect: 3xx means cookie expired or invalid.
      if (res.status >= 300 && res.status < 400) {
        return {
          ok: false,
          reason:
            "FFLogs にリダイレクトされました — session cookie が期限切れか無効です。fflogs.com に再ログインして cookie を取り直してください",
        };
      }
      if (!res.ok) {
        return {
          ok: false,
          reason: `fflogs HTML scrape ${res.status} (page ${page})`,
        };
      }
      const html = await res.text();
      if (page === 1) firstPageSize = html.length;
      const before = all.length;
      // Permissive: scan for any `/reports/{code}` link, then look at
      // the surrounding ~3000 chars (above + below) for a date in any
      // of several formats (EN, JP, ISO, data-timestamp, datetime).
      const linkPattern =
        /\/reports\/([A-Za-z0-9]{8,})(?:[?#"\s]|$)/g;
      let m;
      while ((m = linkPattern.exec(html)) !== null) {
        const code = m[1]!;
        if (seen.has(code)) continue;
        totalCodesSeen += 1;
        // Look at a generous window (1500 chars before + 1500 after)
        // — date might be in the same row but separated by lots of
        // markup. FFLogs's reports-list HTML can be verbose.
        const ctxStart = Math.max(0, m.index - 1500);
        const ctxEnd = Math.min(html.length, m.index + 1500);
        const ctx = html.slice(ctxStart, ctxEnd);
        // Stash a sample of the first context for debugging — we can
        // see what the actual HTML structure looks like.
        if (!htmlSample) {
          htmlSample = ctx.slice(0, 800);
        }
        const tMs = extractTimestampMs(ctx);
        if (tMs == null) continue;
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
  /** Diagnostic — fields on `ReportData` and `Query` root (introspected). */
  schemaIntrospect?: { user: string[]; reportData: string[]; query: string[] };
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
    /** Whether a session cookie was applied to the HTML scrape. */
    cookieUsed?: boolean;
    /** Reports returned by the HTML scrape pass. */
    htmlReportCount?: number;
    /** HTML scrape error reason if any. */
    htmlScrapeError?: string;
    /** Sample of HTML around the first report code — for date-format debugging. */
    htmlSample?: string;
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
  // Multi-source aggregation (1.8.5+):
  //   - v1 REST (default, simplest setup): Public reports
  //   - v2 OAuth (optional, more precise owner-filter): Public reports
  //   - Session cookie scrape (optional, max coverage): Public + Unlisted + Private
  // Whichever sources are configured run in parallel; results are
  // unioned + dedup'd by report code. This way a固定 can start with
  // just v1 (easy) and add Cookie when they need Private reports.

  // Read all sources' configuration.
  const [username, oauthToken, sessionCookie] = await Promise.all([
    fetchAppSetting("fflogs_username"),
    getValidFflogsOAuthToken(),
    fetchAppSetting("fflogs_session_cookie"),
  ]);

  // At least one source must be configured.
  if (!username && !oauthToken) {
    return {
      ok: false,
      reason:
        "FFLogs ソースが設定されていません — 表示名 (v1)、OAuth、Cookie のいずれかを設定してください",
      reportsScanned: 0,
      videosScanned: 0,
      matched: 0,
      sessionsScanned: 0,
      sessionsMatched: 0,
      details: [],
    };
  }

  // Default partial accumulators for the diag panel — populated below
  // depending on which sources are active.
  let v2Result: FflogsV2Result | null = null;
  let userTypeFields: string[] = [];
  let schemaIntrospect:
    | { user: string[]; reportData: string[]; query: string[] }
    | undefined;

  // Run v1 if username configured.
  let v1Reports: FflogsReport[] = [];
  let v1Error: string | undefined;
  if (username) {
    const r = await fetchFflogsReportsV1(username);
    if (r.ok) v1Reports = r.reports;
    else v1Error = r.reason;
  }

  // Run v2 OAuth if connected.
  if (oauthToken) {
    schemaIntrospect = await introspectFflogsSchema(oauthToken);
    userTypeFields = schemaIntrospect.user;
    v2Result = await fetchFflogsReportsV2(oauthToken);
  }
  const v2Reports = v2Result && v2Result.ok ? v2Result.reports : [];
  const v2Error = v2Result && !v2Result.ok ? v2Result.reason : undefined;

  let reports: FflogsReport[] = [];
  let usedSource:
    | "v1"
    | "v2-owned"
    | "html-scrape"
    | "v1+v2"
    | "v1+html"
    | "v2+html"
    | "v1+v2+html"
    | "none" = "none";
  let cookieUsed = false;
  let htmlReportCount: number | undefined;
  let htmlScrapeError: string | undefined;
  let htmlSampleForDiag: string | undefined;
  let htmlPageSize: number | undefined;
  let htmlCodesFound: number | undefined;
  let htmlReports: FflogsReport[] = [];

  // HTML scrape — works only when we have a numeric user ID.
  // Currently we only obtain that via OAuth (currentUser.id), so
  // scrape requires v2 OAuth to be configured. With session cookie,
  // it returns Public + Unlisted + Private; without, only Public.
  cookieUsed = Boolean(sessionCookie?.trim());
  if (oauthToken) {
    const me = await fetchCurrentUser(oauthToken);
    if (me.ok) {
      const scrapeResult = await fetchFflogsReportsHtmlScrape(
        me.id,
        sessionCookie,
      );
      if (cookieUsed) {
        // Auto-delete the cookie after use — one-time-use semantics.
        try {
          const cleanupClient = await createClient();
          await cleanupClient
            .from("app_settings")
            .delete()
            .eq("key", "fflogs_session_cookie");
        } catch {
          // best-effort
        }
      }
      if (scrapeResult.ok) {
        htmlPageSize = scrapeResult.htmlPageSize;
        htmlCodesFound = scrapeResult.htmlCodesFound;
        htmlReportCount = scrapeResult.reports.length;
        htmlSampleForDiag = scrapeResult.htmlSample;
        htmlReports = scrapeResult.reports;
      } else {
        htmlScrapeError = scrapeResult.reason;
      }
    }
  }

  // Union all sources (v1 + v2 + HTML scrape) and dedupe by report id.
  // Priority: prefer entries with richer metadata (v2 has zone id;
  // v1 also has zone; html scrape has neither). Order of insertion
  // matters because Map preserves first-seen entry on collision.
  const byCode = new Map<string, FflogsReport>();
  for (const r of v2Reports) byCode.set(r.id, r);
  for (const r of v1Reports) if (!byCode.has(r.id)) byCode.set(r.id, r);
  for (const r of htmlReports) if (!byCode.has(r.id)) byCode.set(r.id, r);
  reports = [...byCode.values()];

  // Source label tells the user which paths produced data.
  const labels: string[] = [];
  if (v1Reports.length > 0) labels.push("v1");
  if (v2Reports.length > 0) labels.push("v2-owned");
  if (htmlReports.length > 0) labels.push("html-scrape");
  if (labels.length === 0) {
    usedSource = "none";
  } else if (labels.length === 1) {
    usedSource = labels[0] as typeof usedSource;
  } else {
    usedSource = labels.join("+") as typeof usedSource;
  }

  // Surface fatal-style errors when nothing was retrieved.
  if (reports.length === 0) {
    const errors: string[] = [];
    if (v1Error) errors.push("v1: " + v1Error);
    if (v2Error) errors.push("v2: " + v2Error);
    if (htmlScrapeError) errors.push("scrape: " + htmlScrapeError);
    if (errors.length > 0) {
      return {
        ok: false,
        reason: errors.join(" | "),
        reportsScanned: 0,
        videosScanned: 0,
        matched: 0,
        sessionsScanned: 0,
        sessionsMatched: 0,
        details: [],
      };
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
    queriedUsername: `(取得ソース: ${usedSource})`,
    apiPath: "v2",
    userTypeFields,
    schemaIntrospect,
    diag: {
      v2RawCount: v2Result && v2Result.ok ? v2Result.rawCount : undefined,
      v2OwnedCount: v2Result && v2Result.ok ? v2Result.ownedCount : undefined,
      v2Me: v2Result && v2Result.ok ? v2Result.me : undefined,
      v2OwnersSample:
        v2Result && v2Result.ok ? v2Result.ownersSample : undefined,
      htmlPageSize,
      htmlCodesFound,
      cookieUsed,
      htmlReportCount,
      htmlScrapeError,
      htmlSample: htmlSampleForDiag,
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

  const usedReports = new Set<string>();
  const details: FflogsLinkDetail[] = [];
  let matched = 0;

  // Score function for video↔report compatibility:
  //   delta = video.posted_at - report.startMs
  //   - delta > 0 means raid happened BEFORE upload (the normal case;
  //     people upload videos after their raid)
  //   - delta < 0 means upload happened BEFORE raid (very unusual;
  //     pre-recorded or scheduling drift). Penalize heavily.
  // Lower score = better match. The "best" pairing is the closest
  // report that came BEFORE the video.
  //
  // Replaces the previous greedy "earliest unmatched in window" which
  // could pair a Day-1 raid report with a Day-27 video just because
  // both were within ±36h of an old upload.
  const scoreCandidate = (video: { tMs: number }, report: FflogsReport) => {
    const delta = video.tMs - report.startMs; // ms
    if (Math.abs(delta) > MATCH_WINDOW_MS) return Infinity;
    return delta >= 0 ? delta : -delta * 4; // penalize "report after video"
  };

  // Build all candidate (video, report, score) tuples that fit the
  // window, then sort globally by score and assign greedily. Each
  // video and report can be claimed at most once.
  type Pair = {
    video: (typeof sortedVideos)[number];
    report: FflogsReport;
    score: number;
  };
  const pairs: Pair[] = [];
  for (const v of sortedVideos) {
    for (const r of reports) {
      const score = scoreCandidate(v, r);
      if (Number.isFinite(score)) pairs.push({ video: v, report: r, score });
    }
  }
  pairs.sort((a, b) => a.score - b.score);
  const usedVideos = new Set<string>();
  for (const pair of pairs) {
    const vId = pair.video.id as string;
    if (usedVideos.has(vId)) continue;
    if (usedReports.has(pair.report.id)) continue;
    const logsUrl = `https://www.fflogs.com/reports/${pair.report.id}`;
    const { error } = await supabase
      .from("category_links")
      .update({ logs_url: logsUrl })
      .eq("id", vId)
      .is("logs_url", null);
    if (error) {
      console.warn("[fflogs-link/video] update failed", vId, error.message);
      continue;
    }
    usedReports.add(pair.report.id);
    usedVideos.add(vId);
    matched += 1;
    details.push({
      kind: "video",
      label: pair.video.title as string,
      reportTitle: pair.report.title || "(無題のレポート)",
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

  const usedReports = new Set<string>();
  const details: FflogsLinkDetail[] = [];
  let matched = 0;

  // Score: report.startMs should fall within
  //   [session.parsed_date - 1h, session.parsed_date + 4h]
  // and ideally be CLOSE to the scheduled start time.
  // Lower abs distance from scheduled start = better match.
  type SPair = {
    session: (typeof sortedSessions)[number];
    report: FflogsReport;
    score: number;
  };
  const pairs: SPair[] = [];
  for (const s of sortedSessions) {
    const lo = s.tMs - SESSION_WINDOW_BEFORE_MS;
    const hi = s.tMs + SESSION_WINDOW_AFTER_MS;
    for (const r of reports) {
      if (r.startMs < lo || r.startMs > hi) continue;
      pairs.push({
        session: s,
        report: r,
        score: Math.abs(r.startMs - s.tMs),
      });
    }
  }
  pairs.sort((a, b) => a.score - b.score);
  const usedSessions = new Set<string>();
  for (const pair of pairs) {
    const sKey = pair.session.raw_date as string;
    if (usedSessions.has(sKey)) continue;
    if (usedReports.has(pair.report.id)) continue;
    const logsUrl = `https://www.fflogs.com/reports/${pair.report.id}`;
    const { error } = await supabase
      .from("schedule_past_sessions")
      .update({ logs_url: logsUrl })
      .eq("raw_date", sKey)
      .is("logs_url", null);
    if (error) {
      console.warn(
        "[fflogs-link/session] update failed",
        sKey,
        error.message,
      );
      continue;
    }
    usedReports.add(pair.report.id);
    usedSessions.add(sKey);
    matched += 1;
    details.push({
      kind: "session",
      label: sKey,
      reportTitle: pair.report.title || "(無題のレポート)",
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
