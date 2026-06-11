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
// YouTube 動画 ID は 11 文字の [A-Za-z0-9_-]。これ以外は URL 由来の
// 想定外文字列 (例: `?v=abc&x=y` で `abc&x=y` が混入) なので null 扱いにし、
// 下流の scrape URL (`youtube-duration.ts`) へ追加クエリが注入されるのを防ぐ。
const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;
function validYouTubeId(id: string | null | undefined): string | null {
  return id && YOUTUBE_ID_RE.test(id) ? id : null;
}

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
    return validYouTubeId(id);
  }
  if (host === "youtube.com" || host === "m.youtube.com") {
    if (parsed.pathname === "/watch") {
      return validYouTubeId(parsed.searchParams.get("v"));
    }
    const m = parsed.pathname.match(/^\/(embed|shorts|live)\/([^/]+)/);
    if (m) return validYouTubeId(m[2]);
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
