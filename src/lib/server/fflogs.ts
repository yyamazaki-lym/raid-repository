import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchAppSetting } from "@/lib/supabase/app-settings";
import { findContentGroups } from "@/lib/content-groups";
import { extractDateFromTitle } from "@/lib/title-date";
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
  /** FFLogs zone name (e.g. "AAC Light-heavyweight Tier"). Used to
   * verify the report content matches a video's content. */
  zoneName: string | null;
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
        zoneName: null, // v1 REST doesn't provide zone name
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
            zone { id name }
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
                zone?: { id?: number | null; name?: string | null } | null;
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
          zoneName: r.zone?.name ?? null,
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
/**
 * 1.9.25 rewrite: extract timestamp from HTML context, picking the
 * date CLOSEST to `anchorPos` (the report-link position in `ctx`).
 *
 * Why the rewrite: earlier versions returned the FIRST regex hit by
 * priority. With a 3000-char context window this often picked up a
 * neighboring report's date OR the "Created by NAME on DATE" line
 * (which is the upload time, NOT the raid date). Confirmed user case:
 * "Created by Aranrhod on Sat Mar 21 2026" → matched a 2026-03-23
 * video, off by 2 days, because some 3-23 date elsewhere in the page
 * leaked into the context window.
 *
 * New algorithm:
 *   1. Scan ALL date patterns in `ctx`
 *   2. SKIP any candidate immediately preceded by `Created`/`Uploaded`/
 *      `Posted` markers within ~30 chars — these are upload/edit
 *      timestamps, not raid timestamps
 *   3. Sort surviving candidates by (priority, distance to anchorPos)
 *   4. Return the best
 *
 * Priority ranking (lower is preferred):
 *   1. Japanese visible date (年月日) — usually the rendered raid date
 *   2. English visible date (Month D, YYYY)
 *   3. ISO visible date
 *   4. <time datetime="..."> attribute
 *   5. data-timestamp / data-time attribute
 *   6. Standalone Unix timestamp
 */
function extractTimestampMs(
  ctx: string,
  anchorPos = 0,
): number | null {
  type Cand = { pos: number; ms: number; priority: number };
  const candidates: Cand[] = [];

  /** Heuristic: if the date is immediately preceded by "Created" /
   * "Uploaded" / "Posted" / "Last updated" within `lookbehind` chars,
   * it's an upload metadata timestamp and should be ignored.
   * Looks at the *raw* characters preceding the match position. */
  const isUploadMetadataAt = (pos: number) => {
    const before = ctx.slice(Math.max(0, pos - 50), pos);
    return /Created\s+by|Uploaded|Posted\s+by|Last\s+updated|Updated\s+on|Modified\s+on/i.test(
      before,
    );
  };

  const pad = (s: string) => s.padStart(2, "0");

  // 1. Japanese: 2026年4月17日 [HH:MM]
  for (const m of ctx.matchAll(
    /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日(?:\s*(\d{1,2}):(\d{2}))?/g,
  )) {
    if (isUploadMetadataAt(m.index!)) continue;
    const t = Date.parse(
      `${m[1]}-${pad(m[2]!)}-${pad(m[3]!)}T${pad(m[4] ?? "0")}:${pad(
        m[5] ?? "0",
      )}:00+09:00`,
    );
    if (Number.isFinite(t))
      candidates.push({ pos: m.index!, ms: t, priority: 1 });
  }

  // 2. English: April 17, 2026 [12:33 AM] OR Sat Mar 21 2026 (no
  //    comma — this is the FFLogs "Created by" line format)
  for (const m of ctx.matchAll(
    /([A-Z][a-z]+\s+\d{1,2},\s+\d{4}(?:\s+\d{1,2}:\d{2}\s*(?:AM|PM)?)?)/g,
  )) {
    if (isUploadMetadataAt(m.index!)) continue;
    const t = Date.parse(m[0] + " +0900");
    if (Number.isFinite(t))
      candidates.push({ pos: m.index!, ms: t, priority: 2 });
  }

  // 3. ISO: 2026-04-17 / 2026/04/17 [HH:MM]
  for (const m of ctx.matchAll(
    /(?<![\d-])(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?(?![-/\d])/g,
  )) {
    if (isUploadMetadataAt(m.index!)) continue;
    const t = Date.parse(
      `${m[1]}-${pad(m[2]!)}-${pad(m[3]!)}T${pad(m[4] ?? "0")}:${pad(
        m[5] ?? "0",
      )}:00+09:00`,
    );
    if (Number.isFinite(t))
      candidates.push({ pos: m.index!, ms: t, priority: 3 });
  }

  // 4. <time datetime="ISO"> attribute
  for (const m of ctx.matchAll(/datetime\s*=\s*"([^"]+)"/g)) {
    if (isUploadMetadataAt(m.index!)) continue;
    const t = Date.parse(m[1]!);
    if (Number.isFinite(t))
      candidates.push({ pos: m.index!, ms: t, priority: 4 });
  }

  // 5. data-* numeric timestamp
  for (const m of ctx.matchAll(
    /data-(?:timestamp|time|start|started|datetime)\s*=\s*"(\d{10,13})"/g,
  )) {
    if (isUploadMetadataAt(m.index!)) continue;
    const n = parseInt(m[1]!, 10);
    candidates.push({
      pos: m.index!,
      ms: n > 1e11 ? n : n * 1000,
      priority: 5,
    });
  }

  // 6. Standalone Unix timestamp
  for (const m of ctx.matchAll(/\b(1[0-9]{9}|1[5-9][0-9]{11})\b/g)) {
    if (isUploadMetadataAt(m.index!)) continue;
    const n = parseInt(m[1]!, 10);
    candidates.push({
      pos: m.index!,
      ms: n > 1e11 ? n : n * 1000,
      priority: 6,
    });
  }

  if (candidates.length === 0) return null;

  // Sort: priority asc, then distance to anchor asc.
  candidates.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return Math.abs(a.pos - anchorPos) - Math.abs(b.pos - anchorPos);
  });

  return candidates[0]!.ms;
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
      // 2.1 (2026-04-29): UA を実 Chrome 風に変更。旧 UA は
      // `Mozilla/5.0 (compatible; RaidRepository/1.0; ...)` で、
      // Cloudflare/FFLogs の bot 判定に弾かれて 403 を返していた
      // (Vercel IP からの署名でも、UA が真っ当に見えれば通ること
      // が多い)。Sec-Fetch-* / Referer 等の "browser-like" ヘッダー
      // を一通り付けて、自然なナビゲーション風のリクエストに偽装。
      const headers: Record<string, string> = {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7",
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
        Referer: "https://www.fflogs.com/",
        "Sec-Ch-Ua":
          '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
        "Sec-Ch-Ua-Mobile": "?0",
        "Sec-Ch-Ua-Platform": '"Windows"',
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
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
        // 1.9.25: tightened from ±1500 → ±400 chars (= 800 total).
        // Wider windows leak adjacent rows' dates and the page-wide
        // "Created by NAME on DATE" header, producing wrong matches.
        // 800 chars is enough to span 1 report row's HTML in most
        // FFLogs templates without bleeding into neighbors.
        const ctxStart = Math.max(0, m.index - 400);
        const ctxEnd = Math.min(html.length, m.index + 400);
        const ctx = html.slice(ctxStart, ctxEnd);
        // Anchor: the link's position WITHIN ctx (used by the closest-
        // date selection in extractTimestampMs).
        const anchorPos = m.index - ctxStart;
        if (!htmlSample) {
          htmlSample = ctx.slice(0, 800);
        }
        const tMs = extractTimestampMs(ctx, anchorPos);
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
          zoneName: null,
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
  /** JST calendar date inferred from the video title or session, for
   * verifying matches at a glance. */
  videoDate?: string;
  /** JST calendar date of the FFLogs report start time. */
  reportDate?: string;
  /** Report's start time formatted in JST (YYYY-MM-DD HH:mm). Surfaces
   * the actual raid moment, not just the calendar date — lets the user
   * spot timezone / parsing bugs. */
  reportStartJst?: string;
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
    /** Number of videos skipped because they had no `posted_at`. */
    videosSkippedNoPostedAt?: number;
    /** Number of videos where title-date was successfully extracted. */
    titleDateHitCount?: number;
    /** Number of videos where title-date extraction FAILED (fell back to posted_at). */
    titleDateMissCount?: number;
    /** Sample of video titles where title-date extraction failed (first 10). */
    titleDateMissSample?: string[];
  };
};

// 1.9.24: 全 ms ウィンドウ定数を撤廃。マッチは「同 JST カレンダー
// 日」のみで判定するため。 (履歴: 1.9.2 で MATCH_WINDOW_MS=±18h、
// 1.9.4 で同日厳格、1.9.15 で ±12h + 22:00 JST anchor、1.9.24 で
// シンプル化 — Log の startTime はコンテンツ挑戦日なので外れ値に
// ならない、というユーザー知見)。

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
  // 1.9.11: ONE-TIME BOOTSTRAP. The 1.9.10 schema added logs_url_source
  // with `NOT NULL DEFAULT 'manual'`, which means every pre-existing
  // logs_url row got tagged 'manual'. The 'auto'-only cleanup below
  // therefore never wiped legacy auto-matches (including the wrong
  // 0328↔0401 ones the user reported). Flip them to 'auto' once so the
  // next sync produces a clean re-match. Guarded by an app_settings
  // flag so subsequent syncs don't keep flipping legitimately-manual
  // rows the user has set since 1.9.11 shipped.
  try {
    const flagClient = await createClient();
    const { data: flagRow } = await flagClient
      .from("app_settings")
      .select("value")
      .eq("key", "fflogs_source_bootstrap_v1")
      .maybeSingle();
    if (!flagRow) {
      await Promise.all([
        flagClient
          .from("category_links")
          .update({ logs_url_source: "auto" })
          .not("logs_url", "is", null)
          .eq("logs_url_source", "manual"),
        flagClient
          .from("schedule_past_sessions")
          .update({ logs_url_source: "auto" })
          .not("logs_url", "is", null)
          .eq("logs_url_source", "manual"),
      ]);
      await flagClient
        .from("app_settings")
        .upsert(
          {
            key: "fflogs_source_bootstrap_v1",
            value: new Date().toISOString(),
          },
          { onConflict: "key" },
        );
    }
  } catch (e) {
    console.warn("[fflogs] 1.9.11 bootstrap flip failed", e);
  }

  // 1.9.10: wipe stale AUTO logs_url before re-matching. Manual entries
  // (set via the memo popover or the video edit dialog) are preserved
  // because they have logs_url_source = 'manual'. This makes every
  // sync produce a fresh, consistent set of auto matches without
  // requiring the user to click "全 logs URL クリア" first.
  try {
    const cleanupClient = await createClient();
    await Promise.all([
      cleanupClient
        .from("category_links")
        .update({ logs_url: null })
        .eq("logs_url_source", "auto")
        .not("logs_url", "is", null),
      cleanupClient
        .from("schedule_past_sessions")
        .update({ logs_url: null })
        .eq("logs_url_source", "auto")
        .not("logs_url", "is", null),
    ]);
  } catch (e) {
    console.warn("[fflogs] auto-cleanup failed", e);
  }

  // Read all sources' configuration.
  // session cookie は secrets テーブル (暗号化) を優先、無ければ
  // 旧 app_settings の plaintext fallback (TODO #35 移行期)。
  const { getSecretValue } = await import("./secret-store");
  const [username, oauthToken, encryptedCookie] = await Promise.all([
    fetchAppSetting("fflogs_username"),
    getValidFflogsOAuthToken(),
    getSecretValue("fflogs_session_cookie"),
  ]);
  const sessionCookie =
    encryptedCookie ?? (await fetchAppSetting("fflogs_session_cookie"));

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
      // TODO #45 (2.1): scrape 成功時のみ cookie を auto-delete する。
      // 旧設計では成功 / 失敗を問わず削除していたため、Cloudflare の
      // 一時的な 403 で cookie だけ消費される事故 (= 「貼り直しの無限
      // ループ」) が発生していた。失敗時は cookie 残しユーザーが
      // そのまま再試行できるようにする。
      if (cookieUsed && scrapeResult.ok) {
        try {
          const cleanupClient = await createClient();
          await cleanupClient
            .from("app_settings")
            .delete()
            .eq("key", "fflogs_session_cookie");
        } catch {
          // best-effort
        }
        try {
          const { deleteSecretValue } = await import("./secret-store");
          await deleteSecretValue("fflogs_session_cookie");
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

  // Note (1.9.23): tried filtering "non-raid" content (group 14 =
  // Criterion / Variant) but user clarified those are challenge
  // raids the group runs and should NOT be excluded. The existing
  // `contentMismatchPenalty` already rejects cross-group same-day
  // matches (e.g. Heavy video vs Criterion report → score=Infinity)
  // so legitimate non-raid reports just sit unmatched without harm.
  // If we ever need to exclude regular instanced dungeons (which we
  // don't currently classify), add a dedicated "regular dungeon"
  // group with a hardcoded keyword list.

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
      videosSkippedNoPostedAt: videoResult.skippedNoPostedAt,
      titleDateHitCount: videoResult.titleDateHits,
      titleDateMissCount: videoResult.titleDateMisses,
      titleDateMissSample: videoResult.titleDateMissSample,
    },
  };
}

type SupabaseLike = Awaited<ReturnType<typeof createClient>>;

// 1.9.17: extractDateFromTitle moved to `@/lib/title-date.ts`. The
// import at the top of this file replaces the previous local copy so
// backfill / discord-import can reuse the same regex suite.

/** Convert a Unix ms epoch to a JST calendar date. */
function jstCalendarDate(ms: number): { y: number; m: number; d: number } {
  const JST_OFFSET = 9 * 60 * 60 * 1000;
  const dt = new Date(ms + JST_OFFSET);
  return {
    y: dt.getUTCFullYear(),
    m: dt.getUTCMonth() + 1,
    d: dt.getUTCDate(),
  };
}

/** Days apart between two calendar dates (always non-negative integer). */
function daysApart(
  a: { y: number; m: number; d: number },
  b: { y: number; m: number; d: number },
): number {
  const aMs = Date.UTC(a.y, a.m - 1, a.d);
  const bMs = Date.UTC(b.y, b.m - 1, b.d);
  return Math.abs(aMs - bMs) / (24 * 60 * 60 * 1000);
}

// 1.9.17: CONTENT_GROUPS / normalizeContentText / findContentGroups
// were moved to `@/lib/content-groups.ts` so backfill / discord-import
// can reuse the classifier for video-vs-category filtering. Re-import
// the same names here so the rest of this file's references work
// without changing call sites.

/**
 * Content-similarity check between a video's content (category name /
 * title) and a FFLogs report's content (zone name / title).
 *
 * Strategy:
 *   1. Extract content groups from each side using a curated bilingual
 *      keyword map (Japanese + English + abbrev for each FFXIV raid).
 *   2. If both sides are classified, check if any group overlaps:
 *      - shared group → 0 (confident match)
 *      - disjoint groups → 1 (confident mismatch — REJECT)
 *   3. If only one side is classified, check bigram overlap on the
 *      free-text. High overlap = match, otherwise ambiguous.
 *   4. If neither side is classified, also fall back to bigrams.
 *
 * Returns:
 *   - 0   confident same content (no penalty)
 *   - 1   confident different content (HARD REJECT in scorer)
 *   - 0.5 ambiguous (small penalty — kept matchable)
 */
function contentMismatchPenalty(
  videoCategoryName: string | null,
  videoTitle: string | null,
  reportZoneName: string | null,
  reportTitle: string | null,
): 0 | 0.5 | 1 {
  const videoText = [videoCategoryName, videoTitle]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const reportText = [reportZoneName, reportTitle]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (!videoText || !reportText) return 0.5;

  // Strip noise to avoid date/punctuation tokens disturbing matching.
  const stripNoise = (s: string) =>
    s
      .replace(/[【】\[\]（）()「」『』,.\-:：/／〜~・,]/g, " ")
      .replace(/\d{4}\s*\d{1,2}\s*\d{1,2}|\d{4}\/\d{1,2}\/\d{1,2}/g, " ")
      .replace(/day\s*\d+/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  const v = stripNoise(videoText);
  const r = stripNoise(reportText);

  // Group classification: cross-language content matching.
  const vGroups = findContentGroups(v);
  const rGroups = findContentGroups(r);
  if (vGroups.size > 0 && rGroups.size > 0) {
    // Both classified — strict group match check.
    for (const g of vGroups) {
      if (rGroups.has(g)) return 0; // confirmed same content
    }
    // No shared group → confidently different content.
    return 1;
  }

  // 2.1 (2026-04-29) TODO #45: 旧 1.9.13 では「Video カテゴリ分類可 +
  // Report 分類不能 → REJECT」だったが、これだと HTML scrape 由来の
  // レポート (`zoneName=null` + ユーザー個人タイトル「Day 5」「練習」
  // 等で CONTENT_GROUPS に当たらない) が全件リジェクトされ、絶竜詩戦争
  // / 絶アレキサンダー / ライトヘビー級 などキーワード明示型カテゴリ
  // でも紐づきが 0 になっていた。
  //
  // 緩和方針: ユーザーが動画をそのカテゴリに登録した時点で「video の
  // コンテンツはカテゴリで確定済み」と扱う。Report が分類不能なら
  // 「曖昧 (0.5)」で残し、同日マッチで採用させる。Report が **別** の
  // グループに分類できる場合の reject (l.1240-1247) は据え置きなので、
  // 同日に LH 級と Cruiser 級両方の raid を録ったときのクロス紐づけは
  // 依然防止される (= 1.9.13 の本来の意図はキープ)。
  //
  // 残るリスク: 同日に分類不能な report と複数 tier 動画があると、
  // カテゴリが違う動画に付く可能性。実運用では稀。
  const vCatGroups = findContentGroups(videoCategoryName ?? "");
  if (vCatGroups.size > 0 && rGroups.size === 0) {
    return 0.5;
  }

  // Bigram fallback for at least one unclassified side.
  const bigrams = (s: string): Set<string> => {
    const out = new Set<string>();
    const stripped = s.replace(/\s+/g, "");
    if (stripped.length < 2) return out;
    for (let i = 0; i < stripped.length - 1; i++) {
      out.add(stripped.slice(i, i + 2));
    }
    return out;
  };
  const vBigrams = bigrams(v);
  const rBigrams = bigrams(r);
  if (vBigrams.size === 0 || rBigrams.size === 0) return 0.5;
  let shared = 0;
  for (const b of vBigrams) if (rBigrams.has(b)) shared += 1;
  const ratio = shared / Math.min(vBigrams.size, rBigrams.size);
  if (ratio >= 0.25) return 0;
  return 0.5;
}

async function linkReportsToVideos(
  supabase: SupabaseLike,
  reports: FflogsReport[],
): Promise<{
  scanned: number;
  matched: number;
  details: FflogsLinkDetail[];
  dateRange?: { earliest: string; latest: string };
  /** Videos that had no `posted_at` and were excluded from matching. */
  skippedNoPostedAt: number;
  /** Videos where title-date was successfully extracted. */
  titleDateHits: number;
  /** Videos where title-date was NOT extracted (fell back to posted_at). */
  titleDateMisses: number;
  /** Sample of failed titles. */
  titleDateMissSample: string[];
}> {
  if (reports.length === 0)
    return {
      scanned: 0,
      matched: 0,
      details: [],
      skippedNoPostedAt: 0,
      titleDateHits: 0,
      titleDateMisses: 0,
      titleDateMissSample: [],
    };

  // Pull category info alongside each video so we can do
  // content-match (raid-name) checks during scoring.
  const { data: videos } = await supabase
    .from("category_links")
    .select(
      "id, title, posted_at, created_at, logs_url, category:categories(id, name)",
    )
    .eq("kind", "video")
    .is("logs_url", null);
  if (!videos || videos.length === 0) {
    return {
      scanned: 0,
      matched: 0,
      details: [],
      skippedNoPostedAt: 0,
      titleDateHits: 0,
      titleDateMisses: 0,
      titleDateMissSample: [],
    };
  }

  // STRICT POLICY (1.9.9): only videos with a parseable raid date in
  // their title participate in auto-matching. posted_at fallback
  // produced cascading wrong matches when consecutive raids fell in
  // each other's ±18h windows. Better to leave dateless videos
  // unmatched (user binds manually via the video edit dialog).
  let videosSkippedNoTitleDate = 0;
  let titleDateHits = 0;
  let titleDateMisses = 0;
  const titleDateMissSample: string[] = [];
  const sortedVideos = [...videos]
    .map((v) => {
      const postedAt = v.posted_at as string | null;
      const postedTMs =
        postedAt && Number.isFinite(new Date(postedAt).getTime())
          ? new Date(postedAt).getTime()
          : null;
      const fallbackYear =
        postedTMs !== null
          ? new Date(postedTMs).getUTCFullYear()
          : new Date().getUTCFullYear();
      const vTitle = (v as { title?: string | null }).title ?? null;
      const titleDate = extractDateFromTitle(vTitle, fallbackYear);
      if (titleDate) {
        titleDateHits += 1;
      } else {
        titleDateMisses += 1;
        videosSkippedNoTitleDate += 1;
        if (vTitle && titleDateMissSample.length < 10) {
          titleDateMissSample.push(vTitle);
        }
        return null; // skip — no posted_at fallback in 1.9.9+
      }
      const sortKey = Date.UTC(
        titleDate.y,
        titleDate.m - 1,
        titleDate.d,
      );
      const cat = (v as { category?: unknown }).category as
        | { name?: string | null }
        | { name?: string | null }[]
        | null
        | undefined;
      const categoryName = Array.isArray(cat)
        ? (cat[0]?.name ?? null)
        : (cat?.name ?? null);
      return {
        ...v,
        tMs: postedTMs, // kept for diag display only — not used in scoring
        titleDate,
        sortKey,
        categoryName,
      };
    })
    .filter((v): v is NonNullable<typeof v> => v !== null)
    .sort((a, b) => a.sortKey - b.sortKey);

  const usedReports = new Set<string>();
  const details: FflogsLinkDetail[] = [];
  let matched = 0;

  // 1.9.24 simplified matcher (user-driven rearchitecture):
  // 「動画のタイトル日付 == レポートの JST カレンダー日 + コンテンツ
  // 一致」 だけで判定。±時間ウィンドウ / RAID_HOUR_JST / SMALL_PENALTY
  // 等の複雑な scoring は撤廃。日付一致が原則、同日複数候補のとき
  // のみコンテンツ照合 (別グループはリジェクト) でフィルタ。
  const HOUR_MS = 60 * 60 * 1000;
  const sameJstDay = (
    a: { y: number; m: number; d: number },
    b: { y: number; m: number; d: number },
  ) => a.y === b.y && a.m === b.m && a.d === b.d;
  const scoreCandidate = (
    video: {
      titleDate: { y: number; m: number; d: number };
      categoryName: string | null;
      title: string | null;
    },
    report: FflogsReport,
  ): { score: number } => {
    const reportDate = jstCalendarDate(report.startMs);
    if (!sameJstDay(video.titleDate, reportDate)) return { score: Infinity };
    const mismatch = contentMismatchPenalty(
      video.categoryName,
      video.title,
      report.zoneName,
      report.title,
    );
    if (mismatch === 1) return { score: Infinity };
    // Same JST day. Confident-match (mismatch=0) beats ambiguous (0.5).
    // Within same tier: rely on greedy global pair sort + ordering by
    // report.startMs for stability.
    return { score: mismatch === 0.5 ? 1 : 0 };
  };

  // Build all candidate (video, report) tuples and assign greedily.
  type Pair = {
    video: (typeof sortedVideos)[number];
    report: FflogsReport;
    score: number;
  };
  const pairs: Pair[] = [];
  for (const v of sortedVideos) {
    for (const r of reports) {
      const { score } = scoreCandidate(v, r);
      if (Number.isFinite(score)) {
        pairs.push({ video: v, report: r, score });
      }
    }
  }
  // Stable secondary sort: by report.startMs ascending, so when
  // multiple same-day reports exist the earliest one is picked first.
  pairs.sort(
    (a, b) => a.score - b.score || a.report.startMs - b.report.startMs,
  );
  const usedVideos = new Set<string>();
  for (const pair of pairs) {
    const vId = pair.video.id as string;
    if (usedVideos.has(vId)) continue;
    if (usedReports.has(pair.report.id)) continue;
    const logsUrl = `https://www.fflogs.com/reports/${pair.report.id}`;
    const { error } = await supabase
      .from("category_links")
      .update({ logs_url: logsUrl, logs_url_source: "auto" })
      .eq("id", vId)
      .is("logs_url", null);
    if (error) {
      console.warn("[fflogs-link/video] update failed", vId, error.message);
      continue;
    }
    usedReports.add(pair.report.id);
    usedVideos.add(vId);
    matched += 1;
    // Re-use the same titleDate that scoring used.
    const videoTitleDate = pair.video.titleDate;
    const reportJst = jstCalendarDate(pair.report.startMs);
    const fmt = (d: { y: number; m: number; d: number } | null) =>
      d ? `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}` : undefined;
    // Format report.startMs in JST (YYYY-MM-DD HH:mm).
    const formatJst = (ms: number) => {
      const dt = new Date(ms + 9 * HOUR_MS);
      const Y = dt.getUTCFullYear();
      const M = String(dt.getUTCMonth() + 1).padStart(2, "0");
      const D = String(dt.getUTCDate()).padStart(2, "0");
      const h = String(dt.getUTCHours()).padStart(2, "0");
      const mi = String(dt.getUTCMinutes()).padStart(2, "0");
      return `${Y}-${M}-${D} ${h}:${mi}`;
    };
    details.push({
      kind: "video",
      label: pair.video.title as string,
      reportTitle: pair.report.title || "(無題のレポート)",
      reportUrl: logsUrl,
      videoDate: videoTitleDate
        ? fmt(videoTitleDate)
        : pair.video.tMs !== null
          ? new Date(pair.video.tMs).toISOString().slice(0, 10) +
            " (posted_at)"
          : undefined,
      reportDate: fmt(reportJst),
      reportStartJst: formatJst(pair.report.startMs),
    });
  }

  // dateRange uses sortKey (which is title-date when available, posted_at
  // otherwise) — not the raw tMs since some videos have null tMs.
  const dateRange =
    sortedVideos.length > 0
      ? {
          earliest: new Date(sortedVideos[0]!.sortKey)
            .toISOString()
            .slice(0, 10),
          latest: new Date(sortedVideos[sortedVideos.length - 1]!.sortKey)
            .toISOString()
            .slice(0, 10),
        }
      : undefined;

  return {
    scanned: sortedVideos.length,
    matched,
    details,
    dateRange,
    skippedNoPostedAt: videosSkippedNoTitleDate,
    titleDateHits,
    titleDateMisses,
    titleDateMissSample,
  };
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

  // 1.9.24 simplified: 「同 JST 日」だけで判定。session の parsed_date
  // と report の startMs が同じ JST カレンダー日なら候補。±時間
  // ウィンドウは撤廃 (Log は実際の挑戦日なので日跨ぎ以外で外れ値に
  // ならない、というユーザー知見ベース)。
  type SPair = {
    session: (typeof sortedSessions)[number];
    report: FflogsReport;
    score: number;
  };
  const sameJstDay = (
    a: { y: number; m: number; d: number },
    b: { y: number; m: number; d: number },
  ) => a.y === b.y && a.m === b.m && a.d === b.d;
  const pairs: SPair[] = [];
  for (const s of sortedSessions) {
    const sJst = jstCalendarDate(s.tMs);
    for (const r of reports) {
      const rJst = jstCalendarDate(r.startMs);
      if (!sameJstDay(sJst, rJst)) continue;
      pairs.push({
        session: s,
        report: r,
        // Tie-breaker: prefer report closer to session.parsed_date
        // when the same date has multiple reports.
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
      .update({ logs_url: logsUrl, logs_url_source: "auto" })
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
    const sessionJst = jstCalendarDate(pair.session.tMs);
    const reportJst = jstCalendarDate(pair.report.startMs);
    const fmt = (d: { y: number; m: number; d: number }) =>
      `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
    const HOUR_MS_LOCAL = 60 * 60 * 1000;
    const formatJstSession = (ms: number) => {
      const dt = new Date(ms + 9 * HOUR_MS_LOCAL);
      const Y = dt.getUTCFullYear();
      const M = String(dt.getUTCMonth() + 1).padStart(2, "0");
      const D = String(dt.getUTCDate()).padStart(2, "0");
      const h = String(dt.getUTCHours()).padStart(2, "0");
      const mi = String(dt.getUTCMinutes()).padStart(2, "0");
      return `${Y}-${M}-${D} ${h}:${mi}`;
    };
    details.push({
      kind: "session",
      label: sKey,
      reportTitle: pair.report.title || "(無題のレポート)",
      reportUrl: logsUrl,
      videoDate: fmt(sessionJst),
      reportDate: fmt(reportJst),
      reportStartJst: formatJstSession(pair.report.startMs),
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
