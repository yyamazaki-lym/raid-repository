"use client";

/**
 * 2.1 (2026-04-30) TODO #11 補強: hover 時に `<link rel="prefetch">` を head
 * に注入してブラウザキャッシュに HTML/RSC を先読みさせる。`<a href>` の
 * hard navigation の「初回クリック時の引っ掛かり」を緩和。
 *
 * 設計:
 * - `<Link prefetch>` ではなく素の `<a>` のままにする (soft-nav の silent
 *   fail を避けるため; Hobby plan = Skew Protection 不可、TODO #11 補強の
 *   `170beca` / `fab1d59` 参照)
 * - 1 URL は 1 セッション 1 度だけ prefetch (Set で de-dupe)
 * - SSR を考慮して `typeof document` ガード
 * - prefetch は副作用無しの軽量 hint なので失敗しても無視
 */

const prefetched = new Set<string>();

export function prefetchUrl(url: string | undefined): void {
  if (!url) return;
  if (typeof document === "undefined") return;
  if (prefetched.has(url)) return;
  prefetched.add(url);
  try {
    const link = document.createElement("link");
    link.rel = "prefetch";
    link.href = url;
    // `as="document"` ヒントで browser キャッシュ層が HTML として扱う。
    link.as = "document";
    document.head.appendChild(link);
  } catch {
    // DOM が無い / CSP で blocked 等 — 失敗しても navigation 自体は動くので
    // 黙って諦める。
  }
}

/**
 * `<a onMouseEnter={...} onFocus={...}>` で同じ URL を 1 度だけ先読みする
 * ためのハンドラを返す。`useCallback` でラップして再レンダーを抑える。
 */
export function makePrefetchHandler(
  url: string | undefined,
): () => void {
  return () => prefetchUrl(url);
}
