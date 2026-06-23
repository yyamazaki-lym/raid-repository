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
 * Server-side fetch ガード用に、URL が「公開インターネット上の http(s)
 * ホスト」かどうかを判定する (2.x, 2026-06-09 TODO #SSRF)。
 *
 * 弾く対象:
 *   - http(s) 以外のスキーマ (isSafeUrl と同じ)
 *   - IPv4 リテラル: loopback (127.x), link-local (169.254.x, AWS IMDS),
 *     private (10.x / 172.16-31.x / 192.168.x), CGNAT (100.64-127.x),
 *     "this network" (0.x), multicast (224-239.x), broadcast (255.255.255.255),
 *     reserved 240-255.x
 *   - IPv6 リテラル: loopback (::1), unique-local (fc..,fd..),
 *     link-local (fe80::/10), unspecified (::), IPv4-mapped 形式の private 範囲
 *   - ホスト名: localhost / *.local / *.internal / *.localhost
 *
 * `/api/page-title` のように「ユーザー入力 URL を server から fetch する」
 * 経路で使う。Vercel Fluid Compute は egress NAT で内部 IP に届かないこと
 * が多いが、誤って同 region の内部サービスに到達できれば情報漏洩経路に
 * なるため defense-in-depth として明示的に弾く。
 */
export function isPublicHttpUrl(raw: string | null | undefined): boolean {
  if (!isSafeUrl(raw)) return false;
  let parsed: URL;
  try {
    parsed = new URL((raw as string).trim());
  } catch {
    return false;
  }
  // URL.hostname は IPv6 リテラルだと `[::1]` のように角括弧付きで
  // 返るため、ここで剥がしておく (Node.js / WHATWG URL 仕様)。
  // lowercase 化して以降の比較を簡単に。
  let host = parsed.hostname.toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) {
    host = host.slice(1, -1);
  }
  // 末尾ドット付き FQDN (例 `localhost.`) は WHATWG URL が正規化しない
  // (実測: new URL("http://localhost./").hostname === "localhost.")。
  // 剥がさないと下のホスト名ブロック (=== "localhost" / .endsWith(".local")
  // 等) を素通りして loopback / 内部 zone へ到達できてしまう。IPv4-mapped
  // IPv6 迂回 (#242) と同種の正規化漏れなので、ここで正規化する。なお IPv4
  // リテラルの末尾ドット (`127.0.0.1.`) は URL 側が既に剥がすため影響しない。
  host = host.replace(/\.+$/, "");
  if (!host) return false;

  // ホスト名ベースのブロック (loopback / 内部 zone)。
  if (host === "localhost") return false;
  if (host.endsWith(".localhost")) return false;
  if (host.endsWith(".local")) return false;
  if (host.endsWith(".internal")) return false;

  // IPv4 リテラル判定。4 octet 全部 10 進数の場合のみ IPv4 扱い。
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const octets = [v4[1], v4[2], v4[3], v4[4]].map((s) => Number(s));
    if (octets.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return false;
    const [a, b] = octets as [number, number, number, number];
    if (a === 0) return false; // "this network"
    if (a === 10) return false; // private
    if (a === 127) return false; // loopback
    if (a === 169 && b === 254) return false; // link-local (AWS IMDS 169.254.169.254 含む)
    if (a === 172 && b >= 16 && b <= 31) return false; // private
    if (a === 192 && b === 168) return false; // private
    if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
    if (a >= 224) return false; // multicast (224-239) + reserved (240-254) + broadcast (255)
    return true;
  }

  // IPv6 リテラル判定 (簡易): `:` を含む host。
  if (host.includes(":")) {
    if (host === "::" || host === "::1") return false; // unspecified / loopback
    // link-local fe80::/10 — 先頭 hextet は fe80〜febf。`startsWith("fe80:")` だと
    // fe9x/feax/febx を取りこぼすため範囲全体を覆う正規表現にする。
    if (/^fe[89ab][0-9a-f]?:/.test(host)) return false;
    if (/^f[cd][0-9a-f]{0,2}:/.test(host)) return false; // unique-local fc00::/7
    // IPv4-mapped / IPv4-compatible (`::ffff:127.0.0.1` 等) は `::` で始まる。
    // ⚠ WHATWG URL は埋め込み IPv4 を 16 進 hextet に正規化する
    // (例: `::ffff:127.0.0.1` → `::ffff:7f00:1`、`::ffff:169.254.169.254` → `::ffff:a9fe:a9fe`)
    // ため、10 進ドット形だけを見る判定では loopback / private / link-local / IMDS を
    // 取りこぼし公開扱いしてしまう。公開ホストへの到達に埋め込み IPv4 形式は不要なので、
    // `::` 始まり (10 進/16 進いずれの表記でも) は一律ブロックして内部 IP 露出を防ぐ。
    if (host.startsWith("::")) return false;
    // それ以外の IPv6 (グローバル unicast 2000::/3 等) は公開アドレス扱い。
    return true;
  }

  // ホスト名: ドットを 1 つ以上含み、解決時に内部 IP を引かない前提
  // (DNS rebinding 対策は本ヘルパでは扱わない — ホスト名ベースの自明な
  // 内部 zone のみ弾く)。
  // 2026-06-11 セキュリティ監査: DNS rebinding は Vercel egress NAT で実害が
  // 低く、pinned-IP fetch の実装コストが高いため現状維持と判断 (受容リスク)。
  return true;
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
