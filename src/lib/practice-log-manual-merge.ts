/**
 * 手動の記録 (2026-11-08、`practice-log-manual.ts`) を、pull 単位で数える節目
 * (チーム実績・各層の初討伐・各フェーズへの初到達) に **日単位で** 重ねる。
 *
 * 手動の記録には pull の時刻が無いので、節目の日は日単位で決める:
 *
 * - 手動の記録の日のほうがログより早ければ、その日を節目の日にする
 *   (`manual: "first"`)。pull 数は「その日より前のログの pull + その日までの
 *   手動の pull」、時間は「その日より前のログの戦闘時間」(手動の日の時間は
 *   分からないので含めない。画面は時間を出さない)
 * - ログの節目のほうが早ければ節目はそのまま。それより前の日の手動の pull は
 *   pull 数に足す (`manual: "partial"`。時間には入らない)
 * - 同じ日に両方あれば、ログの節目を優先する (ログの側は時刻まで分かる)
 *
 * 最速討伐・ノーデスは pull の戦闘時間と死亡数が要るので、ログだけのまま。
 *
 * `@/` を import しない (`scripts/check-practice-log-manual.mjs` が単体で
 * コンパイルする)。
 */
import type { PhaseFirstReach } from "./fflogs-fight-detail";
import {
  manualSegmentClears,
  manualSegmentIndex,
  type FloorMap,
} from "./fflogs-progress";
import {
  floorFirstClears,
  type FloorClearFight,
  type FloorFirstClear,
  type TeamBadge,
} from "./fflogs-session";
import { jstYmdString } from "./jst-date";
import { manualDayPulls, type ManualDay } from "./practice-log-manual";
import { normalizeSessionDate } from "./session-date";

/** 節目に手動の記録がどう効いたか。 */
export type ManualMark = "first" | "partial" | null;

const dayOf = (f: { sessionDate?: string | null; startMs: number }) =>
  normalizeSessionDate(f.sessionDate ?? null) ?? jstYmdString(new Date(f.startMs));

/** `date` 以前 (含む / 含まない) の手動の pull の合計。 */
function manualPullsUpTo(
  manual: ReadonlyArray<ManualDay>,
  date: string,
  inclusive: boolean,
  segment?: (s: ManualDay["segments"][number]) => boolean,
): number {
  let n = 0;
  for (const d of manual) {
    if (inclusive ? d.date > date : d.date >= date) continue;
    n += segment ? d.segments.filter(segment).reduce((a, s) => a + s.pulls, 0) : manualDayPulls(d);
  }
  return n;
}

/**
 * チーム実績のうち「初討伐」の日と「討伐 N 回」に手動の記録の討伐を足す。
 * 最速討伐・ノーデスは触らない (ログだけ)。
 */
export function mergeManualBadges(
  badges: ReadonlyArray<TeamBadge>,
  manual: ReadonlyArray<ManualDay>,
  floors: FloorMap,
  /**
   * ログの最初と最後のクリアの練習日 (`fightDate`、JST 暦日で補うので null に
   * ならない)。2026-11-09 (レビューで検出): `teamBadges` の日は `session_date`
   * そのままで、古い行では null になる。null を「手動の日のほうが早い」と比べて
   * いたので、ログの初討伐が先でも手動の日が初討伐になっていた。比べるのはこちら。
   */
  loggedClearDates: { first: string; last: string } | null = null,
): TeamBadge[] {
  const clearDays = manual
    .map((d) => ({
      date: d.date,
      clears: d.segments.reduce((a, s) => a + manualSegmentClears(s, floors), 0),
    }))
    .filter((d) => d.clears > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (clearDays.length === 0) return [...badges];
  const manualClears = clearDays.reduce((a, d) => a + d.clears, 0);
  const firstManual = clearDays[0]!.date;
  const lastManual = clearDays[clearDays.length - 1]!.date;

  const loggedFirst = badges.find((b) => b.kind === "firstClear") ?? null;
  const loggedClears = badges.find((b) => b.kind === "clears") ?? null;
  const loggedCount = loggedClears?.value ?? (loggedFirst ? 1 : 0);
  const total = loggedCount + manualClears;
  const firstLogged = loggedClearDates?.first ?? loggedFirst?.date ?? null;
  const firstDate = firstLogged && firstLogged <= firstManual ? firstLogged : firstManual;
  const lastLogged = loggedClearDates?.last ?? loggedClears?.date ?? loggedFirst?.date ?? null;
  const lastDate = lastLogged && lastLogged > lastManual ? lastLogged : lastManual;

  const out: TeamBadge[] = [{ kind: "firstClear", value: null, date: firstDate }];
  for (const b of badges) {
    if (b.kind === "flawless" || b.kind === "fastestClear") out.push(b);
  }
  // 1 回だけなら「初討伐」と同じ情報なので出さない (`teamBadges` と同じ)。
  if (total > 1) out.push({ kind: "clears", value: total, date: lastDate });
  return out;
}

/** 各層の初討伐 (+ 手動の記録の印)。 */
export type FloorFirstClearWithManual = FloorFirstClear & { manual: ManualMark };

/**
 * 各層の初討伐 (`floorFirstClears`) に手動の記録を重ねる (docstring 冒頭の規則)。
 * `fights` は `floorFirstClears` に渡すものと同じ (数える pull・層 index 付き)。
 */
export function floorFirstClearsWithManual(
  fights: ReadonlyArray<FloorClearFight>,
  manual: ReadonlyArray<ManualDay>,
  floors: FloorMap,
): FloorFirstClearWithManual[] {
  const logged = floorFirstClears(fights);
  if (manual.length === 0 || !floors) return logged.map((c) => ({ ...c, manual: null }));
  const indexOf = (s: ManualDay["segments"][number]) => manualSegmentIndex(s, floors, false);
  const manualFirst = new Map<number, string>();
  for (const d of manual) {
    for (const s of d.segments) {
      const idx = indexOf(s);
      if (idx === null || s.kills <= 0) continue;
      const cur = manualFirst.get(idx);
      if (cur === undefined || d.date < cur) manualFirst.set(idx, d.date);
    }
  }
  const indices = new Set<number>([...logged.map((c) => c.index), ...manualFirst.keys()]);
  const out: FloorFirstClearWithManual[] = [];
  for (const index of [...indices].sort((a, b) => a - b)) {
    const l = logged.find((c) => c.index === index) ?? null;
    const m = manualFirst.get(index) ?? null;
    const onFloor = (s: ManualDay["segments"][number]) => indexOf(s) === index;
    if (m !== null && (l === null || l.date === null || m < l.date)) {
      const before = fights.filter((f) => dayOf(f) < m);
      const beforeOnFloor = before.filter((f) => f.floorIndex === index);
      out.push({
        index,
        ms: beforeOnFloor.reduce((a, f) => a + Math.max(0, f.endMs - f.startMs), 0),
        pulls: beforeOnFloor.length + manualPullsUpTo(manual, m, true, onFloor),
        overallPulls: before.length + manualPullsUpTo(manual, m, true),
        date: m,
        startMs: Number.NaN,
        manual: "first",
      });
      continue;
    }
    if (l === null) continue;
    const date = l.date ?? jstYmdString(new Date(l.startMs));
    const addFloor = manualPullsUpTo(manual, date, false, onFloor);
    const addAll = manualPullsUpTo(manual, date, false);
    out.push({
      ...l,
      pulls: l.pulls + addFloor,
      overallPulls: l.overallPulls + addAll,
      manual: addAll > 0 ? "partial" : null,
    });
  }
  return out;
}

/** 各フェーズへの初到達 (+ 手動の記録の印)。 */
export type PhaseFirstReachWithManual = PhaseFirstReach & { manual: ManualMark };

/**
 * 各フェーズへの初到達 (`firstPhaseReaches`、絶) に手動の記録を重ねる
 * (docstring 冒頭の規則)。手動の記録で P5 に着いた日は P2〜P5 に着いた日でもある。
 * `pulls` は初到達の母数にした pull (数える pull、日付つき)。
 */
export function phaseFirstReachesWithManual(
  reaches: ReadonlyArray<PhaseFirstReach>,
  pulls: ReadonlyArray<{ durationMs: number; date: string | null }>,
  manual: ReadonlyArray<ManualDay>,
): PhaseFirstReachWithManual[] {
  if (manual.length === 0) return reaches.map((r) => ({ ...r, manual: null }));
  const manualFirst = new Map<number, string>();
  for (const d of manual) {
    const top = Math.max(0, ...d.segments.map((s) => s.phase ?? 0));
    // P1 は 1 本目で必ず着くので節目にしない (`firstPhaseReaches` と同じ)。
    for (let p = 2; p <= top; p++) {
      const cur = manualFirst.get(p);
      if (cur === undefined || d.date < cur) manualFirst.set(p, d.date);
    }
  }
  const ids = new Set<number>([...reaches.map((r) => r.id), ...manualFirst.keys()]);
  const out: PhaseFirstReachWithManual[] = [];
  for (const id of [...ids].sort((a, b) => a - b)) {
    const l = reaches.find((r) => r.id === id) ?? null;
    const m = manualFirst.get(id) ?? null;
    if (m !== null && (l === null || l.date === null || m < l.date)) {
      const before = pulls.filter((p) => p.date !== null && p.date < m);
      out.push({
        id,
        ms: before.reduce((a, p) => a + Math.max(0, p.durationMs), 0),
        pulls: before.length + manualPullsUpTo(manual, m, true),
        date: m,
        manual: "first",
      });
      continue;
    }
    if (l === null) continue;
    const add = l.date === null ? 0 : manualPullsUpTo(manual, l.date, false);
    out.push({ ...l, pulls: l.pulls + add, manual: add > 0 ? "partial" : null });
  }
  return out;
}
