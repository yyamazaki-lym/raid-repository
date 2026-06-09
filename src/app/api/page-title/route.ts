import { NextResponse, type NextRequest } from "next/server";
import { fetchPageTitle } from "@/lib/server/page-title";
import { isPublicHttpUrl } from "@/lib/url-safe";

/**
 * GET /api/page-title?url=<encoded URL>
 *
 * Returns `{ title: string }` extracted from the URL's HTML <title> tag,
 * or from YouTube's oEmbed API for YouTube URLs. Used by the link/video
 * registration dialog to autopopulate the title field.
 *
 * SECURITY:
 * - Only http(s) schemes are accepted. `data:`, `file:`, `javascript:`
 *   URIs are rejected at the route boundary.
 * - 2.x (2026-06-09): `isPublicHttpUrl` で内部 IP (loopback / private /
 *   link-local / AWS IMDS 169.254.169.254 / `localhost` / `*.internal`
 *   など) を弾く SSRF ガードを追加。
 * - rate limit は `proxy.ts` の `RATE_LIMIT_RULES` 経由で適用される
 *   (`/api/page-title`: 30 req / 60 sec per-IP)。
 * - body size は `fetchPageMeta` 側で chunked 読み取りで 1MB に制限。
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("url");
  if (!raw) {
    return NextResponse.json({ error: "url required" }, { status: 400 });
  }

  if (!isPublicHttpUrl(raw)) {
    return NextResponse.json(
      {
        error:
          "invalid url (public http/https only, internal/loopback addresses rejected)",
      },
      { status: 400 },
    );
  }

  const title = await fetchPageTitle(raw);
  if (!title) {
    return NextResponse.json({ error: "title not found" }, { status: 502 });
  }
  return NextResponse.json({ title });
}
