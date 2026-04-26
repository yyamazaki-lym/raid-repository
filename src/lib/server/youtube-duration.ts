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
    note?: string;
  }>;
};

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
    const target = `https://${host}/watch?v=${id}&hl=en`;
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

      let durationSeconds: number | null = null;
      const dm = html.match(/"lengthSeconds"\s*:\s*"(\d+)"/);
      if (dm) {
        const s = parseInt(dm[1]!, 10);
        if (Number.isFinite(s) && s > 0) durationSeconds = s;
      }
      foundLength = durationSeconds !== null;

      let uploadDate: string | null = null;
      const um = html.match(/"uploadDate"\s*:\s*"([^"]+)"/);
      if (um) uploadDate = normalizeDate(um[1]!);
      if (!uploadDate) {
        const pm = html.match(/"publishDate"\s*:\s*"([^"]+)"/);
        if (pm) uploadDate = normalizeDate(pm[1]!);
      }
      foundUpload = uploadDate !== null;

      debug?.attempts.push({
        host,
        status,
        htmlSize,
        foundLength,
        foundUpload,
      });
      if (durationSeconds !== null || uploadDate !== null) {
        return { durationSeconds, uploadDate };
      }
      // Otherwise loop to next host as a fallback (rare).
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
