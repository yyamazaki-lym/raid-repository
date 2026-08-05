import { NextResponse, type NextRequest } from "next/server";
import { fetchPageTitle } from "@/lib/server/page-title";
import { isPublicHttpUrl } from "@/lib/url-safe";
import { requireDiscordMember } from "@/lib/server/auth";

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
 * - 2026-08-05 監査 H-3: ホスト名が内部 IP に解決するケース
 *   (`127.0.0.1.nip.io` / `localtest.me` など) は `isPublicHttpUrl` を
 *   素通りするため、実 fetch 側 (`safe-fetch.ts`) で解決済み IP を検証 +
 *   ピン留めする。DNS rebinding も同時に塞がる。
 * - 2026-08-05 監査 M-3: ハンドラ内認可を追加。従来は `proxy.ts` の
 *   matcher 任せで、この route だけが「Route Handler 側でも
 *   `requireDiscordMember()` を呼ぶ」方針から漏れていた。SSRF の入口
 *   なので、matcher のリファクタで silent に露出すると影響が大きい。
 * - rate limit は `proxy.ts` の `RATE_LIMIT_RULES` 経由で適用される
 *   (`/api/page-title`: 30 req / 60 sec per-IP)。
 * - body size は `fetchPageMeta` 側で chunked 読み取りで 1MB に制限。
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  // proxy.ts の matcher に依存しない defense-in-depth。非メンバーは
  // redirect() が throw されるので、ここから先へは進めない。
  //
  // PUBLIC_DEMO_MODE では `requireDiscordMember()` が throw せず匿名ゲストを
  // 返すため、ゲストは明示的に 403 にする (proxy.ts:222 と同じ判断 —
  // 実セッションを持つ owner だけが外部 fetch 経路を使える)。
  const member = await requireDiscordMember();
  if (member.isDemoGuest) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

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
