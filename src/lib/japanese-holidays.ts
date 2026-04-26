/**
 * Japanese national-holiday detector.
 *
 * Strategy:
 *   1. Server-side `fetchJapaneseHolidays()` pulls the public JSON
 *      from holidays-jp.github.io (~ Cabinet Office data, well-maintained,
 *      auto-updates with new years + Cabinet announcements). Cached
 *      24 hours via Next.js fetch revalidate, so no per-request cost.
 *   2. If that fetch fails (network down, GitHub Pages outage), we fall
 *      back to a hardcoded table covering 2024 〜 2028 so the UI doesn't
 *      lose holiday colors entirely.
 *
 * Consumers (server pages) call `fetchJapaneseHolidays()` and pass the
 * resulting Set down to client components, which use the synchronous
 * `isJapaneseHoliday(date, holidays?)` to color rows.
 */

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * Set of `YYYY-MM-DD` strings (in JST) for every Japanese national
 * holiday + substitute holiday.
 *
 * Sources: Cabinet Office of Japan, National Astronomical Observatory
 * of Japan (for equinoxes — published 1 year ahead).
 */
const HOLIDAYS: Set<string> = new Set([
  // ---------- 2024 ----------
  "2024-01-01", // 元日
  "2024-01-08", // 成人の日
  "2024-02-11", // 建国記念の日
  "2024-02-12", // 振替休日
  "2024-02-23", // 天皇誕生日
  "2024-03-20", // 春分の日
  "2024-04-29", // 昭和の日
  "2024-05-03", // 憲法記念日
  "2024-05-04", // みどりの日
  "2024-05-05", // こどもの日
  "2024-05-06", // 振替休日
  "2024-07-15", // 海の日
  "2024-08-11", // 山の日
  "2024-08-12", // 振替休日
  "2024-09-16", // 敬老の日
  "2024-09-22", // 秋分の日
  "2024-09-23", // 振替休日
  "2024-10-14", // スポーツの日
  "2024-11-03", // 文化の日
  "2024-11-04", // 振替休日
  "2024-11-23", // 勤労感謝の日

  // ---------- 2025 ----------
  "2025-01-01", // 元日
  "2025-01-13", // 成人の日
  "2025-02-11", // 建国記念の日
  "2025-02-23", // 天皇誕生日
  "2025-02-24", // 振替休日
  "2025-03-20", // 春分の日
  "2025-04-29", // 昭和の日
  "2025-05-03", // 憲法記念日
  "2025-05-04", // みどりの日
  "2025-05-05", // こどもの日
  "2025-05-06", // 振替休日
  "2025-07-21", // 海の日
  "2025-08-11", // 山の日
  "2025-09-15", // 敬老の日
  "2025-09-23", // 秋分の日
  "2025-10-13", // スポーツの日
  "2025-11-03", // 文化の日
  "2025-11-23", // 勤労感謝の日
  "2025-11-24", // 振替休日

  // ---------- 2026 ----------
  "2026-01-01", // 元日
  "2026-01-12", // 成人の日
  "2026-02-11", // 建国記念の日
  "2026-02-23", // 天皇誕生日
  "2026-03-20", // 春分の日
  "2026-04-29", // 昭和の日
  "2026-05-03", // 憲法記念日
  "2026-05-04", // みどりの日
  "2026-05-05", // こどもの日
  "2026-05-06", // 振替休日
  "2026-07-20", // 海の日
  "2026-08-11", // 山の日
  "2026-09-21", // 敬老の日
  "2026-09-22", // 国民の休日 (between two adjacent holidays)
  "2026-09-23", // 秋分の日
  "2026-10-12", // スポーツの日
  "2026-11-03", // 文化の日
  "2026-11-23", // 勤労感謝の日

  // ---------- 2027 ----------
  "2027-01-01", // 元日
  "2027-01-11", // 成人の日
  "2027-02-11", // 建国記念の日
  "2027-02-23", // 天皇誕生日
  "2027-03-21", // 春分の日
  "2027-03-22", // 振替休日
  "2027-04-29", // 昭和の日
  "2027-05-03", // 憲法記念日
  "2027-05-04", // みどりの日
  "2027-05-05", // こどもの日
  "2027-07-19", // 海の日
  "2027-08-11", // 山の日
  "2027-09-20", // 敬老の日
  "2027-09-23", // 秋分の日
  "2027-10-11", // スポーツの日
  "2027-11-03", // 文化の日
  "2027-11-23", // 勤労感謝の日

  // ---------- 2028 ----------
  "2028-01-01", // 元日
  "2028-01-10", // 成人の日
  "2028-02-11", // 建国記念の日
  "2028-02-23", // 天皇誕生日
  "2028-03-20", // 春分の日
  "2028-04-29", // 昭和の日
  "2028-05-03", // 憲法記念日
  "2028-05-04", // みどりの日
  "2028-05-05", // こどもの日
  "2028-07-17", // 海の日
  "2028-08-11", // 山の日
  "2028-09-18", // 敬老の日
  "2028-09-22", // 秋分の日
  "2028-10-09", // スポーツの日
  "2028-11-03", // 文化の日
  "2028-11-23", // 勤労感謝の日
]);

/**
 * Format a Date as JST `YYYY-MM-DD`. Used internally so the table
 * lookup is timezone-stable regardless of where the server runs.
 */
function toJstYmd(date: Date): string {
  const jst = new Date(date.getTime() + JST_OFFSET_MS);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(jst.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Server-side: fetch the latest Japanese-holiday list from the
 * public holidays-jp.github.io JSON. Returns a Set of `YYYY-MM-DD`
 * strings. Falls back to the hardcoded table on any failure.
 *
 * Cached for 24 hours via Next.js fetch revalidate — holiday data
 * changes only when the Cabinet announces a new year's calendar
 * (typically Feb of the prior year), so daily refresh is plenty.
 */
export async function fetchJapaneseHolidays(): Promise<Set<string>> {
  try {
    const res = await fetch(
      "https://holidays-jp.github.io/api/v1/date.json",
      {
        next: { revalidate: 86400 },
        headers: { "User-Agent": "RaidRepository/1.0" },
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!res.ok) return HOLIDAYS;
    const data = (await res.json()) as Record<string, string>;
    const keys = Object.keys(data);
    if (keys.length === 0) return HOLIDAYS;
    return new Set(keys);
  } catch {
    return HOLIDAYS;
  }
}

/**
 * Returns true when the date (in JST) is a Japanese national holiday.
 *
 * @param holidays  Pre-fetched holidays Set (from `fetchJapaneseHolidays()`).
 *                  Pass `undefined` to fall back to the hardcoded table.
 *                  Accepts an array too, for ease of prop passing across
 *                  the server/client boundary where Set isn't always
 *                  reliably serialized.
 */
export function isJapaneseHoliday(
  date: Date,
  holidays?: Set<string> | readonly string[],
): boolean {
  const ymd = toJstYmd(date);
  if (Array.isArray(holidays)) return holidays.includes(ymd);
  if (holidays instanceof Set) return holidays.has(ymd);
  return HOLIDAYS.has(ymd);
}
