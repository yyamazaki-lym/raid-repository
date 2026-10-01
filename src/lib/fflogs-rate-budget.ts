/**
 * FFLogs v2 API のポイント残量から、今回の同期で取りに行くレポート数を
 * 決める (2026-10-01 監査 C-7)。
 *
 * ## 直した問題
 *
 * FFLogs v2 は「1 時間あたりのポイント」制。pull 取り込みは 1 レポートに
 * つき fights 1 回 + PT 指標の Summary table (8 pull ずつ) を引くので、
 * 保存形の更新に伴う取り直しや手動の再試行で 40 レポートを一度に引くと、
 * 1 回で 1,600 table 前後になり時間あたりの上限を超え得た。上限に当たると
 * 429 が返るが、以前は残りのレポートを引き続けて全部 429 にしていた。
 *
 * ## 方針
 *
 * - 同期の開始時に `rateLimitData` を 1 回引き、残りが少なければ今回の枠を
 *   絞る (残りは台帳に「未取得」のまま残るので次回の同期が続ける)
 * - 429 を受けたら、その時点で今回の同期を打ち切る (fflogs-fights.ts)
 *
 * 1 クエリの消費ポイントは FFLogs が公開していないので、割合で判定する。
 *
 * ⚠ import を持たない純モジュール (`scripts/check-fflogs-rate-budget.mjs`)。
 */

export type RateLimitBudget = {
  limitPerHour: number;
  pointsSpentThisHour: number;
  /** 次にポイントが戻るまでの秒数。 */
  pointsResetIn: number;
};

/** 残りがこの割合を切ったら、今回の枠を `LOW_POINTS_REPORT_LIMIT` に絞る。 */
export const LOW_POINTS_RATIO = 0.25;
/** 残りがこの割合を切ったら、今回はレポートを取りに行かない。 */
export const EXHAUSTED_POINTS_RATIO = 0.05;
/** 残りが少ないときに今回取りに行くレポート数の上限。 */
export const LOW_POINTS_REPORT_LIMIT = 5;

/** 残りポイントの割合 (0〜1)。判定できなければ null。 */
export function remainingRatio(budget: RateLimitBudget | null): number | null {
  if (!budget) return null;
  const { limitPerHour, pointsSpentThisHour } = budget;
  if (!Number.isFinite(limitPerHour) || limitPerHour <= 0) return null;
  if (!Number.isFinite(pointsSpentThisHour)) return null;
  return Math.max(0, limitPerHour - pointsSpentThisHour) / limitPerHour;
}

/**
 * 今回取りに行くレポート数。残量が取れなかったとき (null) は従来どおり
 * `requested` を返す (ポイント照会の失敗で同期を止めない)。
 */
export function reportLimitForBudget(
  requested: number,
  budget: RateLimitBudget | null,
): number {
  const ratio = remainingRatio(budget);
  if (ratio === null) return requested;
  if (ratio < EXHAUSTED_POINTS_RATIO) return 0;
  if (ratio < LOW_POINTS_RATIO) return Math.min(requested, LOW_POINTS_REPORT_LIMIT);
  return requested;
}
