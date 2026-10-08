import "server-only";

import { unstable_cache } from "next/cache";
import {
  createClient,
  createSupabaseServiceRoleClient,
} from "@/lib/supabase/server";
import { progressValue } from "@/lib/fflogs-progress";

/**
 * コンテンツカードの日別到達度スパークライン (UI-2、2026-09-08)。
 *
 * 調査ノート第 4 回 8-3 UI-2「pull 数 / best% のヘッダー + 日別 best%
 * スパークライン」のうち、**コンテンツカード側**。練習ログ上部の
 * 「総 pull / 最深到達」タイルは 2026-08-28 から出ているので、残っていたのは
 * 「タブを開かずに一覧で進み具合が分かる」ほうだった。
 *
 * ## 集計は DB 側 (`category_progress_by_day`)
 *
 * 到達度は「突破済み区間数 + 現在区間の削り」なのでティア全体の区間数が
 * 要る一方、カードに出すのは直近数週間だけ。JS でやると /category に全 pull
 * を転送することになるので、日 × カテゴリの数十行に縮約してから受け取る
 * (RPC の設計判断は `supabase/schema.sql` の 13c-3 節)。
 *
 * 到達度そのものの計算は **`progressValue` を通す** — 練習ログ画面の
 * バー・トレンド・プル箱と同じ関数なので、カードとタブで数字が食い違わない。
 * 2026-10-07: 同じ夜を 2 人が上げたログの同じ pull は、RPC の側で 1 回だけ数える
 * (schema.sql 13c-2b。判定は練習ログ画面の `fflogs-duplicate-pulls.ts` と同じ)。
 *
 * ## 失敗しても画面は出す
 *
 * RPC が無い DB (schema.sql を再実行していないデプロイ) では error になる。
 * その場合は空のマップを返し、カードはスパークラインだけ出さずに描画される
 * (`fetchPracticeSecondsByCategory` と同じ握りつぶし方)。
 *
 * ## 公開デモ (2026-10-08)
 *
 * 集計 RPC (`category_progress_by_day` と中で呼ぶ `fflogs_duplicate_pulls`) は
 * デモでは service_role にしか配らない (schema.sql 15 章)。以前は anon にも
 * 配っていたため、anon キーで PostgREST から直接、回数の制限なく
 * (`fflogs_duplicate_pulls(0)` なら全期間を) 集計させられた (authenticated も、
 * 部外者が Supabase Auth に直接ログインすればなれる)。デモでは見る人に関係なく
 * サーバーが service role で計算し、全員同じ結果なので Data Cache に 60 秒置く。
 * 失敗 (空) も置く。デモの SELECT は誰にでも全行開いている (7 章) ので、見える
 * 範囲は変わらない。DB の集計はおおむね 1 分に 1 回 (保存は Next の Data Cache の
 * 最善努力で、厳密な上限ではない)。
 */

/** カード 1 枚ぶんの日別到達度 (古い順)。 */
export type ProgressSpark = {
  /** JST 暦日 `YYYY-MM-DD`。 */
  date: string;
  /** 0-100 の到達度。 */
  progress: number;
  pulls: number;
  hasClear: boolean;
};

/** カードに出す最大日数 (これより古い日は捨てる)。 */
const SPARK_DAYS = 56;
/** 1 枚のスパークラインに描く最大点数 (多いと 60px 幅で潰れる)。 */
const SPARK_MAX_POINTS = 24;

function numberOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** 公開デモのスパークラインを共有キャッシュに置く秒数。 */
const DEMO_SPARK_CACHE_SECONDS = 60;

/**
 * 公開デモのスパークライン (見る人に関係なく同じ)。失敗 (空) も 60 秒置く —
 * 保存しないと、DB が苦しいときほど描画のたびに集計が走るため。
 */
const demoSparksCache = unstable_cache(
  async (): Promise<Record<string, ProgressSpark[]>> =>
    (await sparklinesWith(createSupabaseServiceRoleClient())) ?? {},
  ["category-progress-demo"],
  { revalidate: DEMO_SPARK_CACHE_SECONDS },
);

/** 公開デモか (auth.ts の isPublicDemoModeEnabled と同じ判定)。 */
function isPublicDemo(): boolean {
  return process.env.PUBLIC_DEMO_MODE === "true";
}

export async function fetchProgressSparklinesByCategory(): Promise<
  Record<string, ProgressSpark[]>
> {
  try {
    // 公開デモでは、ログインしているかに関係なく全員この経路 (重い集計の RPC は
    // デモでは service_role にしか配っていない。デモの表は誰にでも全行読めるので、
    // 見る人で結果は変わらない)。
    if (isPublicDemo()) return await demoSparksCache();
    return (await sparklinesWith(await createClient())) ?? {};
  } catch (e) {
    console.warn("[category-progress] sparkline fetch threw:", e);
    return {};
  }
}

/**
 * RPC を呼んでカードごとの点に直す。RPC が失敗したら null (呼び出し側で空にする)。
 * ⚠ cookie / headers を読まないこと — ゲスト向けには `unstable_cache` の中で呼ぶ。
 */
async function sparklinesWith(
  supabase: ReturnType<typeof createSupabaseServiceRoleClient>,
): Promise<Record<string, ProgressSpark[]> | null> {
  const { data, error } = await supabase.rpc("category_progress_by_day", {
    p_days: SPARK_DAYS,
  });
  if (error || !data) return null;
  const out: Record<string, ProgressSpark[]> = {};
  for (const row of data as Array<{
    category_id: string;
    day: string;
    pulls: number | string | null;
    segment: number | string | null;
    segment_count: number | string | null;
    best_percentage: number | string | null;
    has_clear: boolean | null;
  }>) {
    const id = row.category_id;
    const date = typeof row.day === "string" ? row.day : null;
    if (!id || !date) continue;
    const hasClear = row.has_clear === true;
    const progress = progressValue({
      hasClear,
      segment: numberOrNull(row.segment),
      segmentCount: numberOrNull(row.segment_count),
      remainingPercent: numberOrNull(row.best_percentage),
    });
    (out[id] ??= []).push({
      date,
      progress,
      pulls: numberOrNull(row.pulls) ?? 0,
      hasClear,
    });
  }
  // RPC は日付昇順で返すが、点が多すぎるときは **新しい側**を残す
  // (カードで見たいのは「いまどうか」)。
  for (const id of Object.keys(out)) {
    const list = out[id]!;
    list.sort((a, b) => a.date.localeCompare(b.date));
    if (list.length > SPARK_MAX_POINTS) {
      out[id] = list.slice(list.length - SPARK_MAX_POINTS);
    }
  }
  return out;
}
