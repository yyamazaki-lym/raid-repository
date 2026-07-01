import "server-only";
import { decodeHtmlEntities } from "@/lib/html-entities";
import { parseYouTubeId } from "@/lib/youtube";
import { isPublicHttpUrl } from "@/lib/url-safe";

export type PageMeta = {
  title: string | null;
  /** og:image (HTML) または YouTube oEmbed thumbnail_url。http(s) 絶対化済。 */
  imageUrl: string | null;
};

/**
 * 本ファイル内の HTML 取得 fetch で許容する最大バイト数。
 * 2.x (2026-06-09): 巨大 HTML を返すサイトを指された時に Vercel 関数の
 * メモリを食い潰されないよう、chunked 読み取りで上限到達時に abort する。
 */
const MAX_HTML_BYTES = 1_000_000; // 1MB
/** 内部 redirect 再評価の最大段数 (redirect: "manual" + 手動 1 段)。 */
const MAX_REDIRECT_HOPS = 3;

/**
 * `res.body` を chunked に読み込み、`maxBytes` を超えたら abort して
 * `null` を返す。完走時は UTF-8 デコード済の文字列を返す。
 * 外部 HTML 取得経路 (google-photos など) で body サイズ上限を共有するため
 * export している。
 */
export async function readBodyWithLimit(
  res: Response,
  maxBytes: number,
): Promise<string | null> {
  const reader = res.body?.getReader();
  if (!reader) {
    const text = await res.text();
    return text.length > maxBytes ? null : text;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      try {
        await reader.cancel();
      } catch {
        // ignore
      }
      return null;
    }
    chunks.push(value);
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    combined.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder("utf-8").decode(combined);
}

/**
 * `redirect: "manual"` で初手 fetch → 3xx なら `Location` を再度
 * `isPublicHttpUrl` で検証して手動で 1 段 follow する。最大 hop 数で
 * リダイレクトループから守る。
 */
export async function fetchWithSafeRedirect(
  url: string,
  init: RequestInit,
  maxHops = MAX_REDIRECT_HOPS,
): Promise<Response | null> {
  let current = url;
  for (let hop = 0; hop < maxHops; hop++) {
    const res = await fetch(current, {
      ...init,
      redirect: "manual",
      cache: "no-store",
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return res;
      let next: string;
      try {
        next = new URL(loc, current).toString();
      } catch {
        return null;
      }
      if (!isPublicHttpUrl(next)) return null;
      current = next;
      continue;
    }
    return res;
  }
  return null;
}

/**
 * Server-side ページメタ取得器。タイトルと og:image を 1 度の fetch で
 * まとめて取得する (Phase 14, 2026-05-13)。
 *
 * Strategy:
 *   1. YouTube → oEmbed で title + thumbnail_url
 *   2. その他 → 1 度の HTML 取得から og:title / `<title>` と og:image を抽出
 *
 * いずれも失敗時は対応フィールドを null。
 *
 * 2.x (2026-06-09) SSRF 強化:
 *   - 入口で `isPublicHttpUrl` を呼び、内部 / loopback / link-local IP を遮断
 *   - `redirect: "manual"` + 手動 follow + 各 hop で `isPublicHttpUrl` 再判定
 *   - body は chunked 読み取りで 1MB 上限 (HTML 取得側のみ。oEmbed は JSON で
 *     応答が小さいので従来どおり)
 */
export async function fetchPageMeta(url: string): Promise<PageMeta> {
  const empty: PageMeta = { title: null, imageUrl: null };
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return empty;
  }
  if (!isPublicHttpUrl(parsed.toString())) {
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
        cache: "no-store",
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
    const res = await fetchWithSafeRedirect(parsed.toString(), {
      headers: {
        // Generic UA — fork deployments shouldn't all impersonate one URL.
        "User-Agent":
          "Mozilla/5.0 (compatible; RaidRepositoryBot/0.1)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res || !res.ok) return empty;
    // Content-Length が宣言されていれば、body 読み始める前に拒否できる
    // (サーバが偽った場合の備えとして chunked guard も併走)。
    const cl = Number(res.headers.get("content-length") ?? "0");
    if (cl > MAX_HTML_BYTES) return empty;
    const html = await readBodyWithLimit(res, MAX_HTML_BYTES);
    if (html === null) return empty;

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
