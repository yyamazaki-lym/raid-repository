import { NextResponse, type NextRequest } from "next/server";
import { fetchPageTitle } from "@/lib/server/page-title";
import { isSafeUrl } from "@/lib/url-safe";

/**
 * GET /api/page-title?url=<encoded URL>
 *
 * Returns `{ title: string }` extracted from the URL's HTML <title> tag,
 * or from YouTube's oEmbed API for YouTube URLs. Used by the link/video
 * registration dialog to autopopulate the title field.
 *
 * SECURITY: Only http(s) schemes are accepted. `data:`, `file:`,
 * `javascript:` URIs are rejected at the route boundary so they never
 * reach the fetcher (where they'd be rejected anyway, but failing fast
 * gives the caller a clearer error).
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("url");
  if (!raw) {
    return NextResponse.json({ error: "url required" }, { status: 400 });
  }

  if (!isSafeUrl(raw)) {
    return NextResponse.json(
      { error: "invalid url (http/https only)" },
      { status: 400 },
    );
  }

  const title = await fetchPageTitle(raw);
  if (!title) {
    return NextResponse.json({ error: "title not found" }, { status: 502 });
  }
  return NextResponse.json({ title });
}
