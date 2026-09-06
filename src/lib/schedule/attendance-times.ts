/**
 * 出欠の「遅刻 / 早退の予定時刻」(2026-09-06、調査ノート第 4 回 W-13) と
 * Discord のタイムスタンプ表記 (W-14) の純関数。client / server 共用。
 *
 * ○×△ だけでは「出るが 21:30 になる」「23:00 で抜ける」が表現できず、国内の
 * 固定で最も揉める「遅刻」が事前申告になっていなかった。記号はそのまま
 * (凡例マスターは admin が自由に編集できる) で、**到着予定 / 早退予定の
 * HH:MM を出欠行に添える** 形にする。
 */

/** HH:MM (0:00〜23:59)。先頭ゼロ無しも許容し、正規化で 2 桁に揃える。 */
export const ATTENDANCE_TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

export type AttendanceTimes = {
  /** 到着予定 (遅刻)。null = 予定どおり。 */
  arriveAt: string | null;
  /** 早退予定。null = 最後まで。 */
  leaveAt: string | null;
};

/**
 * 入力値を `HH:MM` に正規化する。空 / 不正は null。
 * `<input type="time">` は `HH:MM` (稀に `HH:MM:SS`) を返すので秒は落とす。
 */
export function normalizeAttendanceTime(
  raw: string | null | undefined,
): string | null {
  if (raw == null) return null;
  const s = raw.trim().replace(/^(\d{1,2}:\d{2}):\d{2}$/, "$1");
  if (!s) return null;
  const m = ATTENDANCE_TIME_RE.exec(s);
  if (!m) return null;
  return `${m[1]!.padStart(2, "0")}:${m[2]}`;
}

/** 表示用の短いヒント: `21:30〜` / `〜23:00` / `21:30〜23:00`。両方 null は null。 */
export function formatAttendanceTimesHint(
  times: AttendanceTimes | null | undefined,
): string | null {
  if (!times) return null;
  const a = times.arriveAt;
  const l = times.leaveAt;
  if (a && l) return `${a}〜${l}`;
  if (a) return `${a}〜`;
  if (l) return `〜${l}`;
  return null;
}

/** 読み上げ / title 用の説明: `到着予定 21:30 / 早退 23:00`。 */
export function describeAttendanceTimes(
  times: AttendanceTimes | null | undefined,
  locale: "ja" | "en" = "ja",
): string | null {
  if (!times) return null;
  const parts: string[] = [];
  if (times.arriveAt)
    parts.push(
      locale === "en" ? `arrives ${times.arriveAt}` : `到着予定 ${times.arriveAt}`,
    );
  if (times.leaveAt)
    parts.push(
      locale === "en" ? `leaves ${times.leaveAt}` : `早退 ${times.leaveAt}`,
    );
  return parts.length > 0 ? parts.join(" / ") : null;
}

/**
 * 「参加不可」を表す記号 (auto-confirm と同じ集合)。× のときは予定時刻を
 * 持たせない (不参加に到着予定は意味が無い)。
 */
const UNAVAILABLE_SYMBOLS = new Set(["×", "x", "X", "✕", "✖"]);
export function symbolAllowsTimes(symbol: string | null | undefined): boolean {
  const s = (symbol ?? "").trim();
  if (!s) return false;
  return !UNAVAILABLE_SYMBOLS.has(s);
}

/**
 * セッションの開始時刻を UNIX 秒 (JST 基準) で返す (W-14)。
 * `rawDate` は native / sync 共通の `YYYY/MM/DD(曜) HH:MM~HH:MM` (先頭の
 * 日付部分だけを使う。`YYYY-MM-DD` も許容)。`startTime` は `HH:MM`。
 * どちらかが解釈できなければ null (呼び出し側は表記を省略する)。
 */
export function sessionStartUnixSeconds(
  rawDate: string,
  startTime: string | null | undefined,
): number | null {
  const dm = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/.exec(rawDate.trim());
  if (!dm) return null;
  const time = normalizeAttendanceTime(startTime);
  if (!time) return null;
  const [hh, mm] = time.split(":").map((v) => Number.parseInt(v, 10));
  const y = Number.parseInt(dm[1]!, 10);
  const mo = Number.parseInt(dm[2]!, 10);
  const d = Number.parseInt(dm[3]!, 10);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  // JST (UTC+9) の壁時計を UTC エポックへ。Date.UTC は月が 0 起点。
  const ms = Date.UTC(y, mo - 1, d, hh! - 9, mm!, 0, 0);
  if (!Number.isFinite(ms)) return null;
  return Math.floor(ms / 1000);
}

/**
 * Discord のタイムスタンプ表記。閲覧者のタイムゾーンとロケールで描画される
 * (`<t:unix:F>` = 曜日込みの日時、`<t:unix:R>` = 「3 時間後」などの相対)。
 * unix が null なら空文字 (テンプレートの placeholder がそのまま消える)。
 */
export function discordTimestamp(
  unix: number | null,
  style: "F" | "R" | "t" | "f" = "F",
): string {
  if (unix === null || !Number.isFinite(unix)) return "";
  return `<t:${Math.floor(unix)}:${style}>`;
}

/**
 * 開始までの残り時間ラベル (Web のカウントダウン用)。開始済み / 24 時間より
 * 先は null (カードの「本日 / 明日 / あと N 日」表記に任せる)。
 */
export function formatCountdown(
  startMs: number,
  nowMs: number,
  locale: "ja" | "en" = "ja",
): string | null {
  const diff = startMs - nowMs;
  if (diff <= 0) return null;
  if (diff > 24 * 60 * 60 * 1000) return null;
  const totalMin = Math.ceil(diff / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (locale === "en") {
    if (h === 0) return `starts in ${m} min`;
    if (m === 0) return `starts in ${h} h`;
    return `starts in ${h} h ${m} min`;
  }
  if (h === 0) return `開始まで ${m} 分`;
  if (m === 0) return `開始まで ${h} 時間`;
  return `開始まで ${h} 時間 ${m} 分`;
}
