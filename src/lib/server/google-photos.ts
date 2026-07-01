import "server-only";
import { decodeHtmlEntities } from "@/lib/html-entities";
import { isPublicHttpUrl } from "@/lib/url-safe";
import { fetchWithSafeRedirect, readBodyWithLimit } from "./page-title";

// アルバムページの body 読み取り上限。写真数の多い共有アルバムは埋め込み
// JSON が数 MB になりうるので page-title の 1MB より緩めに取るが、巨大
// レスポンスによる Vercel 関数の OOM / 課金増を防ぐため上限は設ける。
const MAX_GPHOTO_HTML_BYTES = 10_000_000; // 10MB

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

  // SSRF defense-in-depth: 入口と各 redirect hop で公開 http(s) ホストを強制。
  // 短縮 URL (photos.app.goo.gl) の展開も GET の manual follow で行い、内部 IP /
  // loopback へ誘導するリダイレクトを遮断する (admin 操作だが多層防御)。Firebase
  // Dynamic Links は多段 redirect しうるので hop 上限は 5 まで許容。
  if (!isPublicHttpUrl(parsed.toString())) {
    throw new Error("URL が不正です");
  }

  const res = await fetchWithSafeRedirect(
    parsed.toString(),
    {
      method: "GET",
      signal: AbortSignal.timeout(10000),
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; RaidRepositoryBot/0.1)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9",
      },
    },
    5,
  );
  if (!res || !res.ok) {
    throw new Error(
      `アルバムを取得できませんでした (HTTP ${res?.status ?? "?"})`,
    );
  }
  // body サイズ上限。Content-Length が宣言されていれば読み始める前に拒否し、
  // 未宣言でも chunked 読み取りで上限到達時に abort する (page-title と同方式)。
  const declaredLen = Number(res.headers.get("content-length") ?? "0");
  if (declaredLen > MAX_GPHOTO_HTML_BYTES) {
    throw new Error("アルバムページが大きすぎます");
  }
  const html = await readBodyWithLimit(res, MAX_GPHOTO_HTML_BYTES);
  if (html === null) {
    throw new Error("アルバムページが大きすぎます");
  }

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
