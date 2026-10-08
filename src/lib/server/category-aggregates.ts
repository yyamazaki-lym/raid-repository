import "server-only";

import { createClient } from "@/lib/supabase/server";
import { fetchAllPages } from "@/lib/fetch-all-pages";
import { challengeTime } from "@/lib/video-challenge-time";
import { toJstYmd } from "@/lib/video-jst-date";
import { extractDateFromTitle } from "@/lib/title-date";
import { isFirstFloorPracticeTitle } from "@/lib/clear-detection";
import { videoBelongsToCategory } from "@/lib/content-groups";

/**
 * コンテンツ一覧 (`/category`) のカードに出す集計 (累計練習時間・クリアまでの時間・
 * 今週 +N)。Server Component (`category/page.tsx`) からだけ呼ぶ。
 *
 * 2026-10-08 (2026-10-07 セキュリティ精査の残り): 以前は `categories-actions.ts`
 * ("use server") にあり、認可を持たないまま Server Action として登録されていた
 * (ID はクライアントに出ていなかったが、知られれば誰でも POST で呼べた)。
 * 素のモジュールに移して Server Action から外した (`onboarding-state.ts` /
 * `pull-notes-read.ts` と同じやり方)。読み取りは呼び出した人の cookie の
 * クライアント (RLS が効く) のまま。
 */

/**
 * 挑戦時間の集計で読む動画の行がこれを超えたら、サーバーのログに残す
 * (2026-10-07)。
 */
const PRACTICE_SECONDS_ROWS_WARN = 5000;

/**
 * Sum of `duration_seconds` per category across all video links.
 * NULL durations are ignored. Used by the category index to render the
 * "累計練習時間" badge on each card.
 *
 * 2026-07-12 監査 B-7: 全 video 行の転送 + JS 集計を DB 側 GROUP BY
 * (`practice_seconds_by_category` RPC、schema.sql 13c-2) に置換。転送量が
 * 動画数比例 → カテゴリ数比例になる。エラー時は従来どおり `{}` (バッジ
 * 非表示に degrade) — schema 未適用の瞬間も UI は壊れない。
 */
export async function fetchPracticeSecondsByCategory(): Promise<
  Record<string, number>
> {
  // 2026-10-07: 同じ練習の動画 (視点違い・上げ直し) を 1 本にまとめるため、
  // SQL の `SUM(duration_seconds)` (RPC `practice_seconds_by_category`) から
  // 動画の行を読んで JS で集計する形に戻した。まとめる判定は題名の番号と
  // 日付を見るので SQL では書けない (`challengeTime`)。転送は動画数に比例
  // するが、読むのは 7 列だけ。RPC は schema に残してある (呼ばない)。
  const supabase = await createClient();
  const res = await fetchAllPages(async (from, to) => {
    const { data, error } = await supabase
      .from("category_links")
      .select("id, category_id, title, url, duration_seconds, posted_at, created_at")
      .eq("kind", "video")
      .order("id", { ascending: true })
      .range(from, to);
    return { data: (data ?? null) as Array<Record<string, unknown>> | null, error };
  });
  // 失敗・打ち切りは従来どおり `{}` (バッジ非表示に degrade)。部分結果で
  // 少ない時間を出さない。
  if (res.error || res.truncated) return {};
  // 2026-10-07: 全行を読む方式にした (#448)。本番で測った時点 (2026-10-07) では
  // コンテンツ一覧の応答の始まりが中央値 254ms で、ほかのページと 60ms ほどの差。
  // 行が増えて遅くなっていないか気づけるよう、多いときはログに残す (見直すときは
  // 集計結果を持たせて SQL で集計する。個人 ADR-016)。
  if (res.rows.length > PRACTICE_SECONDS_ROWS_WARN) {
    console.warn(
      `[practice-seconds] video rows: ${res.rows.length} (> ${PRACTICE_SECONDS_ROWS_WARN})`,
    );
  }
  const byCategory = new Map<string, Parameters<typeof challengeTime>[0][number][]>();
  for (const r of res.rows) {
    const cid = r.category_id as string | null;
    if (!cid) continue;
    const list = byCategory.get(cid) ?? [];
    list.push({
      id: String(r.id),
      title: (r.title as string | null) ?? null,
      url: (r.url as string | null) ?? null,
      durationSeconds: (r.duration_seconds as number | null) ?? null,
      // 動画タブ・クリアまでの時間と同じく、投稿日時が無ければ行の作成日時。
      postedAt: (r.posted_at as string | null) ?? ((r.created_at as string | null) ?? null),
    });
    byCategory.set(cid, list);
  }
  const totals: Record<string, number> = {};
  for (const [cid, list] of byCategory) {
    const sec = challengeTime(list).totalSeconds;
    if (sec > 0) totals[cid] = sec;
  }
  return totals;
}

/**
 * "Time to clear" per category — sum of `duration_seconds` between the
 * tier's "1層練習" start and the first-clear timestamp.
 *
 * 1.9.17 added:
 *   - Title-date preferred over posted_at (raid date is a better
 *     signal than upload date)
 *   - Foreign-content videos filtered out via the bilingual classifier
 *     (e.g. an LH-級 video misfiled in the Cruiser category)
 *
 * 1.9.16 had introduced the tier-aware start point:
 *   - Savage tiers: the earliest video whose title matches
 *     `isFirstFloorPracticeTitle` (e.g. "1層", "P1S", "M1S", "M5S").
 *     If none found, falls back to the earliest video.
 *   - Ultimate / 4-person: starts at the earliest video.
 *
 * Returns an empty map for categories without `first_clear_at` set.
 */
export async function fetchTimeToClearByCategory(): Promise<
  Record<string, number>
> {
  const supabase = await createClient();
  // Pull categories that have a first_clear_at + their `name` (needed
  // for tier-aware detection + foreign-video filtering).
  const { data: cats, error: catErr } = await supabase
    .from("categories")
    .select("id, name, first_clear_at")
    .not("first_clear_at", "is", null);
  if (catErr || !cats || cats.length === 0) return {};
  const catIds = cats.map((c) => c.id as string);
  const catInfoMap = new Map<
    string,
    { name: string | null; firstClearAt: string }
  >(
    cats.map((c) => [
      c.id as string,
      {
        name: (c as { name?: string | null }).name ?? null,
        firstClearAt: c.first_clear_at as string,
      },
    ]),
  );

  // 2026-07-12 監査 B-7: クリア後に増え続けるファーム動画 (集計対象は
  // first_clear_at までなので絶対に使われない尾) を DB 段で落とす転送上限。
  // タイトル日付優先ロジック (posted_at より古い開催日をタイトルから採る)
  // があるため、最遅 first_clear_at + 30 日の余白を持たせる。posted_at IS
  // NULL の行はタイトル/created_at 判定に回るため従来どおり全て取る。
  const maxFirstClearMs = Math.max(
    ...cats.map((c) => new Date(c.first_clear_at as string).getTime()),
  );
  const postedAtCapIso = new Date(
    maxFirstClearMs + 30 * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { data: videos, error: vErr } = await supabase
    .from("category_links")
    // 2026-10-07: id と url も読む (`challengeTime` が使う)。
    .select("id, category_id, title, url, duration_seconds, posted_at, created_at")
    .in("category_id", catIds)
    .eq("kind", "video")
    .or(`posted_at.lte.${postedAtCapIso},posted_at.is.null`);
  if (vErr || !videos) return {};

  // Annotate each video with its effective ISO timestamp (title >
  // posted_at > created_at) so subsequent comparisons all use the
  // raid date instead of the upload time.
  const annotated = videos.map((v) => {
    const postedAt = (v.posted_at as string | null) ?? null;
    const createdAt = v.created_at as string;
    // 2026-10-01 監査 U-11: 年ヒントはアプリの TZ (JST) の年。
    const fallbackYear = toJstYmd(
      new Date(postedAt ?? createdAt).getTime(),
    ).y;
    const titleD = extractDateFromTitle(v.title as string, fallbackYear);
    const effectiveIso = titleD
      ? new Date(
          Date.UTC(titleD.y, titleD.m - 1, titleD.d, 13, 0, 0),
        ).toISOString()
      : (postedAt ?? createdAt);
    return { ...v, effectiveIso };
  });

  // Group + filter foreign-content videos per category, then sort by
  // effective ISO ascending.
  const byCategory = new Map<string, typeof annotated>();
  for (const v of annotated) {
    const cid = v.category_id as string;
    const info = catInfoMap.get(cid);
    if (!info) continue;
    if (!videoBelongsToCategory(v.title as string, info.name)) continue;
    const list = byCategory.get(cid);
    if (list) list.push(v);
    else byCategory.set(cid, [v]);
  }
  for (const list of byCategory.values()) {
    list.sort((a, b) => a.effectiveIso.localeCompare(b.effectiveIso));
  }

  const totals: Record<string, number> = {};
  for (const cid of catIds) {
    const info = catInfoMap.get(cid);
    if (!info) continue;
    const list = byCategory.get(cid);
    if (!list || list.length === 0) continue;

    const firstFloorVideo = list.find((v) =>
      isFirstFloorPracticeTitle(v.title as string, info.name),
    );
    const startAt = firstFloorVideo?.effectiveIso ?? list[0]!.effectiveIso;

    // 2026-10-07: 範囲 (1 層練習〜初クリア) に入る動画のうち、同じ練習の
    // 動画は 1 本にまとめる (`challengeTime`)。
    const total = challengeTime(
      list
        .filter((v) => v.effectiveIso >= startAt && v.effectiveIso <= info.firstClearAt)
        .map((v) => ({
          id: v.id as string,
          title: (v.title as string | null) ?? null,
          url: (v.url as string | null) ?? null,
          durationSeconds: (v.duration_seconds as number | null) ?? null,
          postedAt: (v.posted_at as string | null) ?? (v.created_at as string),
        })),
    ).totalSeconds;
    if (total > 0) totals[cid] = total;
  }
  return totals;
}

/**
 * Recent Discord-imported counts per category (last `daysAgo` days).
 * Used by the category index to render "今週 +N" badges on each card.
 */
export async function fetchRecentImportCountsByCategory(
  daysAgo = 7,
): Promise<Record<string, number>> {
  // 2026-08-05 監査 L-10: 当時は `"use server"` モジュールにあり、export が公開 POST
  // エンドポイントだったので、引数をランタイムで検証していた (2026-10-08 に素の
  // モジュールへ移したが、丸めはそのまま残す)。型注釈だけだった頃は
  // `daysAgo` に null / 文字列 / 1e12 を渡すと `toISOString()` が
  // `RangeError: Invalid time value` を投げ、try/catch が無いため unhandled
  // で 500 になった。有効な巨大値 (例 100000) でも `category_links` の全行
  // スキャンを毎回強制できた。1〜365 日に丸める。
  const days = Number.isFinite(Number(daysAgo))
    ? Math.min(Math.max(Math.trunc(Number(daysAgo)), 1), 365)
    : 7;
  const supabase = await createClient();
  const sinceIso = new Date(Date.now() - days * 86400000).toISOString();
  const { data, error } = await supabase
    .from("category_links")
    .select("category_id, created_at")
    .eq("source", "discord")
    .gte("created_at", sinceIso);
  if (error || !data) return {};

  const counts: Record<string, number> = {};
  for (const row of data) {
    const cid = row.category_id as string;
    counts[cid] = (counts[cid] ?? 0) + 1;
  }
  return counts;
}
