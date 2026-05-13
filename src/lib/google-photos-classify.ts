/**
 * Phase 16 (2026-05-13): Google フォト URL の classify。
 *
 * server-only でない (= client / server 両用) ロジックだけをこの
 * モジュールに切り出してある。scrape (HTML fetch) を伴う実装は
 * `src/lib/server/google-photos.ts` 側に残している。
 *
 * client 側はこのファイルを直接 import することで、入力 URL が
 * Google フォトの共有 / 直リンク / それ以外 のどれに該当するかを
 * 同じ規則で判定できる (ダイアログ内で送信前に「これは Google フォト
 * 経路だな」とわかる)。
 */

export type GphotoInputKind =
  | { kind: "share"; canonical: string }
  | { kind: "direct"; canonical: string }
  | { kind: "invalid" };

export function classifyGphotoInput(raw: string): GphotoInputKind {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return { kind: "invalid" };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { kind: "invalid" };
  }
  const host = parsed.hostname.toLowerCase();
  // 短縮 (Firebase Dynamic Links 経由)。
  if (host === "photos.app.goo.gl") {
    return { kind: "share", canonical: parsed.toString() };
  }
  // 共有ページ。`/share/<token>` 以外 (例: /photo/...) も HTML 内に lh3
  // 直リンクを含む場合があるため一旦 share として fetch を試みる。
  if (host === "photos.google.com") {
    return { kind: "share", canonical: parsed.toString() };
  }
  // 画像直リンク。lh3〜lh6 の googleusercontent サブドメインを許可。
  if (/^lh[3-6]\.googleusercontent\.com$/i.test(host)) {
    return { kind: "direct", canonical: parsed.toString() };
  }
  return { kind: "invalid" };
}

/**
 * Google フォト系の URL かどうか (share / direct のいずれか) を boolean
 * で返す薄ラッパ。dialog の submit 経路分岐などで kind 詳細が要らない
 * ときに使う。
 */
export function isGooglePhotosUrl(raw: string): boolean {
  return classifyGphotoInput(raw).kind !== "invalid";
}
