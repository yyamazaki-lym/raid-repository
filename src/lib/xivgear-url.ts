/**
 * XivGear (装備シミュレータ) の URL ヘルパー (2026-08-30、調査 第3回 #3)。
 *
 * XivGear は共有セットに対して **埋め込み専用ビュー** を公式に用意している:
 *   通常:   https://xivgear.app/?page=sl|<uuid>
 *   埋め込み: https://xivgear.app/?page=embed|sl|<uuid>
 * 埋め込み版はヘッダ等を省いたコンパクト UI なので、portal 側は
 * 「登録済みの BiS URL から uuid を抜いて embed URL を組み立てる」だけで
 * 装備表を その場で 確認できる。シミュレータ自体は作らない (調査ノート §4)。
 *
 * 外部依存なしの純関数。CSP の frame-src に `https://xivgear.app` が
 * 要る (src/lib/csp.ts)。
 */

/** 8-4-4-4-12 の UUID。XivGear の共有セット ID の形。 */
const UUID_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * XivGear の URL から共有セットの uuid を取り出す。
 * `?page=sl|<uuid>` / `?page=embed|sl|<uuid>` / パスや hash に uuid を
 * 含む形のいずれにも耐えるよう、ホストを検証したうえで URL 全体から
 * uuid パターンを拾う。XivGear 以外のホストや uuid 無しは null。
 */
export function parseXivgearSetUuid(
  raw: string | null | undefined,
): string | null {
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.toLowerCase();
  if (host !== "xivgear.app" && !host.endsWith(".xivgear.app")) return null;
  const m = UUID_RE.exec(decodeURIComponent(u.search + u.hash + u.pathname));
  return m ? m[0].toLowerCase() : null;
}

/**
 * uuid から埋め込みビューの URL を組み立てる。`|` は URL 的には安全だが
 * 一部環境でエンコードされるため、XivGear が受け付ける生の `|` のまま返す
 * (公式ドキュメントの例と同形)。
 */
export function buildXivgearEmbedUrl(uuid: string): string {
  return `https://xivgear.app/?page=embed|sl|${uuid}`;
}

/** BiS URL から直接 embed URL を作る (XivGear 以外は null)。 */
export function toXivgearEmbedUrl(
  raw: string | null | undefined,
): string | null {
  const uuid = parseXivgearSetUuid(raw);
  return uuid ? buildXivgearEmbedUrl(uuid) : null;
}
