import { NextResponse, type NextRequest } from "next/server";
import { fetchPageTitle } from "@/lib/server/page-title";

/**
 * GET /api/page-title?url=<encoded URL>
 *
 * Returns `{ title: string }` extracted from the URL's HTML <title> tag,
 * or from YouTube's oEmbed API for YouTube URLs. Used by the link/video
 * registration dialog to autopopulate the title field.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("url");
  if (!raw) {
    return NextResponse.json({ error: "url required" }, { status: 400 });
  }

  try {
    new URL(raw);
  } catch {
    return NextResponse.json({ error: "invalid url" }, { status: 400 });
  }

  const title = await fetchPageTitle(raw);
  if (!title) {
    return NextResponse.json({ error: "title not found" }, { status: 502 });
  }
  return NextResponse.json({ title });
}
