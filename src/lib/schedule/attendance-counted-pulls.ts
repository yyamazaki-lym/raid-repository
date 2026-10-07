/**
 * 出席サマリーの pull 数から、別のログと同じ pull を除く (2026-10-07、C-3 の続き)。
 *
 * 同じ夜を 2 人がそれぞれ FFLogs に上げると、同じ pull が 2 本のレポートに入る。
 * 出席サマリーは「日の pull 数 (M)」と「メンバーの pull 数 (N)」をレポート単位の
 * 合計で出しているので、両方が 2 倍になっていた (「一部のみ (N/M pull)」の表示)。
 *
 * ## 割り引くのは「相手が同じ日に数えられている重複」だけ
 *
 * 数えない pull の数は DB の `fflogs_report_duplicate_pulls` (schema.sql 13c-4) が、
 * 重なった相手のレポートごとに返す。出席サマリーはレポートの最初の pull の日で
 * 開催日と結ぶので、相手のレポートが**別の日**に数えられている重複 (2 夜ぶんを
 * 1 本に入れたレポートが相手のとき等) を割り引くと、その日の pull が消えて
 * 「ログなし」に化ける。同じ日の相手だけを割り引く (PR のレビューで検出)。
 *
 * ## メンバーの数
 *
 * メンバーごとの pull 数はレポート単位 (`fflogs_attendance_actuals`) にしか無く、
 * どの pull に居たかは分からない。次の 2 つの大きい方を取り、日の pull 数で抑える:
 *
 * - 割り戻した合計: レポートごとの「数える割合」(数える pull ÷ 全 pull) を掛けて
 *   足す。2 本目が丸ごと同じ pull なら正確、一部だけ重なるときは、メンバーが
 *   そのレポートの pull に均等に居たとみなす近似
 * - どれか 1 本のレポートでの数: 1 本のレポートの中に同じ pull は無いので、本当の
 *   数はこれを下回らない。⚠ **出席の行は詳細が取れたレポートにしか無い**
 *   (代替経路で取った他人のログ・打ち切り・保管扱いには無い)。数える側に行が
 *   無いと割り戻した合計は 0 になり、出席が消えていた (PR のレビューで検出)。
 *   居たのに四捨五入で 0 になる (1 本 × 1/3 等) のもこれで防ぐ
 *
 * 重複が無い日は、割り戻した合計 = 従来の合計 なので値は変わらない。
 *
 * `@/` を import しない純モジュール (scripts/check-attendance-counted-pulls.mjs)。
 */

export type ReportDay = {
  reportCode: string;
  /** レポートの JST 暦日 (最初の pull の日)。 */
  day: string;
  /** レポートの全 pull 数。 */
  pulls: number;
};

export type ReportDuplicate = {
  /** 数えない pull を持つレポート。 */
  reportCode: string;
  /** 重なった相手 (順位がいちばん上のレポート)。 */
  countedReportCode: string;
  /** その相手と重なった pull の数。 */
  duplicatePulls: number;
};

export type MemberReportPulls = {
  reportCode: string;
  discordUserId: string;
  pulls: number;
};

export function countedAttendancePulls(
  reports: ReadonlyArray<ReportDay>,
  duplicates: ReadonlyArray<ReportDuplicate>,
  actuals: ReadonlyArray<MemberReportPulls>,
): {
  /** 日 → 数える pull 数。 */
  dayPulls: Map<string, number>;
  /** 日 → メンバー → 数える pull 数。 */
  pullsByDay: Map<string, Record<string, number>>;
} {
  const dayOfReport = new Map<string, string>();
  for (const r of reports) dayOfReport.set(r.reportCode, r.day);

  // 相手が同じ日にある重複だけを数える。
  const sameDayDuplicates = new Map<string, number>();
  for (const d of duplicates) {
    const day = dayOfReport.get(d.reportCode);
    if (day === undefined || dayOfReport.get(d.countedReportCode) !== day) continue;
    sameDayDuplicates.set(
      d.reportCode,
      (sameDayDuplicates.get(d.reportCode) ?? 0) + Math.max(0, Number(d.duplicatePulls) || 0),
    );
  }

  const shareOfReport = new Map<string, number>();
  const dayPulls = new Map<string, number>();
  for (const r of reports) {
    const pulls = Math.max(0, Number(r.pulls) || 0);
    const duplicate = Math.min(pulls, sameDayDuplicates.get(r.reportCode) ?? 0);
    const counted = pulls - duplicate;
    shareOfReport.set(r.reportCode, pulls > 0 ? counted / pulls : 1);
    dayPulls.set(r.day, (dayPulls.get(r.day) ?? 0) + counted);
  }

  // 日 → メンバー → { 割り戻した合計, 1 本のレポートでの最大 }
  const raw = new Map<string, Map<string, { scaled: number; single: number }>>();
  for (const a of actuals) {
    const day = dayOfReport.get(a.reportCode);
    if (day === undefined) continue;
    const n = Math.max(0, Number(a.pulls) || 0);
    const bag = raw.get(day) ?? new Map<string, { scaled: number; single: number }>();
    const cur = bag.get(a.discordUserId) ?? { scaled: 0, single: 0 };
    cur.scaled += n * (shareOfReport.get(a.reportCode) ?? 1);
    cur.single = Math.max(cur.single, n);
    bag.set(a.discordUserId, cur);
    raw.set(day, bag);
  }
  const pullsByDay = new Map<string, Record<string, number>>();
  for (const [day, bag] of raw) {
    const cap = dayPulls.get(day) ?? 0;
    const out: Record<string, number> = {};
    for (const [uid, v] of bag) {
      out[uid] = Math.min(cap, Math.max(Math.round(v.scaled), v.single));
    }
    pullsByDay.set(day, out);
  }
  return { dayPulls, pullsByDay };
}
