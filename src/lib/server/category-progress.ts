import "server-only";

import { createClient } from "@/lib/supabase/server";
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
 *
 * ## 失敗しても画面は出す
 *
 * RPC が無い DB (schema.sql を再実行していないデプロイ) では error になる。
 * その場合は空のマップを返し、カードはスパークラインだけ出さずに描画される
 * (`fetchPracticeSecondsByCategory` と同じ握りつぶし方)。
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

export async function fetchProgressSparklinesByCategory(): Promise<
  Record<string, ProgressSpark[]>
> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("category_progress_by_day", {
      p_days: SPARK_DAYS,
    });
    if (error || !data) return {};
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
  } catch (e) {
    console.warn("[category-progress] sparkline fetch threw:", e);
    return {};
  }
}
