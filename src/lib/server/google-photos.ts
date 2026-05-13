import "server-only";
import { decodeHtmlEntities } from "@/lib/html-entities";

/**
 * Phase 16 (2026-05-13): Google フォト共有アルバム / 直リンクの解析。
 *
 * Google フォトは公開アルバムを操作する公式 API を提供していないため、
 * 共有 HTML 内に埋め込まれている `lh3.googleusercontent.com` URL を
 * 正規表現で抽出する非公式手法を採る。Google が HTML 構造を変更すると
 * 壊れるが、壊れたタイミングで regex を直す方針。
 *
 * 対応する入力:
 *   - 短縮共有: `https://photos.app.goo.gl/<id>` → HEAD で展開
 *   - 共有 URL: `https://photos.google.com/share/<token>` → そのまま fetch
 *   - 直リンク: `https://lh3.googleusercontent.com/...` → アルバム扱いせず
 *     呼び出し側で単独 INSERT する想定 (classify のみ提供)
 *
 * `classifyGphotoInput` は client 側でも使えるよう
 * `src/lib/google-photos-classify.ts` に切り出し、ここでは re-export だけ。
 */

export {
  classifyGphotoInput,
  type GphotoInputKind,
} from "@/lib/google-photos-classify";

export type GphotoAlbum = {
  /** og:title もしくは <title> から抽出した album タイトル。失敗時 null。 */
  title: string | null;
  /** 重複排除済み (サイズ suffix 統合済み) の画像 URL 配列。表示用に `=s2048` 付与。 */
  imageUrls: string[];
};

const LH_URL_RE = /https:\/\/lh[3-6]\.googleusercontent\.com\/[^"'\\<>\s]+/g;

// プロフィールアバター / アカウントアイコンを除外するパス判定。
//   - `/a/<token>` … 通常のアカウントアバター
//   - `/a-/<token>` … 別系統のアバター
// アルバム写真は `/pw/<token>` あるいは長い base64-ish path で来るため、
// `/a/` `/a-/` を確実なアイコン目印として弾く。
const AVATAR_PATH_RE = /^https:\/\/lh[3-6]\.googleusercontent\.com\/a[-/]/i;

/**
 * 共有アルバム URL から画像 URL 配列を抽出する。
 *
 * 戻り値 `imageUrls.length === 0` の場合、呼び出し側で「画像が見つかりません」
 * エラーを返す責務。throw は通信失敗 (timeout / network) と非 200 のみ。
 */
export async function fetchGooglePhotosAlbum(
  shareUrl: string,
): Promise<GphotoAlbum> {
  let parsed: URL;
  try {
    parsed = new URL(shareUrl);
  } catch {
    throw new Error("URL が不正です");
  }

  // 短縮 URL は HEAD redirect follow で展開し、最終 URL を canonical 化する。
  let canonical = parsed.toString();
  if (parsed.hostname.toLowerCase() === "photos.app.goo.gl") {
    try {
      const head = await fetch(canonical, {
        method: "HEAD",
        redirect: "follow",
        signal: AbortSignal.timeout(8000),
        headers: { "User-Agent": "Mozilla/5.0 (compatible; RaidRepositoryBot/0.1)" },
      });
      // HEAD を許可しないサーバでは fall back で GET。
      if (!head.ok && head.status !== 405) {
        // 5xx / 404 などは そのまま エラー扱い (後段 fetch でも失敗するので)
        canonical = head.url || canonical;
      } else {
        canonical = head.url || canonical;
      }
    } catch {
      // HEAD 失敗時は GET で展開を試みる (Firebase Dynamic Links は HEAD 拒否がある)
    }
  }

  const res = await fetch(canonical, {
    method: "GET",
    redirect: "follow",
    signal: AbortSignal.timeout(10000),
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; RaidRepositoryBot/0.1)",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9",
    },
  });
  if (!res.ok) {
    throw new Error(`アルバムを取得できませんでした (HTTP ${res.status})`);
  }
  const html = await res.text();

  // タイトル抽出 (og:title 優先、`<title>` フォールバック)。
  const ogTitleMatch = html.match(
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
  );
  const titleTagMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const rawTitle = (ogTitleMatch?.[1] ?? titleTagMatch?.[1] ?? "").trim();
  // 「<アルバム名> - Google フォト」のようなサフィックスは除去。
  const stripped = rawTitle.replace(/\s*[-–|]\s*Google\s*(?:フォト|Photos)\s*$/u, "").trim();
  const title = stripped ? decodeHtmlEntities(stripped) : null;

  // 画像 URL 抽出。サイズ suffix (`=w512-h384-...`) を剥がして重複排除し、
  // 表示用に `=s2048` を付与する。lh3 の URL は HTML エスケープされていない
  // 平文で 1 つ以上の JSON チャンク内に出現する。アバター系 (`/a/`,`/a-/`)
  // も同じホストで埋め込まれるため、AVATAR_PATH_RE で除外する。
  const raw = Array.from(html.matchAll(LH_URL_RE), (m) => m[0]);
  const seen = new Set<string>();
  const imageUrls: string[] = [];
  for (const u of raw) {
    if (AVATAR_PATH_RE.test(u)) continue;
    // 末尾の =foo (サイズ / 切り出しパラメータ群) を除去。
    const stripSize = u.replace(/=[^/=]+$/u, "");
    if (seen.has(stripSize)) continue;
    seen.add(stripSize);
    imageUrls.push(`${stripSize}=s2048`);
  }

  return { title, imageUrls };
}
