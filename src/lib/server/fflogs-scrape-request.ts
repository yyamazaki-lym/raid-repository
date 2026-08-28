/**
 * FFLogs HTML scrape リクエストの共有部品。
 *
 * 2.9 (2026-06-11): `fflogs.ts` (直接 fetch — ローカル dev / fallback 用)
 * と `/api/fflogs/scrape-proxy` (Edge route — Vercel 上の本経路) の両方から
 * 使うため、Node API 依存のない純粋モジュールとして切り出した。
 * URL 構築・偽装ヘッダー・タイムアウトをここで一元管理し、経路によって
 * リクエストの見た目が変わらないようにする。
 */

export const FFLOGS_SCRAPE_TIMEOUT_MS = 20_000;

/** reports-list のページ巡回上限。scrape-proxy 側の page validation と
 * `fflogs.ts` のループ上限の両方がこの値を参照する。 */
export const FFLOGS_SCRAPE_MAX_PAGES = 25;

export function buildFflogsReportsListUrl(
  userId: number,
  page: number,
): string {
  return `https://www.fflogs.com/user/reports-list/${userId}?page=${page}`;
}

/**
 * 2.1 (2026-04-29): UA を実 Chrome 風に変更。旧 UA は
 * `Mozilla/5.0 (compatible; RaidRepository/1.0; ...)` で、
 * Cloudflare/FFLogs の bot 判定に弾かれて 403 を返していた
 * (Vercel IP からの署名でも、UA が真っ当に見えれば通ること
 * が多い)。Sec-Fetch-* / Referer 等の "browser-like" ヘッダー
 * を一通り付けて、自然なナビゲーション風のリクエストに偽装。
 */
// 2026-08-28: 本番実測で「edge 経由でも 403」が確認された (2026-06 の実測
// では通っていた)。Cloudflare の bot 判定は UA の鮮度も見るため、2 年前の
// Chrome 124 を名乗る UA を現行版に更新する。TLS フィンガープリントで
// 弾かれている場合はヘッダー更新では通らない — その場合の確実な対処は
// レポートの Public 化のみ (診断パネル / 失敗文言でも案内)。
const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const CHROME_SEC_CH_UA =
  '"Chromium";v="140", "Google Chrome";v="140", "Not-A.Brand";v="99"';

export function buildFflogsScrapeHeaders(
  sessionCookie?: string | null,
): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": CHROME_UA,
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7",
    "Accept-Encoding": "gzip, deflate, br",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    Referer: "https://www.fflogs.com/",
    "Sec-Ch-Ua": CHROME_SEC_CH_UA,
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Windows"',
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
  };
  if (sessionCookie && sessionCookie.trim()) {
    headers.Cookie = sessionCookie.trim();
  }
  return headers;
}

/**
 * fights-and-participants (JSON XHR) 用ヘッダー (2026-08-28)。
 *
 * このエンドポイントを実ブラウザが取りに行くのは「レポートページ内の
 * XHR」としてであり、`Sec-Fetch-Dest: document` で直接ナビゲートする
 * 挙動はブラウザに存在しない。document 風ヘッダーで JSON を要求する
 * 組み合わせ自体が bot シグナルになるため、XHR として自然な形にする。
 */
export function buildFflogsXhrHeaders(
  reportCode: string,
  sessionCookie?: string | null,
): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": CHROME_UA,
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7",
    "Accept-Encoding": "gzip, deflate, br",
    Referer: `https://www.fflogs.com/reports/${reportCode}`,
    "Sec-Ch-Ua": CHROME_SEC_CH_UA,
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Windows"',
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    "X-Requested-With": "XMLHttpRequest",
  };
  if (sessionCookie && sessionCookie.trim()) {
    headers.Cookie = sessionCookie.trim();
  }
  return headers;
}
