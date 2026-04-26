import "server-only";
import { parseYouTubeId } from "@/lib/youtube";

/**
 * Server-side page-title fetcher. Used by both the public
 * `/api/page-title` route (called from the link dialog) and the
 * Discord cron import (called from `/api/cron/import-discord`).
 *
 * Strategy:
 *   1. YouTube → oEmbed (clean video title)
 *   2. Other URLs → og:title or HTML <title>, with HTML entity decoding
 *
 * Returns null on any failure (timeout, non-200 upstream, missing tag).
 */
export async function fetchPageTitle(url: string): Promise<string | null> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }

  // YouTube fast path.
  const ytId = parseYouTubeId(parsed.toString());
  if (ytId) {
    try {
      const oembedUrl =
        "https://www.youtube.com/oembed?format=json&url=" +
        encodeURIComponent(parsed.toString());
      const res = await fetch(oembedUrl, {
        headers: { "User-Agent": "RaidRepository/0.1" },
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const data = (await res.json()) as { title?: string };
        if (data.title) return data.title;
      }
    } catch {
      // fall through
    }
  }

  // Generic HTML scrape.
  try {
    const res = await fetch(parsed.toString(), {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; RaidRepositoryBot/0.1; +https://raid-repository.vercel.app)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9",
      },
      signal: AbortSignal.timeout(8000),
      redirect: "follow",
    });
    if (!res.ok) return null;
    const html = await res.text();
    const ogMatch = html.match(
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
    );
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const raw = (ogMatch?.[1] ?? titleMatch?.[1] ?? "").trim();
    if (!raw) return null;
    return decodeEntities(raw);
  } catch {
    return null;
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&hellip;/g, "…")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      try {
        return String.fromCodePoint(parseInt(hex, 16));
      } catch {
        return "";
      }
    })
    .replace(/&#(\d+);/g, (_, num) => {
      try {
        return String.fromCodePoint(parseInt(num, 10));
      } catch {
        return "";
      }
    });
}
