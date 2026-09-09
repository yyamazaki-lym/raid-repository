/**
 * 出席実績を上限で切らずに取り切る (2026-09-09)。
 *
 * ## 何を直したものか
 *
 * PostgREST は **既定で 1000 行**を上限にする (`.limit()` を足しても超えられ
 * ない。実測は `lib/supabase/fflogs-fights.ts` の PAGE_SIZE コメント)。
 * `fflogs_attendance_actuals` は「レポート × メンバー」なので 1 レポート
 * 8 行前後 = **125 レポートで上限に達する**。2026-09-09 まで、この読み取りは
 *
 *     .in("report_code", codes.slice(0, 300))
 *
 * と書かれていて、(a) 301 本目以降のレポートが黙って落ち、(b) 300 本渡せても
 * 行数が 1000 を超えて途中で切れる、の**二重の切り捨て**になっていた。
 * 切れた行は「その人はその日に来ていない」として集計されるので、
 * 画面はエラーを出さずに出席を間違える。#328 (明細が 1000 件で頭打ち) と
 * 同じクラスの穴が別経路に残っていたもの。
 *
 * ## なぜ「1 ページの取得」を引数で受けるのか
 *
 * ⚠ **このモジュールは import を 1 つも持たない。** ここに置くのは
 * 「塊に割る / ページを繰る / いつ止める」の制御だけで、Supabase の
 * クエリ組みは呼び出し側 (`server/attendance-summary-actions.ts`) が渡す。
 * 理由は 2 つ:
 *
 *   1. `scripts/check-attendance-actuals-paging.mjs` が**偽の取得関数を
 *      渡して単体で走らせられる** (`@/` エイリアス import があると
 *      単体 tsc で解決できず検査から呼べない)
 *   2. Supabase のビルダーを構造型で写そうとすると
 *      (`from().select().in().order().range()` の連鎖と thenable) 型が
 *      噛み合わず、`as` で潰すことになる — 潰すと本当の不一致も隠れる
 */

/** 1 レポートぶんの出席実績 1 行。 */
export type ActualRow = {
  report_code: string;
  discord_user_id: string;
  pulls: number;
};

/**
 * `.in()` に渡す report_code の 1 回ぶんの件数。
 *
 * 100 レポート × メンバー 8 人前後 = 800 行前後で `ROWS_PER_PAGE` の 1 ページ
 * に収まる想定。収まらなくてもページを繰るので壊れない。
 */
export const CODES_PER_QUERY = 100;

/** 1 リクエストで返る最大行数 (PostgREST の既定)。 */
export const ROWS_PER_PAGE = 1000;

/**
 * 1 ページぶんの取得。呼び出し側が Supabase のクエリを組んで渡す。
 *
 * ⚠ **実装側で順序を付けること。** 順序を決めずに `range()` でページングする
 * と、同じ行が 2 ページに現れたり抜けたりし得る。順序が付いているかは
 * 検査スクリプトが呼び出し側のコードを見て確かめる。
 */
export type FetchActualsPage = (args: {
  codes: string[];
  from: number;
  to: number;
}) => Promise<{
  rows: ActualRow[] | null;
  error: { message: string } | null;
}>;

/**
 * `report_code` を `CODES_PER_QUERY` 件ずつに割り、各塊を `ROWS_PER_PAGE`
 * ごとに繰って全行返す。
 *
 * ⚠ **読み取りエラーを 0 行に化けさせない。** 1 本でも失敗したら `error` を
 * 返す (呼び出し側がエラー表示に落とす)。素通しすると「参加可と答えた全員が
 * 不在」に化ける — 呼び出し側の docstring 参照。
 */
export async function fetchAttendanceActualsByReports(
  fetchPage: FetchActualsPage,
  codes: string[],
): Promise<{ rows: ActualRow[]; error: { message: string } | null }> {
  const rows: ActualRow[] = [];
  for (let i = 0; i < codes.length; i += CODES_PER_QUERY) {
    const chunk = codes.slice(i, i + CODES_PER_QUERY);
    for (let from = 0; ; from += ROWS_PER_PAGE) {
      const { rows: page, error } = await fetchPage({
        codes: chunk,
        from,
        to: from + ROWS_PER_PAGE - 1,
      });
      if (error) return { rows, error };
      const got = page ?? [];
      rows.push(...got);
      if (got.length < ROWS_PER_PAGE) break;
    }
  }
  return { rows, error: null };
}
