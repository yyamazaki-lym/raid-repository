/**
 * PostgREST の 1000 行上限で黙って切れないように、`range()` でページを
 * 繰って取り切る汎用部品 (2026-10-01 監査 C-2)。
 *
 * ## 何を直したものか
 *
 * PostgREST は **既定で 1 リクエスト 1000 行**しか返さず、超えた分は
 * エラーにならずに黙って落ちる (`.limit()` を付けても超えられない)。
 * #328 (練習ログの明細) / #373 (出席サマリー) で同じ穴を個別に塞いだが、
 * 次の 3 箇所が無制限 SELECT のまま残っていた:
 *
 *   - FFLogs 同期のリンク段: logs_url の無い動画 (= 直前の wipe でほぼ全動画)
 *     → 1000 本を超えると任意の 1000 本だけが再リンク候補になり、
 *       残りは毎晩 wipe されたまま戻らない
 *   - 自前作成式の TOP: 表示中スケジュールの全セッションとその出欠
 *     → 出欠はセッション × 人数なので 125 セッション前後で上限に届き、
 *       直近の出欠が欠ける
 *   - pull 取り込みの同期台帳 (fflogs_report_syncs)
 *     → 1000 件を超えると古いレポートが「未同期」に見え、毎回取得枠を食う
 *
 * ## 使い方
 *
 * ⚠ **呼び出し側で順序を付けること** (一意になるところまで)。順序が
 * 決まらないまま `range()` で繰ると、同じ行が 2 ページに出たり抜けたり
 * する。付いているかは `scripts/check-fetch-all-pages.mjs` が呼び出し側の
 * ソースを読んで確かめる。
 *
 * ⚠ このファイルは import を持たない純モジュール (検査スクリプトが単体
 *   コンパイルして偽のページで走らせる)。Supabase のビルダーは呼び出し側が
 *   組み、1 ページ分の取得を関数で渡す。
 */

/** 1 リクエストで返る最大行数 (PostgREST の既定)。 */
export const PAGE_ROWS = 1000;

/**
 * 取り切る上限 (事故の安全弁)。誤データで行が膨らんだときに 1 回の描画や
 * cron が際限なくページを繰らないための値で、通常の運用では届かない。
 */
export const DEFAULT_MAX_ROWS = 50_000;

/**
 * `.in()` に渡す ID の 1 回ぶんの件数。UUID 200 個で URL は 8KB 弱
 * (PostgREST / 経路のプロキシが 414 を返し始める長さより十分短い)。
 */
export const IN_LIST_CHUNK = 200;

export type FetchRowsPage<T> = (
  from: number,
  to: number,
) => Promise<{ data: T[] | null; error: { message: string } | null }>;

export type AllPagesResult<T> = {
  rows: T[];
  /** 途中で失敗したらそのエラー (rows はそこまでの部分)。 */
  error: { message: string } | null;
  /** 安全弁 (`maxRows`) で打ち切った。 */
  truncated: boolean;
};

/**
 * `fetchPage(from, to)` を `PAGE_ROWS` ずつ繰り、要求より少ない行が返った
 * ページで止める。1 ページでも失敗したら `error` を返す — 呼び出し側は
 * **0 行や部分結果を正常として扱わない**こと (「無い」と「読めなかった」を
 * 混ぜない)。
 */
export async function fetchAllPages<T>(
  fetchPage: FetchRowsPage<T>,
  maxRows: number = DEFAULT_MAX_ROWS,
): Promise<AllPagesResult<T>> {
  const rows: T[] = [];
  for (let from = 0; from < maxRows; from += PAGE_ROWS) {
    const to = Math.min(from + PAGE_ROWS, maxRows) - 1;
    const { data, error } = await fetchPage(from, to);
    if (error) return { rows, error, truncated: false };
    const got = data ?? [];
    rows.push(...got);
    if (got.length < to - from + 1) {
      return { rows, error: null, truncated: false };
    }
  }
  return { rows, error: null, truncated: true };
}

/** 配列を `size` 件ずつに割る (`.in()` の URL 長を抑える)。 */
export function chunk<T>(items: readonly T[], size: number = IN_LIST_CHUNK): T[][] {
  if (!Number.isInteger(size) || size <= 0) throw new Error(`chunk size: ${size}`);
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
