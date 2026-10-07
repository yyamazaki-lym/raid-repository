/**
 * 練習ログの週のまとめ (2026-10-05、2026-10-01 全体精査 F-6 の C-4)。
 *
 * 1 週間の練習を 1 通に束ねて Discord に流す。中身は既存の集計の組み合わせ:
 *
 *   - 練習量: 練習日数 / pull 数 / ログ合計 (うち戦闘)。2026-10-07 に「実戦闘 (戦闘外 N%)」
 *     から変えた (実機要望。ログ合計は練習ログの「練習日数」の欄と同じ `totalLogMs`)
 *   - 到達 (W-4 進行トレンド): その週の最高到達と、前の週までの最高からの更新
 *   - 節目 (W-31 チーム実績 / L-1 層ごとの初討伐 / 絶の各フェーズへの初到達):
 *     その週に起きたものだけ
 *
 * ## 週の区切り
 *
 * FF14 の週制限 (火曜 17:00 JST リセット) に合わせ、**練習日 (`session_date`)
 * の火〜月**を 1 週とする。固定の活動は夜なので、火曜の夜の練習は新しい週に
 * 入る。送るのは火曜 04:00 JST の同期 (`/api/cron/fflogs-sync`) のあとで、
 * そこまでに月曜の夜の練習が取り込まれている。取りこぼしたとき (同期の失敗・
 * 時間切れ) のために水・木も送り直してよい日にする — 送ったかどうかは
 * `app_settings` の印 (送った週の開始日) で見る。
 *
 * ## 既定 OFF
 *
 * 練習ログの通知 (W-35) の 4 つ目の種類として足す (`logs-notify.ts`)。
 * 通知はすべて既定 OFF の方針どおり、管理者が ON にしたときだけ送る。
 *
 * `@/` を import しない純モジュール (`scripts/check-logs-weekly-summary.mjs`)。
 */
import { firstPhaseReaches } from "./fflogs-fight-detail";
import {
  fightDate,
  floorLabel,
  formatPercentage,
  isClearFight,
  totalLogMs,
  unionLengthMs,
  type FightRow,
  type FloorMap,
  type ProgressLocale,
} from "./fflogs-progress";
import { floorFirstClears } from "./fflogs-session";
import { countedPulls } from "./fflogs-duplicate-pulls";

/** 送ってよい日の数 (火曜から数えて。火・水・木)。 */
export const WEEKLY_SUMMARY_DUE_DAYS = 3;

/** 1 週 = 練習日の火〜月 (両端を含む、`YYYY-MM-DD`)。 */
export type RaidWeek = { start: string; end: string };

const DAY_MS = 24 * 60 * 60 * 1000;
const TUESDAY = 2;

function ymdToUtcMs(ymd: string): number {
  return Date.parse(`${ymd}T00:00:00Z`);
}
function utcMsToYmd(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * `todayJst` (JST の暦日) より前に終わった、直近の週 (火〜月)。
 * 火曜なら前日の月曜で終わる週、水曜なら 2 日前の月曜で終わる週。
 */
export function latestCompletedRaidWeek(todayJst: string): RaidWeek {
  const today = ymdToUtcMs(todayJst);
  const weekday = new Date(today).getUTCDay();
  // 今日から見て直近の火曜 (今日が火曜なら今日) の前日 = 終わった週の月曜。
  const daysSinceTuesday = (weekday - TUESDAY + 7) % 7;
  const end = today - (daysSinceTuesday + 1) * DAY_MS;
  return { start: utcMsToYmd(end - 6 * DAY_MS), end: utcMsToYmd(end) };
}

/** `todayJst` が週のまとめを送ってよい日 (火・水・木) か。 */
export function isWeeklySummaryDue(todayJst: string): boolean {
  const weekday = new Date(ymdToUtcMs(todayJst)).getUTCDay();
  return (weekday - TUESDAY + 7) % 7 < WEEKLY_SUMMARY_DUE_DAYS;
}

/** 到達。区間は零式なら層 index、絶ならフェーズ。区間の概念が無ければ null。 */
export type WeeklyReach = {
  segment: number | null;
  /** その区間での最小の残 HP%。討伐していれば 0。 */
  percentage: number | null;
  /** その区間を討伐したか。 */
  cleared: boolean;
};

export type WeeklySummary = {
  week: RaidWeek;
  days: number;
  pulls: number;
  /**
   * 実戦闘時間 (ms)。pull の区間の和集合 (同じ時間帯の pull を 2 本のログで
   * 上げても 1 回)。`logMs` を超えない。
   */
  fightMs: number;
  /**
   * ログ合計 (ms、2026-10-07)。練習ログの「練習日数」の欄と同じ `totalLogMs`
   * (各ログの開始 (最初の pull の 30 分前まで) 〜 最後の pull の終わり、重なりは
   * 1 回)。pull の間の休憩を含む。
   */
  logMs: number;
  /** その週の最高到達。 */
  best: WeeklyReach | null;
  /** 前の週までの最高到達 (前の週までに pull が無ければ null)。 */
  bestBefore: WeeklyReach | null;
  /** 前の週までの最高を超えたか (前の週までが無ければ false)。 */
  improved: boolean;
  /** 前の週までに討伐 (最終層 / 絶) があるか。消化の時期は到達の行を出さない。 */
  clearedBefore: boolean;
  /** その週の討伐 (最終層 / 絶) の回数。 */
  clears: number;
  /** そのうち死亡数 0 の回数 (死亡数が取れているものだけ)。 */
  flawlessClears: number;
  /** その週に初討伐したならその日。 */
  firstClearDate: string | null;
  /** その週に初めて越えた区間 (零式: 最終層以外の層の初突破 / 絶: フェーズの初到達)。 */
  milestones: Array<{ label: string; date: string | null }>;
};

function segmentOf(f: FightRow, floors: FloorMap, phaseModel: boolean): number | null {
  if (floors) return f.encounterId !== null ? (floors.byEncounter.get(f.encounterId) ?? null) : null;
  return phaseModel ? f.lastPhase : null;
}

/**
 * 最高到達。区間の最大を取り、その区間の pull だけで残 HP% の最小を出す
 * (`summarize` の `bestPercentageOf` と同じ考え方 — 下の区間の討伐 = 0% を
 * 混ぜると数字が意味を失う)。
 */
export function bestReach(
  fights: ReadonlyArray<FightRow>,
  floors: FloorMap,
  phaseModel: boolean,
): WeeklyReach | null {
  if (fights.length === 0) return null;
  const segs = fights.map((f) => segmentOf(f, floors, phaseModel));
  const known = segs.filter((s): s is number => s !== null);
  const top = known.length > 0 ? Math.max(...known) : null;
  const scope = top === null ? fights : fights.filter((_, i) => segs[i] === top);
  let percentage: number | null = null;
  let cleared = false;
  for (const f of scope) {
    const p = f.kill ? 0 : f.fightPercentage;
    if (f.kill) cleared = true;
    if (p === null || !Number.isFinite(p)) continue;
    if (percentage === null || p < percentage) percentage = p;
  }
  return { segment: top, percentage, cleared };
}

/**
 * `a` が `b` より先まで進んでいるか (区間が深い、同じ区間なら残 HP% が低い)。
 * 討伐は `bestReach` が残 0% として入れるので、残 HP% の比較に含まれる。
 */
export function isReachAhead(a: WeeklyReach, b: WeeklyReach): boolean {
  if (a.segment !== null && (b.segment === null || a.segment > b.segment)) return true;
  if (a.segment !== b.segment) return false;
  return a.percentage !== null && (b.percentage === null || a.percentage < b.percentage);
}

/**
 * 1 カテゴリの週のまとめ。その週に pull が無ければ null (送らない)。
 *
 * `fights` はそのカテゴリの全 pull (層クラスタ外は呼び出し側で除いておく)。
 * 週より後の pull (水・木に送るときの火曜以降の練習) は見ない。
 */
export function summarizeWeek(
  fights: ReadonlyArray<FightRow>,
  week: RaidWeek,
  floors: FloorMap,
  phaseModel: boolean,
  locale: ProgressLocale = "ja",
): WeeklySummary | null {
  const inWeekOf = (list: ReadonlyArray<FightRow>) =>
    list.filter((f) => fightDate(f) >= week.start && fightDate(f) <= week.end);
  // 2026-10-07 C-3: 同じ夜を 2 人が上げたログの同じ pull は 1 回だけ数える
  // (練習ログの画面と同じ `fflogs-duplicate-pulls.ts`)。ログ合計と戦闘時間は
  // 区間の和集合なので全 pull のまま渡す (数えない側のレポートの開始も入れる)。
  const counted = countedPulls(fights);
  const upToEnd = counted.filter((f) => fightDate(f) <= week.end);
  const inWeek = upToEnd.filter((f) => fightDate(f) >= week.start);
  if (inWeek.length === 0) return null;
  const inWeekAll = inWeekOf(fights);
  const before = upToEnd.filter((f) => fightDate(f) < week.start);

  const byDay = new Map<string, FightRow[]>();
  for (const f of inWeek) {
    const d = fightDate(f);
    byDay.set(d, [...(byDay.get(d) ?? []), f]);
  }
  // 2026-10-07: 戦闘時間も pull の区間の和集合で出す。同じ夜を 2 人がログに
  // 取ると pull が 2 本ずつ入り、単純に足すと「ログ合計 (和集合)」より
  // 「うち戦闘」が長くなって文面が矛盾する (PR のレビューで検出)。
  const fightMs = unionLengthMs(inWeekAll.map((f) => ({ start: f.startMs, end: f.endMs })));
  // 週の pull をまとめて渡す (日ごとに出して足すと、日をまたいだログの開始が
  // 両方の日に入って二重になる)。
  const logMs = totalLogMs(inWeekAll);

  const best = bestReach(inWeek, floors, phaseModel);
  const bestBefore = bestReach(before, floors, phaseModel);
  const isClear = (f: FightRow) => isClearFight(f, floors);
  const clearedBefore = before.some(isClear);
  const weekClears = inWeek.filter(isClear).sort((a, b) => a.startMs - b.startMs);

  const milestones: WeeklySummary["milestones"] = [];
  const inThisWeek = (d: string | null) => d !== null && d >= week.start && d <= week.end;
  if (floors) {
    const finalIndex = floors.byEncounter.get(floors.finalEncounterId) ?? null;
    const perFloor = floorFirstClears(
      upToEnd.flatMap((f) => {
        const idx = segmentOf(f, floors, false);
        return idx === null
          ? []
          : [{ startMs: f.startMs, endMs: f.endMs, kill: f.kill, floorIndex: idx, sessionDate: fightDate(f) }];
      }),
    );
    for (const c of perFloor) {
      if (c.index === finalIndex || !inThisWeek(c.date)) continue;
      milestones.push({ label: floorLabel(floors, c.index, locale), date: c.date });
    }
  } else if (phaseModel) {
    const reaches = firstPhaseReaches(
      upToEnd.map((f) => ({
        startMs: f.startMs,
        durationMs: Math.max(0, f.endMs - f.startMs),
        reachedPhase: f.lastPhase,
        date: fightDate(f),
      })),
    );
    for (const r of reaches) {
      if (!inThisWeek(r.date)) continue;
      milestones.push({ label: `P${r.id}`, date: r.date });
    }
  }

  return {
    week,
    days: byDay.size,
    pulls: inWeek.length,
    fightMs,
    logMs,
    best,
    bestBefore,
    improved: best !== null && bestBefore !== null && isReachAhead(best, bestBefore),
    clearedBefore,
    clears: weekClears.length,
    flawlessClears: weekClears.filter((f) => f.deaths === 0).length,
    firstClearDate: !clearedBefore && weekClears.length > 0 ? fightDate(weekClears[0]!) : null,
    milestones,
  };
}

const WEEKDAY_JA = ["日", "月", "火", "水", "木", "金", "土"];

/** `2026-09-29` → `9/29(火)`。 */
export function formatMonthDay(ymd: string): string {
  const d = new Date(ymdToUtcMs(ymd));
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${WEEKDAY_JA[d.getUTCDay()]})`;
}

/** 時間の長さ (ms) を `6時間12分` / `45分` に。 */
export function formatHoursMinutes(ms: number): string {
  const totalMin = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}時間${m}分` : `${m}分`;
}

/** 到達の表示 (`P5 残23.4%` / `4層前半 CLEAR` / `残12.0%`)。 */
export function formatReach(reach: WeeklyReach, floors: FloorMap, phaseModel: boolean): string {
  const segment =
    reach.segment === null ? "" : floors ? floorLabel(floors, reach.segment, "ja") : phaseModel ? `P${reach.segment}` : "";
  const result = reach.cleared
    ? "CLEAR"
    : reach.percentage !== null
      ? `残${formatPercentage(reach.percentage)}`
      : "";
  return [segment, result].filter((s) => s.length > 0).join(" ");
}

/**
 * 1 カテゴリ分の投稿文。Discord の投稿は日本語固定の運用 (`cron-status.ts`
 * と同じ)。メンションは送る側で止める (`allowed_mentions: { parse: [] }`)。
 */
export function formatWeeklySummaryMessage(input: {
  categoryName: string;
  summary: WeeklySummary;
  floors: FloorMap;
  phaseModel: boolean;
  /** 練習ログへの絶対 URL (空なら省く)。 */
  url?: string | null;
}): string {
  const { summary: s, floors, phaseModel } = input;
  const lines = [
    `📅 **週のまとめ** ${formatMonthDay(s.week.start)}〜${formatMonthDay(s.week.end)}`,
    // 2026-10-07: 「実戦闘 (戦闘外 N%)」から「ログ合計 (うち戦闘)」へ (実機要望)。
    `**${input.categoryName}** — 練習 ${s.days} 日 / ${s.pulls} pull / ログ合計 ${formatHoursMinutes(s.logMs)}` +
      ` (うち戦闘 ${formatHoursMinutes(s.fightMs)})`,
  ];
  // 消化の時期 (前の週までに討伐済み) は到達が毎週「CLEAR」で情報にならない。
  if (!s.clearedBefore && s.best) {
    const reach = formatReach(s.best, floors, phaseModel);
    if (reach) {
      lines.push(
        `・最高到達: ${reach}` +
          (s.improved && s.bestBefore
            ? ` (前の週までの ${formatReach(s.bestBefore, floors, phaseModel) || "記録"} から更新)`
            : ""),
      );
    }
  }
  if (s.milestones.length > 0) {
    const kind = floors ? "初突破" : "初到達";
    lines.push(
      `・${kind}: ` +
        s.milestones.map((x) => (x.date ? `${x.label} (${formatMonthDay(x.date)})` : x.label)).join(" / "),
    );
  }
  if (s.firstClearDate) lines.push(`・🏆 初討伐 (${formatMonthDay(s.firstClearDate)})`);
  if (s.clears > 0) {
    lines.push(
      `・討伐 ${s.clears} 回` + (s.flawlessClears > 0 ? ` (ノーデス ${s.flawlessClears} 回)` : ""),
    );
  }
  if (input.url) lines.push(input.url);
  return lines.join("\n");
}
