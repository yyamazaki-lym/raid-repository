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
export async function fetchYouTubeMeta(url: string): Promise<YouTubeMeta> {
  const id = parseYouTubeId(url);
  if (!id) return { durationSeconds: null, uploadDate: null };
  try {
    const res = await fetch(`https://www.youtube.com/watch?v=${id}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; RaidRepositoryBot/0.1)",
        // Force English so locale-specific markup variations are less
        // likely to bite us (e.g. some date formats vary by Accept-Language).
        "Accept-Language": "en-US,en;q=0.9",
      },
      // Tightened from 8s to 5s — at concurrency=8 that's the difference
      // between a fast user-visible spinner and a sluggish one.
      signal: AbortSignal.timeout(5000),
      redirect: "follow",
    });
    if (!res.ok) return { durationSeconds: null, uploadDate: null };
    const html = await res.text();

    let durationSeconds: number | null = null;
    const dm = html.match(/"lengthSeconds"\s*:\s*"(\d+)"/);
    if (dm) {
      const s = parseInt(dm[1]!, 10);
      if (Number.isFinite(s) && s > 0) durationSeconds = s;
    }

    let uploadDate: string | null = null;
    // 1. JSON-LD structured data (most reliable / human-readable).
    const um = html.match(/"uploadDate"\s*:\s*"([^"]+)"/);
    if (um) uploadDate = normalizeDate(um[1]!);
    // 2. Player config publish date as fallback.
    if (!uploadDate) {
      const pm = html.match(/"publishDate"\s*:\s*"([^"]+)"/);
      if (pm) uploadDate = normalizeDate(pm[1]!);
    }

    return { durationSeconds, uploadDate };
  } catch {
    return { durationSeconds: null, uploadDate: null };
  }
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
