/**
 * FF14 の週制限 (火曜 08:00 UTC = JST 17:00 リセット) を扱うヘルパー。
 * TODO #94 / A-4 の「今週の消化チェック」で使う。
 *
 * `jst-date.ts` は「JST の暦日」を扱うのに対し、こちらは「週制限の週」を
 * 扱う。両者は別概念なので分離している (火曜 12:00 JST は暦日としては
 * 火曜だが、週制限としてはまだ前週)。
 *
 * 週の識別子は **その週のリセットが起きた火曜の JST 暦日** (`YYYY-MM-DD`)。
 * DB では `loot_weekly_checks.week_start date` に入る。
 */

/** 週制限のリセットは毎週火曜 08:00 UTC (JST 17:00)。DST は無い。 */
const RESET_WEEKDAY_UTC = 2; // 0=Sun … 2=Tue
const RESET_HOUR_UTC = 8;

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function ymdString(utcMs: number): string {
  // JST 暦日に直してから文字列化 (リセット直後の火曜 17:00 JST を火曜として扱う)。
  const d = new Date(utcMs + JST_OFFSET_MS);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * `at` が属する週制限の週の開始 (= 直近のリセット時刻) を UTC ミリ秒で返す。
 */
export function weeklyResetStartMs(at: Date = new Date()): number {
  const ms = at.getTime();
  const d = new Date(ms);
  // 直近の火曜 08:00 UTC を求める。
  const daysSinceTue = (d.getUTCDay() - RESET_WEEKDAY_UTC + 7) % 7;
  const candidate = Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate() - daysSinceTue,
    RESET_HOUR_UTC,
    0,
    0,
    0,
  );
  // 火曜 08:00 UTC より前なら 1 週間戻す。
  return candidate <= ms ? candidate : candidate - 7 * DAY_MS;
}

/**
 * `at` が属する週の識別子 (`YYYY-MM-DD`、その週のリセット日 = 火曜)。
 * DB の `week_start` にそのまま入れる値。
 */
export function currentWeekStart(at: Date = new Date()): string {
  return ymdString(weeklyResetStartMs(at));
}

/** 次のリセット時刻 (UTC ミリ秒)。 */
export function nextWeeklyResetMs(at: Date = new Date()): number {
  return weeklyResetStartMs(at) + 7 * DAY_MS;
}

/** 次のリセットまでの残り時間を「あと N日 M時間」形式で返す。 */
export function formatUntilNextReset(at: Date = new Date()): string {
  const remain = nextWeeklyResetMs(at) - at.getTime();
  if (remain <= 0) return "まもなくリセット";
  const days = Math.floor(remain / DAY_MS);
  const hours = Math.floor((remain % DAY_MS) / (60 * 60 * 1000));
  if (days > 0) return `あと ${days}日 ${hours}時間`;
  const minutes = Math.floor((remain % (60 * 60 * 1000)) / 60000);
  return `あと ${hours}時間 ${minutes}分`;
}

/** 週の表示ラベル (例: `8/25(火) 17:00 〜`)。 */
export function formatWeekLabel(weekStart: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(weekStart);
  if (!m) return weekStart;
  const [, y, mo, d] = m;
  const wd = ["日", "月", "火", "水", "木", "金", "土"][
    new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d))).getUTCDay()
  ];
  return `${Number(mo)}/${Number(d)}(${wd}) 17:00 〜`;
}

/** `week_start` として妥当な `YYYY-MM-DD` かどうか (Server Action 入口検証用)。 */
export function isWeekStartString(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
}
