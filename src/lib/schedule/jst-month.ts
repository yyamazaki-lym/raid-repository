/**
 * JST (UTC+9) 月境界 helper。native スケジュールの月別 collapsible
 * section から利用する。`JST_OFFSET_MS` は portal 内に複数定義が
 * あるが、本ファイルでは月境界判定に閉じた用途のみ持つ。
 */

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

export type YearMonth = { year: number; month: number };

/** 月末まで (含む) この日数以内で翌月 section を自動表示する閾値。 */
export const MONTHLY_NEXT_THRESHOLD_DAYS = 7;

function toJstUtcDate(d: Date): Date {
  return new Date(d.getTime() + JST_OFFSET_MS);
}

/** 任意の Date を JST 解釈で年月に変換 (month は 1-12)。 */
export function toJstYearMonth(date: Date): YearMonth {
  const j = toJstUtcDate(date);
  return { year: j.getUTCFullYear(), month: j.getUTCMonth() + 1 };
}

/** JST 現在年月。 */
export function getCurrentJstYearMonth(now: Date = new Date()): YearMonth {
  return toJstYearMonth(now);
}

/** delta ヶ月加算 (負も可)。 */
export function addMonths(ym: YearMonth, delta: number): YearMonth {
  const total = ym.year * 12 + (ym.month - 1) + delta;
  const year = Math.floor(total / 12);
  const month = ((total % 12) + 12) % 12 + 1;
  return { year, month };
}

/** "2026-05" 形式の安定 key。 */
export function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** "2026年 5月" 表記 (見出し用)。 */
export function monthLabel(year: number, month: number): string {
  return `${year}年 ${month}月`;
}

/**
 * 当月の最終日まで `thresholdDays` 日以下なら true。
 * 例: 当月最終日が 31 で today が 25 なら remaining=6、threshold=7 で true。
 */
export function isNearMonthEndJst(
  thresholdDays: number,
  now: Date = new Date(),
): boolean {
  const j = toJstUtcDate(now);
  const year = j.getUTCFullYear();
  const monthIdx = j.getUTCMonth();
  const day = j.getUTCDate();
  const lastDay = new Date(Date.UTC(year, monthIdx + 1, 0)).getUTCDate();
  return lastDay - day <= thresholdDays;
}
