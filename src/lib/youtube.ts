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
  // youtube-nocookie.com (privacy-enhanced mode) is treated more leniently
  // by some uploaders' embed restrictions and is the recommended host for
  // third-party sites that don't need analytics. Combined with conservative
  // player params:
  //   - rel=0: no related-video sidebar from other channels at the end
  //   - modestbranding=1: minimal YouTube logo (deprecated but harmless)
  //   - playsinline=1: keep inline on iOS instead of fullscreening
  // These do NOT bypass uploader-disabled embedding (error 150/153) — for
  // those videos the user has to use the visible "YouTubeで開く" fallback
  // button rendered alongside the iframe.
  return `https://www.youtube-nocookie.com/embed/${id}?rel=0&modestbranding=1&playsinline=1`;
}

export function youtubeThumbnailUrl(id: string): string {
  // hqdefault is reliably available; mqdefault is smaller. Keep hqdefault
  // since cards are large enough to benefit from it.
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}
