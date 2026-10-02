import "server-only";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { dbError } from "@/lib/server/db-error";
import { parseIsoDuration } from "@/lib/server/youtube-duration";
import { isPastDeadline } from "@/lib/discord-import-budget";
import { LINK_TITLE_MAX, clampText } from "@/lib/text-limits";
import {
  YOUTUBE_PLAYLIST_MAX,
  canonicalVideoUrl,
  parsePlaylistId,
  selectNewCandidates,
  toPlaylistCandidates,
  type PlaylistApiItem,
} from "@/lib/youtube-playlist";

/**
 * YouTube の再生リストから動画を取り込む (2026-10-02 実機要望)。
 *
 * 限定公開の動画はチャンネルの一覧に出ないが、再生リストには載る
 * (`src/lib/youtube-playlist.ts` の冒頭)。コンテンツごとに登録された
 * 再生リスト (`categories.youtube_playlist_ids`) を YouTube Data API で読み、
 * まだ入っていない動画を `category_links` (kind = video、source = youtube)
 * に入れる。
 *
 * 呼び出し元は 2 つ (Discord 取り込みと同じ):
 *   - 毎晩の cron (`/api/cron/import-discord`、Discord 取り込みと並べて実行)
 *   - 設定の「YouTube 再生リストから取り込む」(`importYoutubePlaylistsNow`)
 *
 * 入れた動画の日付・Logs への結びつけは既存の経路がそのまま使う
 * (タイトルの日付を優先 → 無ければ `posted_at` = 動画の公開日時)。
 * 録画開始の時刻をタイトルにする運用 (「2025 05 27 22 00 57」) では
 * タイトルから日付が取れる (2026-10-02 に実データで確認)。
 *
 * API の割り当て: `playlistItems.list` / `videos.list` とも 1 回 1 単位
 * (公式ドキュメント)。1 日 10,000 単位の無料枠に対して、再生リスト 1 本
 * あたり数単位で済む。
 */

const API_BASE = "https://www.googleapis.com/youtube/v3";
/** 1 再生リストで読むページの上限 (50 本 × 20 = 1000 本)。 */
const MAX_PAGES = 20;
const REQUEST_TIMEOUT_MS = 10_000;
/** 締切を渡されなかったとき (手動の「今すぐ取り込む」) の持ち時間。 */
const DEFAULT_BUDGET_MS = 120_000;

export type PlaylistImportResult = {
  /** コンテンツの slug。 */
  category: string;
  playlistId: string;
  ok: boolean;
  /** 再生リストにあった取り込める動画の数 (非公開・削除済みを除く)。 */
  found?: number;
  /** 既に入っていた (動画 ID が一致した) 数。 */
  duplicates?: number;
  /** 取り込み除外リストに入っていて入れなかった数。 */
  blocked?: number;
  inserted?: number;
  failed?: number;
  /** ページの上限で最後まで読めなかった (1000 本を超える再生リスト)。 */
  truncated?: boolean;
  /** 持ち時間を使い切ったため、この再生リストは次回へ回した。 */
  skipped?: "deadline";
  reason?: string;
};

/** cron の Logs 同期の連動 (`logs-auto-sync.ts`) が数える「入った動画」の数。 */
export function countPlaylistInsertedVideos(
  results: ReadonlyArray<PlaylistImportResult>,
): number {
  let n = 0;
  for (const r of results) if (r.ok) n += r.inserted ?? 0;
  return n;
}

type Target = { id: string; slug: string; playlistIds: string[] };
type Db = ReturnType<typeof createSupabaseServiceRoleClient>;

export async function runYoutubePlaylistImport(opts?: {
  /** 取り込みの締切 (epoch ms)。cron route は Discord 取り込みと同じ値を渡す。 */
  deadlineAt?: number;
}): Promise<{ ok: boolean; reason?: string; results: PlaylistImportResult[] }> {
  const deadlineAt = opts?.deadlineAt ?? Date.now() + DEFAULT_BUDGET_MS;
  const db = createSupabaseServiceRoleClient();
  const { data: rows, error } = await db
    .from("categories")
    .select("id, slug, youtube_playlist_ids")
    .not("youtube_playlist_ids", "is", null);
  if (error) {
    return { ok: false, reason: dbError("カテゴリ取得", error), results: [] };
  }
  const targets: Target[] = [];
  for (const r of (rows ?? []) as Array<{
    id: string;
    slug: string;
    youtube_playlist_ids: string[] | null;
  }>) {
    // 保存側でも検査しているが、DB を直接書き換えた値で API のクエリを
    // 組まないよう、ここでもう一度形を確かめる。
    const ids = (r.youtube_playlist_ids ?? [])
      .map((v) => parsePlaylistId(v))
      .filter((v): v is string => v !== null)
      .slice(0, YOUTUBE_PLAYLIST_MAX);
    if (ids.length > 0) targets.push({ id: r.id, slug: r.slug, playlistIds: ids });
  }
  if (targets.length === 0) return { ok: true, results: [] };

  const apiKey = process.env.YOUTUBE_API_KEY?.trim();
  if (!apiKey) {
    return { ok: false, reason: "YOUTUBE_API_KEY not configured", results: [] };
  }

  // 件数が小さい (コンテンツ数 × 再生リスト数) ので順に処理する。同じ動画が
  // 同じコンテンツの 2 本の再生リストに入っていても、2 本目の照合では
  // 1 本目で入れた行が既存として見える。
  const results: PlaylistImportResult[] = [];
  for (const t of targets) {
    for (const playlistId of t.playlistIds) {
      results.push(await importPlaylist(db, t, playlistId, apiKey, deadlineAt));
    }
  }
  return { ok: true, results };
}

async function importPlaylist(
  db: Db,
  cat: Target,
  playlistId: string,
  apiKey: string,
  deadlineAt: number,
): Promise<PlaylistImportResult> {
  const base = { category: cat.slug, playlistId };
  if (isPastDeadline(deadlineAt, Date.now())) {
    return { ...base, ok: true, skipped: "deadline" };
  }

  // 1. 再生リストを読む。
  const items: PlaylistApiItem[] = [];
  let pageToken: string | undefined;
  let pages = 0;
  do {
    if (isPastDeadline(deadlineAt, Date.now())) break;
    const params = new URLSearchParams({
      part: "snippet,contentDetails,status",
      maxResults: "50",
      playlistId,
      key: apiKey,
    });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await youtubeGet<{
      items?: PlaylistApiItem[];
      nextPageToken?: string;
    }>(`playlistItems?${params.toString()}`);
    if (!res.ok) {
      // 1 ページ目で失敗 = 再生リストが見つからない / キーが無効 / 割り当て
      // 切れ。途中のページで失敗したら、読めた分も入れずに次回やり直す
      // (途中までで入れると、残りが「無い」ように見える)。
      return { ...base, ok: false, reason: res.reason };
    }
    items.push(...(res.data.items ?? []));
    pageToken = res.data.nextPageToken;
    pages += 1;
  } while (pageToken && pages < MAX_PAGES);
  if (pages === 0) return { ...base, ok: true, skipped: "deadline" };
  const truncated = Boolean(pageToken);

  // 2. 取り込める動画を選び、既に入っているもの・除外リストのものを外す。
  const candidates = toPlaylistCandidates(items);
  const [existingRes, blockedRes] = await Promise.all([
    db
      .from("category_links")
      .select("url")
      .eq("category_id", cat.id)
      .eq("kind", "video"),
    db
      .from("category_discord_blocklist")
      .select("url")
      .eq("category_id", cat.id),
  ]);
  if (existingRes.error) {
    return { ...base, ok: false, reason: dbError("既存の動画の取得", existingRes.error) };
  }
  if (blockedRes.error) {
    return { ...base, ok: false, reason: dbError("取り込み除外の取得", blockedRes.error) };
  }
  const { fresh, duplicates, blocked } = selectNewCandidates(
    candidates,
    (existingRes.data ?? []).map((r) => r.url as string),
    (blockedRes.data ?? []).map((r) => r.url as string),
  );
  const summary = { found: candidates.length, duplicates, blocked, truncated };
  if (fresh.length === 0) {
    return { ...base, ok: true, ...summary, inserted: 0, failed: 0 };
  }

  // 3. 長さ。取れなくても取り込みは続ける (設定の「動画メタデータ取得」で
  //    後から埋められる)。
  const durations = await fetchDurations(
    fresh.map((c) => c.videoId),
    apiKey,
  );

  // 4. 並び順。公開日時の古い順に番号を振る (Discord 取り込みが古い投稿から
  //    入れるのと揃える)。
  const { data: nextOrderData } = await db.rpc("next_category_link_sort_order", {
    p_category_id: cat.id,
    p_kind: "video",
  });
  const startSortOrder = typeof nextOrderData === "number" ? nextOrderData : 0;
  const rowsToInsert = [...fresh]
    .sort((a, b) => a.publishedAt.localeCompare(b.publishedAt))
    .map((c, i) => ({
      category_id: cat.id,
      kind: "video" as const,
      title: clampText(c.title, LINK_TITLE_MAX),
      url: canonicalVideoUrl(c.videoId),
      description: `YouTube 再生リストから取り込み (${playlistId})`,
      sort_order: startSortOrder + i,
      source: "youtube" as const,
      duration_seconds: durations.get(c.videoId) ?? null,
      posted_at: c.publishedAt,
    }));

  // 5. 保存。Discord 取り込みと同じく、UNIQUE (category_id, kind, url) の
  //    競合は skip し、まとめての保存が失敗したら 1 行ずつ入れ直す。
  let inserted = 0;
  let failed = 0;
  let lastFailReason: string | undefined;
  const { data: insertedRows, error: bulkErr } = await db
    .from("category_links")
    .upsert(rowsToInsert, {
      onConflict: "category_id,kind,url",
      ignoreDuplicates: true,
    })
    .select("id");
  if (bulkErr) {
    console.warn(
      "[youtube-playlist-import] bulk upsert failed, retrying per-row",
      cat.slug,
      bulkErr.message,
    );
    for (const row of rowsToInsert) {
      const { data: rowData, error: rowErr } = await db
        .from("category_links")
        .upsert(row, { onConflict: "category_id,kind,url", ignoreDuplicates: true })
        .select("id");
      if (rowErr) {
        failed += 1;
        lastFailReason = rowErr.message;
      } else if (rowData && rowData.length > 0) {
        inserted += 1;
      }
    }
  } else {
    inserted = insertedRows?.length ?? 0;
  }
  return {
    ...base,
    ok: true,
    ...summary,
    inserted,
    failed,
    ...(lastFailReason ? { reason: lastFailReason } : {}),
  };
}

/** `videos.list` は 50 本ずつ 1 単位。取れなかった動画は Map に載らない。 */
async function fetchDurations(
  videoIds: string[],
  apiKey: string,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (let i = 0; i < videoIds.length; i += 50) {
    const params = new URLSearchParams({
      part: "contentDetails",
      id: videoIds.slice(i, i + 50).join(","),
      maxResults: "50",
      key: apiKey,
    });
    const res = await youtubeGet<{
      items?: Array<{ id?: string; contentDetails?: { duration?: string } }>;
    }>(`videos?${params.toString()}`);
    if (!res.ok) continue;
    for (const it of res.data.items ?? []) {
      const raw = it.contentDetails?.duration;
      const sec = raw ? parseIsoDuration(raw) : null;
      if (it.id && sec !== null) out.set(it.id, sec);
    }
  }
  return out;
}

/**
 * YouTube Data API を GET で呼ぶ。失敗の理由には **キーを含む URL を入れない**
 * (結果は画面と cron の応答に出る)。API のエラー本文からは理由の識別子
 * (`playlistNotFound` / `quotaExceeded` / `keyInvalid` など) だけを取る。
 */
async function youtubeGet<T>(
  pathAndQuery: string,
): Promise<{ ok: true; data: T } | { ok: false; reason: string }> {
  try {
    const res = await fetch(`${API_BASE}/${pathAndQuery}`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      let detail = "";
      try {
        const body = (await res.json()) as {
          error?: { errors?: Array<{ reason?: string }> };
        };
        detail = body.error?.errors?.[0]?.reason ?? "";
      } catch {
        // 本文が JSON でなければ状態コードだけ返す。
      }
      return {
        ok: false,
        reason: `youtube api ${res.status}${detail ? `: ${detail}` : ""}`,
      };
    }
    return { ok: true, data: (await res.json()) as T };
  } catch (e) {
    // e.message は URL を含み得るので、種類 (TimeoutError 等) だけを返す。
    return {
      ok: false,
      reason: `youtube api error: ${e instanceof Error ? e.name : "fetch failed"}`,
    };
  }
}
