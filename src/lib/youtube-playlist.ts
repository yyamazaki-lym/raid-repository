/**
 * YouTube の再生リストからの動画取り込み (2026-10-02 実機要望) の純関数。
 *
 * ## なぜ再生リストなのか
 *
 * 限定公開の動画は、チャンネルの動画一覧・検索・登録者のフィードに出ない
 * (YouTube ヘルプの公開設定の表)。API キーでも RSS でも、チャンネルから
 * 見えるのは公開の動画だけになる。一方で「公開の再生リストには表示できる」
 * ので、admin が登録した再生リストを YouTube Data API (`playlistItems.list`、
 * `YOUTUBE_API_KEY`) で読む。2026-10-02 に実際の再生リスト (限定公開 11 本)
 * で、キー無しの再生リストのページに 11 本とも載ることを確かめた。
 *
 * 取り込み本体 (DB・API 呼び出し) は `src/lib/server/youtube-playlist-import.ts`。
 * ここは入力の検査と、API の応答から「入れる動画」を選ぶところだけを持つ
 * (`scripts/check-youtube-playlist.mjs` から tsc で動かすため、`@/` を import
 * しない)。
 */
import { parseYouTubeId } from "./youtube";

/** 1 コンテンツに登録できる再生リストの数 (DB の CHECK と同じ値)。 */
export const YOUTUBE_PLAYLIST_MAX = 10;

/**
 * 再生リスト ID の形。`PL` + 16 / 32 文字が普通だが、アルバム (`OLAK5uy_…`)
 * など長さの違うものもあるので、文字種と長さだけを見る。URL のクエリに
 * そのまま入れるので、この文字種以外は通さない (クエリの注入を防ぐ)。
 */
const PLAYLIST_ID_RE = /^[A-Za-z0-9_-]{12,64}$/;

/**
 * 取り込めない種類の再生リスト。`RD` はミックス (再生のたびに中身が変わり
 * API で一覧できない)、`WL` / `LL` は本人にしか見えない「後で見る」と
 * 「高く評価した動画」。
 */
const UNSUPPORTED_PREFIXES = ["RD", "WL", "LL"];

/**
 * 入力 1 つ (URL か ID) から再生リスト ID を取り出す。取れなければ null。
 *
 * 受け付ける形:
 *   - `https://www.youtube.com/playlist?list=PL…`
 *   - `https://www.youtube.com/watch?v=…&list=PL…` (再生リストを再生中の URL)
 *   - `https://m.youtube.com/playlist?list=…` / `https://youtube.com/…`
 *   - `PL…` (ID だけ)
 */
export function parsePlaylistId(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  let candidate: string | null = raw;
  if (/^https?:\/\//i.test(raw)) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return null;
    }
    const host = url.hostname.toLowerCase().replace(/^(www|m)\./, "");
    if (host !== "youtube.com" && host !== "music.youtube.com") return null;
    candidate = url.searchParams.get("list");
  }
  if (!candidate || !PLAYLIST_ID_RE.test(candidate)) return null;
  if (UNSUPPORTED_PREFIXES.some((p) => candidate!.startsWith(p))) return null;
  return candidate;
}

/**
 * 設定画面の入力 (改行・カンマ・空白区切り) を ID の配列にする。
 * 重複は落とし、取り出せなかった入力は `invalid` に元の文字列のまま返す
 * (画面で「どれが読めなかったか」を出すため)。
 */
export function parsePlaylistInput(raw: string): {
  ids: string[];
  invalid: string[];
} {
  const ids: string[] = [];
  const invalid: string[] = [];
  for (const token of raw.split(/[\s,、，]+/)) {
    const t = token.trim();
    if (!t) continue;
    const id = parsePlaylistId(t);
    if (!id) {
      invalid.push(t);
      continue;
    }
    if (!ids.includes(id)) ids.push(id);
  }
  return { ids, invalid };
}

/** 設定画面で ID を URL の形に戻して見せる。 */
export function playlistUrl(id: string): string {
  return `https://www.youtube.com/playlist?list=${encodeURIComponent(id)}`;
}

/** 取り込んだ動画の URL。照合は動画 ID で行うので、保存する形はこれに揃える。 */
export function canonicalVideoUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

/** `playlistItems.list` (part=snippet,contentDetails,status) の 1 件。 */
export type PlaylistApiItem = {
  snippet?: { title?: string; publishedAt?: string };
  contentDetails?: { videoId?: string; videoPublishedAt?: string };
  status?: { privacyStatus?: string };
};

export type PlaylistCandidate = {
  videoId: string;
  title: string;
  /** 動画の公開日時 (再生リストに足した日時ではない)。 */
  publishedAt: string;
};

/**
 * API の応答から取り込む候補を選ぶ。
 *
 * - 非公開の動画 (`privacyStatus: private`) は入れない。リンクを開いても
 *   メンバーは見られない
 * - 削除された動画・非公開の動画は `contentDetails.videoPublishedAt` が
 *   無い (タイトルも「Deleted video」「Private video」になる)。公開日時が
 *   無いものは、状態に関係なく入れない
 * - 同じ動画が再生リストに 2 回入っていても 1 件にする
 */
export function toPlaylistCandidates(
  items: ReadonlyArray<PlaylistApiItem>,
): PlaylistCandidate[] {
  const out: PlaylistCandidate[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const videoId = item.contentDetails?.videoId;
    const publishedAt = item.contentDetails?.videoPublishedAt;
    if (!videoId || !parseYouTubeId(canonicalVideoUrl(videoId))) continue;
    if (!publishedAt) continue;
    if (item.status?.privacyStatus === "private") continue;
    if (seen.has(videoId)) continue;
    seen.add(videoId);
    out.push({
      videoId,
      title: (item.snippet?.title ?? "").trim() || canonicalVideoUrl(videoId),
      publishedAt,
    });
  }
  return out;
}

/**
 * まだ入っていない候補だけを残す。照合は **動画 ID** で行う — Discord に
 * `https://youtu.be/<id>` で貼られて既に入っている動画を、再生リストから
 * `watch?v=<id>` の形でもう 1 件入れないため (URL の文字列では一致しない)。
 *
 * `blockedUrls` は取り込み除外リスト (`category_discord_blocklist`)。除外は
 * URL で登録されるので、これも動画 ID に直して照合する。
 */
export function selectNewCandidates(
  candidates: ReadonlyArray<PlaylistCandidate>,
  existingUrls: ReadonlyArray<string>,
  blockedUrls: ReadonlyArray<string>,
): { fresh: PlaylistCandidate[]; duplicates: number; blocked: number } {
  const toIds = (urls: ReadonlyArray<string>) => {
    const ids = new Set<string>();
    for (const u of urls) {
      const id = parseYouTubeId(u);
      if (id) ids.add(id);
    }
    return ids;
  };
  const existing = toIds(existingUrls);
  const block = toIds(blockedUrls);
  const fresh: PlaylistCandidate[] = [];
  let duplicates = 0;
  let blocked = 0;
  for (const c of candidates) {
    if (block.has(c.videoId)) {
      blocked += 1;
      continue;
    }
    if (existing.has(c.videoId)) {
      duplicates += 1;
      continue;
    }
    fresh.push(c);
  }
  return { fresh, duplicates, blocked };
}
