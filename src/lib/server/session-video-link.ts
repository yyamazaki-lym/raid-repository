import "server-only";
import { createClient } from "@/lib/supabase/server";
import {
  jstYmdKey,
  resolveVideoJstYmd,
  toJstYmd,
  VIDEO_POSTED_AT_BUFFER_MS,
} from "@/lib/video-jst-date";

/**
 * Match each schedule session to its recording by comparing
 * **video date == session JST calendar date**.
 *
 * Per-video date resolution (highest priority first):
 *   1. `extractDateFromTitle(title)` — タイトル内に書かれた日付
 *      (例: 「【2026/04/01】」「2026 04 01」「4月1日」)。
 *      ユーザーが手で書く raid date なので最も信頼できる。
 *   2. `posted_at` の JST 日付 — YouTube/Discord から取得した
 *      実アップロード/投稿日時。raid 当日 or 翌日朝のことが多く、
 *      タイトルに日付が無い場合のフォールバックとして許容。
 *   3. それ以外は **スキップ** (created_at は単なる DB 行作成時刻で
 *      信頼性が低いため使わない)。
 *
 * Match rule:
 *   - kind = 'video'
 *   - video の解決済み JST Y/M/D == session の JST Y/M/D
 *   - 同日に複数候補があるときは `posted_at asc` で最古優先のソート順を維持
 *   - 1 session に同日複数動画が紐付くケースを許容 (TODO #1)
 *
 * Output is keyed by `session.rawDate` (the original schedule label) →
 * 同日全件の `SessionVideoLink[]` 配列。consumer は `map[rawDate]` で
 * 配列を受け取り、要素数 0 = 紐付なし / 1 = 単数表示 / 2+ = dropdown 化。
 *
 * History: 旧版は `posted_at` ± 36h ウィンドウで紐付けていたが、
 * 古い動画 (例: 2023 年録画) を後から DB に追加すると、追加時刻ベースで
 * 直近セッションに誤紐付けされる事故があり (TODO #22)、日付一致方式に
 * 切替えた。
 */

export type SessionVideoLink = {
  /** Path the schedule page should link to (in-portal videos page). */
  href: string;
  /**
   * The actual external video URL (YouTube / Twitch / niconico / X 等).
   * 過去日程の動画アイコンクリック時に直接外部に飛ばす用途で使用 (Logs
   * アイコンと同じ挙動)。
   */
  url: string;
  /** Category name shown in the tooltip ("ヘビー級 → 動画"). */
  categoryName: string;
  /** Video title for tooltip / accessibility. */
  videoTitle: string;
  /** FFLogs URL associated with the video, if set. */
  logsUrl: string | null;
};

// toJstYmd / 動画の日付解決は video-jst-date.ts へ移設 (2026-07-12)。
// 日付登録 Logs の橋渡し (session-logs-video-bridge.ts) が本ファイルの
// 「同日」判定と完全一致する必要があるため、共有モジュール化した。

type SessionLite = { rawDate: string; date: Date };

export async function buildSessionVideoLinkMap(
  sessions: SessionLite[],
): Promise<Record<string, SessionVideoLink[]>> {
  if (sessions.length === 0) return {};

  // TODO #55: セッション日付範囲 ± 7d で `posted_at` を pre-filter。
  // 旧版は category_links を kind=video で全件取得していたが、portal
  // 運用が長期化すると videos が累積し続けて毎回不要な行を SELECT して
  // しまっていた。動画はセッション日にしか紐付かないので「セッション
  // が無い時期」の動画はそもそも match 不可 → DB 段で落とせる。
  // バッファ ±7d は uploadDate と raid 日が稀にずれる分を吸収する余白。
  // `posted_at IS NULL` は title-only date 解決経路のフォールバックに
  // 使われるので OR で残す (extractDateFromTitle が year を含む完全
  // 日付を拾えれば posted_at 無しでもマッチ可能)。
  const sessionMs = sessions.map((s) => s.date.getTime());
  const minMs = Math.min(...sessionMs);
  const maxMs = Math.max(...sessionMs);
  const minIso = new Date(minMs - VIDEO_POSTED_AT_BUFFER_MS).toISOString();
  const maxIso = new Date(maxMs + VIDEO_POSTED_AT_BUFFER_MS).toISOString();

  const supabase = await createClient();
  type Row = {
    id: string;
    title: string;
    url: string;
    posted_at: string | null;
    logs_url: string | null;
    categories:
      | { slug: string; name: string }
      | { slug: string; name: string }[]
      | null;
  };
  const { data, error } = await supabase
    .from("category_links")
    .select(
      "id, title, url, posted_at, logs_url, " +
        "categories!inner(slug, name)",
    )
    .eq("kind", "video")
    .or(
      `and(posted_at.gte.${minIso},posted_at.lte.${maxIso}),posted_at.is.null`,
    )
    .order("posted_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });
  if (error || !data) return {};
  const videos = data as unknown as Row[];

  // Resolve each video to a JST calendar date. Drop videos whose date
  // can't be resolved — we'd rather link nothing than mis-link by a
  // weak signal.
  const videoEntries = videos
    .map((v) => {
      const cat = Array.isArray(v.categories) ? v.categories[0] : v.categories;
      if (!cat?.slug) return null;

      // タイトル日付優先 → posted_at JST fallback (video-jst-date.ts)。
      const ymd = resolveVideoJstYmd(v.title, v.posted_at);
      if (!ymd) return null;

      return {
        id: v.id,
        title: v.title,
        url: v.url,
        logsUrl: v.logs_url ?? null,
        categorySlug: cat.slug,
        categoryName: cat.name ?? cat.slug,
        ...ymd,
      };
    })
    .filter((v): v is NonNullable<typeof v> => v !== null);

  // Pre-index videos by JST Y/M/D so each session lookup is O(1).
  // videoEntries は DB 側で posted_at asc ソート済 → bucket 先頭が最古、
  // 配列のままセッション側に展開して dropdown UI に最古→最新の順で渡す。
  const videosByDate = new Map<string, typeof videoEntries>();
  for (const v of videoEntries) {
    const key = jstYmdKey(v);
    const bucket = videosByDate.get(key);
    if (bucket) bucket.push(v);
    else videosByDate.set(key, [v]);
  }

  const out: Record<string, SessionVideoLink[]> = {};
  for (const s of sessions) {
    const bucket = videosByDate.get(jstYmdKey(toJstYmd(s.date.getTime())));
    if (!bucket || bucket.length === 0) continue;
    out[s.rawDate] = bucket.map((match) => ({
      href: `/category/${match.categorySlug}/videos?focus=${match.id}`,
      url: match.url,
      categoryName: match.categoryName,
      videoTitle: match.title,
      logsUrl: match.logsUrl,
    }));
  }
  return out;
}
