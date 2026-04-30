/**
 * URL safety helpers.
 *
 * Used at both write-time (createCategoryLink / updateCategoryLink server
 * actions) and render-time (`<a href={safeHref(...)}>`) as defense in
 * depth against `javascript:`, `data:`, `file:`, etc. schemes that React
 * will happily forward to the DOM.
 *
 * Single-tenant trust model: only group members can write rows, but the
 * Supabase anon key is exposed in the browser bundle, so a malicious
 * actor who finds the URL could bypass the form-level validators in
 * `link-form-dialog.tsx` and post directly. Belt + suspenders.
 */

const SAFE_SCHEMES = ["http:", "https:"] as const;

/**
 * Returns true if `raw` is a parseable absolute URL using http(s).
 * Trims whitespace; rejects empty strings, relative URLs, and any
 * non-http(s) scheme (`javascript:`, `data:`, `file:`, `mailto:` etc).
 */
export function isSafeUrl(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const trimmed = raw.trim();
  if (!trimmed) return false;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }
  return (SAFE_SCHEMES as readonly string[]).includes(parsed.protocol);
}

/**
 * Render-time guard. Returns the URL as-is if safe, or `undefined` if
 * unsafe — `<a href={undefined}>` becomes a non-link, which is the
 * desired safe fallback (better than rendering a clickable XSS payload).
 */
export function safeHref(
  raw: string | null | undefined,
): string | undefined {
  return isSafeUrl(raw) ? (raw as string).trim() : undefined;
}

/**
 * `next/Image` の Vercel Image Optimization が利用可能なホストか判定。
 * `next.config.ts#images.remotePatterns` で宣言したホストのみ最適化対象。
 * それ以外 (imgur 等のユーザー直入力) は `unoptimized` で素通しに切替。
 */
export function isOptimizableImageHost(
  raw: string | null | undefined,
): boolean {
  if (!raw) return false;
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return false;
  }
  return (
    parsed.hostname === "i.ytimg.com" || parsed.hostname.endsWith(".supabase.co")
  );
}

/**
 * Write-time validator. Throws a user-facing error message if the URL
 * is invalid, so callers can `catch` and surface the message in toast /
 * inline error UI.
 */
export function assertSafeUrl(
  raw: string | null | undefined,
  fieldLabel = "URL",
): string {
  if (!raw || !raw.trim()) {
    throw new Error(`${fieldLabel}が空です`);
  }
  if (!isSafeUrl(raw)) {
    throw new Error(
      `${fieldLabel}は http:// または https:// で始まる正しい URL である必要があります`,
    );
  }
  return raw.trim();
}
