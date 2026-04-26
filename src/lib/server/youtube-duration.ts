import "server-only";
import { parseYouTubeId } from "@/lib/youtube";

/**
 * Lightweight concurrency-limited map. Used by the bulk backfills so we
 * don't fire dozens of YouTube fetches in series.
 */
async function pmap<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (true) {
        const i = next++;
        if (i >= items.length) return;
        results[i] = await fn(items[i]!, i);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

export type YouTubeMeta = {
  /** Length in seconds (null if not parseable / non-YouTube). */
  durationSeconds: number | null;
  /** ISO 8601 upload timestamp (null if not parseable / non-YouTube). */
  uploadDate: string | null;
};

/**
 * Fetch a YouTube video's duration AND upload date via HTML scrape.
 *
 * Why scrape instead of using the YouTube Data API:
 *   - The Data API requires an extra `YOUTUBE_API_KEY` env var, which
 *     adds friction for fork deployments
 *   - Volume per group is small (tens of videos), so rate limits aren't
 *     a real concern
 *   - We only need duration + uploadDate; the watch page exposes both
 *     in embedded JSON which is stable enough for our use
 *
 * Returns `{ durationSeconds: null, uploadDate: null }` on failure
 * (non-YouTube URL, network failure, page format changed). Caller
 * should treat null as "unknown" and not fail the surrounding flow.
 */
/**
 * Realistic Chrome UA — YouTube serves a different (lighter) HTML to
 * suspected bots, sometimes without the structured data we need. A
 * real browser UA gets the full watch page.
 */
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/**
 * The CONSENT cookie below pre-accepts YouTube's EU consent gate so we
 * don't get redirected to consent.youtube.com (which has zero metadata
 * we can use). Value `YES+cb` is the standard "consent given" form.
 */
const CONSENT_COOKIE = "CONSENT=YES+cb; SOCS=CAI";

/**
 * `oembed` fallback — gives us title + author but not duration. We don't
 * use it directly; instead, we use the standard watch page first and
 * only fall back on the alternate URL form when the primary fails.
 */
const ALT_HOSTS = ["www.youtube.com", "m.youtube.com"];

export type YouTubeMetaDebug = {
  attempts: Array<{
    host: string;
    status: number | "error" | "timeout";
    htmlSize: number | null;
    foundLength: boolean;
    foundUpload: boolean;
    /** Which parser strategy matched, if any. */
    matchedStrategy?: "player" | "ldjson" | "meta";
    /** Indicators that help diagnose what kind of page YouTube returned. */
    pageMarkers?: {
      hasPlayerResponse: boolean;
      hasLdJson: boolean;
      hasItempropDuration: boolean;
      hasConsentText: boolean;
      hasSignInWall: boolean;
    };
    note?: string;
  }>;
};

/**
 * Parse ISO 8601 duration (e.g. "PT3M33S", "PT1H2M3S") into seconds.
 * Returns null on malformed input. Used by both the JSON-LD path and
 * the `<meta itemprop="duration">` path.
 */
function parseIsoDuration(raw: string): number | null {
  const m = raw.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return null;
  const h = m[1] ? parseInt(m[1], 10) : 0;
  const min = m[2] ? parseInt(m[2], 10) : 0;
  const s = m[3] ? parseInt(m[3], 10) : 0;
  const total = h * 3600 + min * 60 + s;
  return total > 0 ? total : null;
}

/**
 * Apply three parser strategies and combine results — different YouTube
 * HTML variants expose different fields, so we try all three and take
 * the first non-null match per field. `matchedStrategy` records which
 * variant FIRST produced any non-null value (best-effort label).
 *
 *   1. ytInitialPlayerResponse: "lengthSeconds":"213" + "uploadDate":"..."
 *   2. JSON-LD VideoObject: {"duration":"PT3M33S","uploadDate":"..."}
 *   3. <meta itemprop="duration" content="PT3M33S">
 *      <meta itemprop="datePublished" content="...">
 */
function parseMetaFromHtml(html: string): {
  durationSeconds: number | null;
  uploadDate: string | null;
  matchedStrategy?: "player" | "ldjson" | "meta";
} {
  let durationSeconds: number | null = null;
  let uploadDate: string | null = null;
  let matchedStrategy: "player" | "ldjson" | "meta" | undefined;

  const tag = (s: typeof matchedStrategy) => {
    if (!matchedStrategy) matchedStrategy = s;
  };

  // Strategy 1: player response.
  const dm = html.match(/"lengthSeconds"\s*:\s*"(\d+)"/);
  if (dm) {
    const s = parseInt(dm[1]!, 10);
    if (Number.isFinite(s) && s > 0) {
      durationSeconds = s;
      tag("player");
    }
  }
  if (uploadDate === null) {
    const um = html.match(/"uploadDate"\s*:\s*"([^"]+)"/);
    if (um) {
      const norm = normalizeDate(um[1]!);
      if (norm) {
        uploadDate = norm;
        tag("player");
      }
    }
  }
  if (uploadDate === null) {
    const pm = html.match(/"publishDate"\s*:\s*"([^"]+)"/);
    if (pm) {
      const norm = normalizeDate(pm[1]!);
      if (norm) {
        uploadDate = norm;
        tag("player");
      }
    }
  }

  // Strategy 2: JSON-LD VideoObject (only if a field is still missing).
  if (durationSeconds === null || uploadDate === null) {
    const ld = html.match(
      /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i,
    );
    if (ld) {
      try {
        const obj = JSON.parse(ld[1]!.trim());
        if (durationSeconds === null && typeof obj?.duration === "string") {
          const sec = parseIsoDuration(obj.duration);
          if (sec !== null) {
            durationSeconds = sec;
            tag("ldjson");
          }
        }
        if (uploadDate === null) {
          const ud = obj?.uploadDate ?? obj?.datePublished;
          if (typeof ud === "string") {
            const norm = normalizeDate(ud);
            if (norm) {
              uploadDate = norm;
              tag("ldjson");
            }
          }
        }
      } catch {
        // malformed JSON — ignore
      }
    }
  }

  // Strategy 3: <meta itemprop="duration"> + datePublished.
  if (durationSeconds === null) {
    const md = html.match(
      /<meta[^>]+itemprop=["']duration["'][^>]+content=["']([^"']+)["']/i,
    );
    if (md) {
      const sec = parseIsoDuration(md[1]!);
      if (sec !== null) {
        durationSeconds = sec;
        tag("meta");
      }
    }
  }
  if (uploadDate === null) {
    const mu = html.match(
      /<meta[^>]+itemprop=["']datePublished["'][^>]+content=["']([^"']+)["']/i,
    );
    if (mu) {
      const norm = normalizeDate(mu[1]!);
      if (norm) {
        uploadDate = norm;
        tag("meta");
      }
    }
  }
  if (uploadDate === null) {
    const mu2 = html.match(
      /<meta[^>]+itemprop=["']uploadDate["'][^>]+content=["']([^"']+)["']/i,
    );
    if (mu2) {
      const norm = normalizeDate(mu2[1]!);
      if (norm) {
        uploadDate = norm;
        tag("meta");
      }
    }
  }

  return { durationSeconds, uploadDate, matchedStrategy };
}

function detectPageMarkers(html: string) {
  return {
    hasPlayerResponse: html.includes("ytInitialPlayerResponse"),
    hasLdJson: /<script[^>]+type=["']application\/ld\+json["']/i.test(html),
    hasItempropDuration: /itemprop=["']duration["']/i.test(html),
    hasConsentText:
      html.includes("Before you continue to YouTube") ||
      html.includes("consent.youtube.com"),
    hasSignInWall: html.includes("Sign in to confirm"),
  };
}

/**
 * Internal core — fetches with debug info attached so the diagnostic
 * Server Action can surface exactly which step failed.
 */
async function fetchYouTubeMetaInternal(
  url: string,
  debug?: YouTubeMetaDebug,
): Promise<YouTubeMeta> {
  const id = parseYouTubeId(url);
  if (!id) {
    debug?.attempts.push({
      host: "(none)",
      status: "error",
      htmlSize: null,
      foundLength: false,
      foundUpload: false,
      note: "URL did not parse as YouTube",
    });
    return { durationSeconds: null, uploadDate: null };
  }
  for (const host of ALT_HOSTS) {
    // bpctr=9999999999: bypass consent gate (timestamp far in the future)
    // has_verified=1: skip age gate (we accept maturity warnings)
    // hl=en: lock locale to English so JSON keys aren't translated/missing
    const target = `https://${host}/watch?v=${id}&hl=en&bpctr=9999999999&has_verified=1`;
    let status: number | "error" | "timeout" = "error";
    let htmlSize: number | null = null;
    let foundLength = false;
    let foundUpload = false;
    let note: string | undefined;
    try {
      const res = await fetch(target, {
        headers: {
          // Real-browser UA — bot UAs sometimes get a stripped page.
          "User-Agent": BROWSER_UA,
          "Accept-Language": "en-US,en;q=0.9",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          // Pre-accept the consent gate so we don't follow redirects
          // into consent.youtube.com, which has none of the metadata.
          Cookie: CONSENT_COOKIE,
        },
        signal: AbortSignal.timeout(8000),
        redirect: "follow",
      });
      status = res.status;
      if (!res.ok) {
        debug?.attempts.push({
          host,
          status,
          htmlSize,
          foundLength,
          foundUpload,
          note: "non-200",
        });
        continue;
      }
      const finalUrl = res.url;
      if (finalUrl.includes("consent.youtube.com")) {
        note = "redirected to consent gate despite cookie";
        debug?.attempts.push({
          host,
          status,
          htmlSize,
          foundLength,
          foundUpload,
          note,
        });
        continue;
      }
      const html = await res.text();
      htmlSize = html.length;

      const parsed = parseMetaFromHtml(html);
      foundLength = parsed.durationSeconds !== null;
      foundUpload = parsed.uploadDate !== null;
      const pageMarkers = detectPageMarkers(html);

      debug?.attempts.push({
        host,
        status,
        htmlSize,
        foundLength,
        foundUpload,
        matchedStrategy: parsed.matchedStrategy,
        pageMarkers,
      });
      if (foundLength || foundUpload) {
        return {
          durationSeconds: parsed.durationSeconds,
          uploadDate: parsed.uploadDate,
        };
      }
      // Otherwise loop to next host as a fallback.
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      status = msg.includes("aborted") || msg.includes("timeout")
        ? "timeout"
        : "error";
      debug?.attempts.push({
        host,
        status,
        htmlSize,
        foundLength,
        foundUpload,
        note: msg.slice(0, 120),
      });
      // try the next host
    }
  }
  return { durationSeconds: null, uploadDate: null };
}

export async function fetchYouTubeMeta(url: string): Promise<YouTubeMeta> {
  return fetchYouTubeMetaInternal(url);
}

/**
 * Diagnostic helper — fetches one URL and returns both meta and a
 * per-host attempt log. Surfaced via a Server Action so the user can
 * see exactly why a URL fails (consent redirect / non-200 / regex miss).
 */
export async function fetchYouTubeMetaWithDebug(url: string): Promise<{
  meta: YouTubeMeta;
  debug: YouTubeMetaDebug;
}> {
  const debug: YouTubeMetaDebug = { attempts: [] };
  const meta = await fetchYouTubeMetaInternal(url, debug);
  return { meta, debug };
}

/** Back-compat alias — prefer `fetchYouTubeMeta` for new code. */
export async function fetchYouTubeDuration(
  url: string,
): Promise<number | null> {
  const { durationSeconds } = await fetchYouTubeMeta(url);
  return durationSeconds;
}

function normalizeDate(raw: string): string | null {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export { pmap };
