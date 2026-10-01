/**
 * FFLogs のレポート一覧 (HTML) に出る英語の日付を読む (純関数)。
 *
 * `extractTimestampMs` (src/lib/server/fflogs.ts) の候補 2「English visible
 * date (Month D, YYYY)」は、これまで `Date.parse(text + " +0900")` に任せて
 * いた。V8 の旧来の日付パーサは**時刻の無い形** (`April 17, 2026 +0900`) を
 * 読めずに NaN を返すので、時刻の無い英語の日付は**黙って候補から落ちて**
 * いた (時刻つきの `April 17, 2026 12:33 AM +0900` は読める。Node 24 で実測)。
 * 処理系の解釈に頼らず、月名・日・年・時刻をここで明示的に読む。
 *
 * 読む形 (呼び出し側の正規表現が切り出す文字列):
 *
 *   - `April 17, 2026` / `Apr 17, 2026` — 時刻なし → その日の 00:00
 *   - `April 17, 2026 9:05 PM` / `12:33 AM` — 12 時間制
 *   - `April 17, 2026 21:05` — 24 時間制 (AM/PM なし)
 *
 * 時刻はページを見た人の壁時計として扱い、`offsetIso` (例 `+09:00`) を付けて
 * 解釈する (他の候補と同じく、アプリの基準タイムゾーンで読む)。存在しない日付
 * (2 月 30 日など) や範囲外の時刻は null (他の候補に任せる)。
 *
 * `@/` を import しない純モジュール (scripts/check-fflogs-scrape-date.mjs)。
 */

const MONTHS: Record<string, number> = {
  january: 1, jan: 1,
  february: 2, feb: 2,
  march: 3, mar: 3,
  april: 4, apr: 4,
  may: 5,
  june: 6, jun: 6,
  july: 7, jul: 7,
  august: 8, aug: 8,
  september: 9, sep: 9, sept: 9,
  october: 10, oct: 10,
  november: 11, nov: 11,
  december: 12, dec: 12,
};

const ENGLISH_DATE_RE =
  /^([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})(?:\s+(\d{1,2}):(\d{2})\s*(AM|PM)?)?$/i;

const OFFSET_RE = /^[+-]\d{2}:\d{2}$/;

/** 英語の日付を UTC ms に。読めなければ null。 */
export function parseEnglishVisibleDate(
  text: string,
  offsetIso: string,
): number | null {
  if (!OFFSET_RE.test(offsetIso)) return null;
  const m = ENGLISH_DATE_RE.exec(text.trim());
  if (!m) return null;
  const month = MONTHS[m[1]!.toLowerCase()];
  if (!month) return null;
  const day = Number(m[2]);
  const year = Number(m[3]);
  let hour = m[4] === undefined ? 0 : Number(m[4]);
  const minute = m[5] === undefined ? 0 : Number(m[5]);
  const meridiem = m[6]?.toUpperCase();
  if (meridiem) {
    // 12 時間制: 1〜12 時だけ。12 AM = 0 時、12 PM = 12 時。
    if (hour < 1 || hour > 12) return null;
    if (meridiem === "AM") hour = hour === 12 ? 0 : hour;
    else hour = hour === 12 ? 12 : hour + 12;
  } else if (hour > 23) {
    return null;
  }
  if (minute > 59) return null;
  // 存在しない日 (2 月 30 日など) は Date.UTC が翌月へ繰り上げるので、
  // 往復して一致するかで弾く。
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  const ms = Date.parse(
    `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00${offsetIso}`,
  );
  return Number.isFinite(ms) ? ms : null;
}
