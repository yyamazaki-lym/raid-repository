import "server-only";
import { parseYouTubeId } from "@/lib/youtube";

/**
 * Fetch a YouTube video's duration in seconds via HTML scrape.
 *
 * Why scrape instead of using the YouTube Data API:
 *   - The Data API requires an extra `YOUTUBE_API_KEY` env var, which adds
 *     friction for fork deployments
 *   - Volume per group is small (tens of videos), so rate limits aren't
 *     a real concern
 *   - We only need duration; the watch page exposes `lengthSeconds` in
 *     embedded JSON which is stable enough for our use
 *
 * Returns null on:
 *   - Non-YouTube URL
 *   - Network failure / non-200
 *   - Page format changed (lengthSeconds key not present)
 *
 * Caller should treat null as "unknown" and not fail the surrounding flow.
 */
export async function fetchYouTubeDuration(
  url: string,
): Promise<number | null> {
  const id = parseYouTubeId(url);
  if (!id) return null;
  try {
    const res = await fetch(`https://www.youtube.com/watch?v=${id}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; RaidRepositoryBot/0.1)",
        // Force English so any locale-specific markup variations are
        // less likely to bite us.
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(8000),
      redirect: "follow",
    });
    if (!res.ok) return null;
    const html = await res.text();

    // The watch page embeds player config JSON. The duration appears as
    //   "lengthSeconds":"123"
    // somewhere in that blob. Tolerate optional whitespace.
    const m = html.match(/"lengthSeconds"\s*:\s*"(\d+)"/);
    if (!m) return null;
    const seconds = parseInt(m[1]!, 10);
    if (!Number.isFinite(seconds) || seconds <= 0) return null;
    return seconds;
  } catch {
    return null;
  }
}
