/**
 * 出席サマリーの pull 数から、別のログと同じ pull を除く (2026-10-07、C-3 の続き)。
 *
 * 同じ夜を 2 人がそれぞれ FFLogs に上げると、同じ pull が 2 本のレポートに入る。
 * 出席サマリーは「日の pull 数 (M)」と「メンバーの pull 数 (N)」をレポート単位の
 * 合計で出しているので、両方が 2 倍になっていた (「一部のみ (N/M pull)」の表示)。
 *
 * ## 割り戻し方
 *
 * メンバーごとの pull 数はレポート単位 (`fflogs_attendance_actuals`) にしか無く、
 * どの pull に居たかは分からない。そこでレポートごとに「数える割合」
 * (= 数える pull ÷ 全 pull) を出し、日の pull 数とメンバーの pull 数の両方に掛ける。
 *
 * - 2 本目のレポートが丸ごと 1 本目と同じ pull (よくある形) なら、2 本目の割合は 0
 *   で、日の pull 数もメンバーの pull 数も 1 本分になる (正確)
 * - 一部だけ重なる (録り始めが遅い等) ときは、メンバーがそのレポートの pull に
 *   均等に居たとみなす近似。日の pull 数は正確
 * - メンバーの値は日ごとに足してから四捨五入する。割合は 1 以下なので、日の
 *   pull 数を超えない
 *
 * 数えない pull の数は DB の `fflogs_report_duplicate_pulls` (schema.sql 13c-4) が
 * 返す。判定は練習ログの画面 (`src/lib/fflogs-duplicate-pulls.ts`) と同じ。
 *
 * `@/` を import しない純モジュール (scripts/check-attendance-counted-pulls.mjs)。
 */

export type ReportDay = {
  reportCode: string;
  /** レポートの JST 暦日 (最初の pull の日)。 */
  day: string;
  /** レポートの全 pull 数。 */
  pulls: number;
  /** そのうち別のログと同じ pull (数えない) の数。重複が無ければ 0。 */
  duplicatePulls: number;
};

export type MemberReportPulls = {
  reportCode: string;
  discordUserId: string;
  pulls: number;
};

export function countedAttendancePulls(
  reports: ReadonlyArray<ReportDay>,
  actuals: ReadonlyArray<MemberReportPulls>,
): {
  /** 日 → 数える pull 数。 */
  dayPulls: Map<string, number>;
  /** 日 → メンバー → 数える pull 数 (割り戻して四捨五入)。 */
  pullsByDay: Map<string, Record<string, number>>;
} {
  const dayOfReport = new Map<string, string>();
  const shareOfReport = new Map<string, number>();
  const dayPulls = new Map<string, number>();
  for (const r of reports) {
    const pulls = Math.max(0, Number(r.pulls) || 0);
    const duplicate = Math.min(pulls, Math.max(0, Number(r.duplicatePulls) || 0));
    const counted = pulls - duplicate;
    dayOfReport.set(r.reportCode, r.day);
    shareOfReport.set(r.reportCode, pulls > 0 ? counted / pulls : 1);
    dayPulls.set(r.day, (dayPulls.get(r.day) ?? 0) + counted);
  }

  const raw = new Map<string, Map<string, number>>();
  for (const a of actuals) {
    const day = dayOfReport.get(a.reportCode);
    if (!day) continue;
    const share = shareOfReport.get(a.reportCode) ?? 1;
    const bag = raw.get(day) ?? new Map<string, number>();
    bag.set(a.discordUserId, (bag.get(a.discordUserId) ?? 0) + (Number(a.pulls) || 0) * share);
    raw.set(day, bag);
  }
  const pullsByDay = new Map<string, Record<string, number>>();
  for (const [day, bag] of raw) {
    const out: Record<string, number> = {};
    for (const [uid, n] of bag) out[uid] = Math.round(n);
    pullsByDay.set(day, out);
  }
  return { dayPulls, pullsByDay };
}
