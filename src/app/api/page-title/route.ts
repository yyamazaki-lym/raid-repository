import { NextResponse, type NextRequest } from "next/server";
import { parseYouTubeId } from "@/lib/youtube";

/**
 * GET /api/page-title?url=<encoded URL>
 *
 * Returns `{ title: string }` extracted from the URL's HTML <title> tag,
 * or from YouTube's oEmbed API for YouTube URLs (which gives a clean
 * video title without "- YouTube" suffix).
 *
 * Errors:
 *   400 — URL missing or malformed
 *   502 — couldn't reach the URL or extract a title
 *
 * Used by the link/video registration dialog to autopopulate the title
 * field. Server-side fetch sidesteps CORS so any URL is reachable.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("url");
  if (!raw) {
    return NextResponse.json({ error: "url required" }, { status: 400 });
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return NextResponse.json({ error: "invalid url" }, { status: 400 });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return NextResponse.json({ error: "unsupported protocol" }, { status: 400 });
  }

  // YouTube — use oEmbed for a clean title.
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
        if (data.title) {
          return NextResponse.json({ title: data.title });
        }
      }
    } catch {
      // Fall through to generic HTML scrape.
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
    if (!res.ok) {
      return NextResponse.json(
        { error: `upstream ${res.status}` },
        { status: 502 },
      );
    }
    const html = await res.text();

    // Try og:title first (often cleaner), then <title>.
    const ogMatch = html.match(
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
    );
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const raw =
      (ogMatch?.[1] ?? titleMatch?.[1] ?? "").trim();

    if (!raw) {
      return NextResponse.json(
        { error: "title not found" },
        { status: 502 },
      );
    }

    return NextResponse.json({ title: decodeEntities(raw) });
  } catch (err) {
    console.warn("[page-title] fetch error:", err);
    return NextResponse.json({ error: "fetch failed" }, { status: 502 });
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
