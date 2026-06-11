import { NextResponse, type NextRequest } from "next/server";
import {
  buildFflogsReportsListUrl,
  buildFflogsScrapeHeaders,
  FFLOGS_SCRAPE_MAX_PAGES,
  FFLOGS_SCRAPE_TIMEOUT_MS,
} from "@/lib/server/fflogs-scrape-request";

/**
 * 2.9 (2026-06-11): FFLogs HTML scrape の Edge IP 中継 (サーバー間専用 API)。
 *
 * 経緯: ポータル全ページを Node runtime 化 (cold start 対策、#181) した
 * 直後の本番実測で、Node Lambda IP からの fflogs.com scrape は Cloudflare
 * bot 判定で**恒常的に** 403 になることが確定した (リトライ含め全敗)。
 * 一方 Edge IP は通る (2.8 実測: 459 件取得)。ページ側 runtime を Edge に
 * 戻すと cold start が再発するため、外向き fetch だけを本 route に切り出し、
 * 「ページは Node / scrape は Edge IP」を両立させる。
 *
 * 呼び出し元は `fflogs.ts` の `fetchScrapePageHtml()` のみ (manual 連動
 * Server Action と cron の両方がここを経由する)。cron も元々 Node runtime
 * なので、本 route 経由になることで日次 scrape も Edge IP 化される。
 *
 * 認証: `Authorization: Bearer ${CRON_SECRET}` (サーバー間共有 secret)。
 * proxy.ts で login redirect 対象から除外しているため (PUBLIC_PATHS)、
 * 認証は本 route 内で完結させる。誤 Bearer 連打は proxy.ts の rate limit
 * (60 req / 60 sec) が前段で抑える。
 *
 * SSRF 安全性: fetch 先は `userId` (正整数) と `page` (1..MAX_PAGES) から
 * 組み立てる fflogs.com の reports-list URL に固定。任意 URL は渡せない。
 * sessionCookie は呼び出し元が secrets テーブルから取得した値の中継で、
 * レスポンス・ログには含めない。
 */
export const runtime = "edge";

/**
 * Edge runtime では `node:crypto` の `timingSafeEqual` が使えないため、
 * SHA-256 digest 同士の比較でタイミング攻撃耐性を得る (digest 化すると
 * 比較の不一致位置が secret の文字位置と相関しなくなる)。cron-auth.ts
 * (Node 専用) と同趣旨の Edge 版。
 */
async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return Array.from(new Uint8Array(buf), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    console.warn("[fflogs/scrape-proxy] CRON_SECRET not configured");
    return NextResponse.json(
      { error: "CRON_SECRET not configured" },
      { status: 503 },
    );
  }
  const authHeader = request.headers.get("authorization") ?? "";
  if ((await sha256Hex(authHeader)) !== (await sha256Hex(`Bearer ${secret}`))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { userId?: unknown; page?: unknown; sessionCookie?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const { userId, page, sessionCookie } = body;
  if (
    typeof userId !== "number" ||
    !Number.isInteger(userId) ||
    userId <= 0 ||
    typeof page !== "number" ||
    !Number.isInteger(page) ||
    page < 1 ||
    page > FFLOGS_SCRAPE_MAX_PAGES ||
    (sessionCookie != null && typeof sessionCookie !== "string")
  ) {
    return NextResponse.json({ error: "invalid params" }, { status: 400 });
  }

  try {
    const res = await fetch(buildFflogsReportsListUrl(userId, page), {
      headers: buildFflogsScrapeHeaders(
        typeof sessionCookie === "string" ? sessionCookie : null,
      ),
      signal: AbortSignal.timeout(FFLOGS_SCRAPE_TIMEOUT_MS),
      // cookie 無効時の /login redirect を検出するため自動 follow しない
      // (fflogs.ts の直接 fetch と同じ方針)。
      redirect: "manual",
    });
    if (res.status >= 300 && res.status < 400) {
      return NextResponse.json({
        status: res.status,
        redirected: true,
        html: null,
      });
    }
    if (!res.ok) {
      return NextResponse.json({
        status: res.status,
        redirected: false,
        html: null,
      });
    }
    const html = await res.text();
    return NextResponse.json({ status: res.status, redirected: false, html });
  } catch (e) {
    // fflogs への到達自体に失敗 (タイムアウト等)。呼び出し元はこれを
    // 「proxy 経路の失敗」として直接 fetch に fallback する。
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}
