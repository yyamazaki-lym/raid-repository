/**
 * FFLogs 同期 cron (`/api/cron/fflogs-sync`) の時間予算 (2026-10-01 監査 C-1)。
 *
 * ## 直した問題
 *
 * route は 2 段を**直列**に await する:
 *   1. `linkFflogsReportsToVideos` — 一覧取得 + 動画 / 日程へのリンク (予算 240s)
 *   2. `syncFflogsFights` — pull 単位の取り込み (予算 120s)
 *
 * 2 つの予算はそれぞれ「その関数を呼んだ時刻」から数えていたので、FFLogs が
 * 遅い日は 240 + 120 = 360s となり、Vercel の maxDuration (300s) で関数ごと
 * kill され得た。kill の位置によっては auto リンクの wipe 後・再リンク前に
 * 落ち、2026-07-12 の D-3 で直した「Logs アイコンが翌日まで欠ける」が戻る。
 *
 * ## 方針
 *
 * route の開始時に **「新しい外部取得を始めてよい期限」を 1 つだけ**切り、
 * 両方の段へ渡す。各段は自分の予算と比べて早い方を使う。期限を過ぎても
 * 実行中の 1 回の取得は止まらないので、その分と後段の書き込みを
 * maxDuration の残り (下の余白) で受ける。
 *
 * 手動の Server Action (設定画面のボタン) は段ごとに別の実行なので、
 * 期限を渡さず従来どおり各段の予算だけで動く。
 *
 * ⚠ このファイルは `@/` エイリアスも Supabase も import しない純モジュール
 *   (`scripts/check-fflogs-sync-budget.mjs` が単体コンパイルして検査する)。
 */

/** `/api/cron/fflogs-sync` の `maxDuration` (秒)。route 側の宣言と一致させる。 */
export const FFLOGS_SYNC_ROUTE_MAX_DURATION_SEC = 300;

/**
 * route 開始から「新しい外部取得を始めてよい」までの時間。
 *
 * 残り 90s の内訳 (期限直前に始まった処理が終わるまでの上限):
 *   - リンク段: 実行中の v2 / scrape-proxy 1 回 (最大 25s) + wipe と再リンクの
 *     書き込み (動画数百行で 〜30s)
 *   - pull 取り込み段: 実行中のレポート 1 件の v2 (20s) + 明細 1 バッチ (20s)。
 *     v1 / cookie の fallback 連鎖 (最大 45s) は期限後には始めない
 *   - 後処理 (再分類 / 掃除 / 橋渡し / 通知 / 出席突合): 〜20s
 * 両段は同じ期限を共有するので、どちらか一方が使い切ればもう一方は
 * 取得を始めない (= 加算にならない)。
 */
export const FFLOGS_SYNC_ROUTE_FETCH_BUDGET_MS = 210_000;

/**
 * 期限後に走り得る処理の上限見積り (ms)。期限をまたぐのはどちらか一方の段
 * だけなので、大きい方 (リンク段 25 + 30 = 55s > 取り込み段 20 + 20 = 40s) に
 * 後処理 20s を足す。`FETCH_BUDGET + この値 < maxDuration` を検査スクリプトが
 * 固定する。
 */
export const FFLOGS_SYNC_WORST_TAIL_MS =
  Math.max(25_000 + 30_000, 20_000 + 20_000) + 20_000;

/**
 * 段ごとの期限を決める。`sharedDeadlineAtMs` (route が切った共有期限) が
 * あれば、自分の予算 (`nowMs + ownBudgetMs`) と比べて早い方を返す。
 */
export function resolveSyncDeadline(
  nowMs: number,
  ownBudgetMs: number,
  sharedDeadlineAtMs?: number | null,
): number {
  const own = nowMs + ownBudgetMs;
  if (
    sharedDeadlineAtMs === undefined ||
    sharedDeadlineAtMs === null ||
    !Number.isFinite(sharedDeadlineAtMs)
  ) {
    return own;
  }
  return Math.min(own, sharedDeadlineAtMs);
}
