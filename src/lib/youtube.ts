/**
 * Best-effort YouTube URL parsing. Used by the videos sub-tab to render
 * inline embeds + thumbnails for known YouTube link formats while leaving
 * other URLs to render as plain link cards.
 *
 * Supports:
 *   - https://www.youtube.com/watch?v=ID
 *   - https://youtu.be/ID
 *   - https://www.youtube.com/embed/ID
 *   - https://www.youtube.com/shorts/ID
 *   - https://www.youtube.com/live/ID
 */
export function parseYouTubeId(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.replace(/^www\./, "");
  if (host === "youtu.be") {
    const id = parsed.pathname.slice(1).split("/")[0];
    return id || null;
  }
  if (host === "youtube.com" || host === "m.youtube.com") {
    if (parsed.pathname === "/watch") {
      return parsed.searchParams.get("v");
    }
    const m = parsed.pathname.match(/^\/(embed|shorts|live)\/([^/]+)/);
    if (m) return m[2] ?? null;
  }
  return null;
}

export function youtubeEmbedUrl(id: string): string {
  return `https://www.youtube.com/embed/${id}`;
}

export function youtubeThumbnailUrl(id: string): string {
  // hqdefault is reliably available; mqdefault is smaller. Keep hqdefault
  // since cards are large enough to benefit from it.
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}
