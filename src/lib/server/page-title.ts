import "server-only";
import { decodeHtmlEntities } from "@/lib/html-entities";
import { parseYouTubeId } from "@/lib/youtube";

export type PageMeta = {
  title: string | null;
  /** og:image (HTML) または YouTube oEmbed thumbnail_url。http(s) 絶対化済。 */
  imageUrl: string | null;
};

/**
 * Server-side ページメタ取得器。タイトルと og:image を 1 度の fetch で
 * まとめて取得する (Phase 14, 2026-05-13)。
 *
 * Strategy:
 *   1. YouTube → oEmbed で title + thumbnail_url
 *   2. その他 → 1 度の HTML 取得から og:title / `<title>` と og:image を抽出
 *
 * いずれも失敗時は対応フィールドを null。
 */
export async function fetchPageMeta(url: string): Promise<PageMeta> {
  const empty: PageMeta = { title: null, imageUrl: null };
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return empty;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return empty;
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
        const data = (await res.json()) as {
          title?: string;
          thumbnail_url?: string;
        };
        if (data.title || data.thumbnail_url) {
          return {
            title: data.title ?? null,
            imageUrl: data.thumbnail_url ?? null,
          };
        }
      }
    } catch {
      // fall through
    }
  }

  // Generic HTML scrape.
  try {
    const res = await fetch(parsed.toString(), {
      headers: {
        // Generic UA — fork deployments shouldn't all impersonate one URL.
        "User-Agent":
          "Mozilla/5.0 (compatible; RaidRepositoryBot/0.1)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9",
      },
      signal: AbortSignal.timeout(8000),
      redirect: "follow",
    });
    if (!res.ok) return empty;
    const html = await res.text();

    const ogTitleMatch = html.match(
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
    );
    const titleTagMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const rawTitle = (ogTitleMatch?.[1] ?? titleTagMatch?.[1] ?? "").trim();
    // 1.9 (2026-04-28) TODO #13: named entity 込みで decode 必要。
    const title = rawTitle ? decodeHtmlEntities(rawTitle) : null;

    // og:image: property/name + content の順序どちらでも拾えるよう 2 パターン。
    // 相対 URL は元 URL を base に絶対化、http(s) 以外は破棄 (data: 等を遮断)。
    const ogImageMatch =
      html.match(
        /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
      ) ??
      html.match(
        /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
      );
    let imageUrl: string | null = null;
    const rawImage = ogImageMatch?.[1]?.trim();
    if (rawImage) {
      try {
        const resolved = new URL(decodeHtmlEntities(rawImage), parsed);
        if (
          resolved.protocol === "http:" ||
          resolved.protocol === "https:"
        ) {
          imageUrl = resolved.toString();
        }
      } catch {
        // 解決不能な og:image は捨てる
      }
    }

    return { title, imageUrl };
  } catch {
    return empty;
  }
}

/**
 * 旧 API 互換ラッパ。既存呼び出し元 (`/api/page-title` route と Discord cron
 * import) は title のみ必要なので、`fetchPageMeta` の title フィールドだけ
 * 返す。新規コードは `fetchPageMeta` を直接呼ぶこと。
 */
export async function fetchPageTitle(url: string): Promise<string | null> {
  return (await fetchPageMeta(url)).title;
}
