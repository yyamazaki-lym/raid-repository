/**
 * Extract a calendar date (Y/M/D) from a video title.
 *
 * Most users include the raid date in the title (例: 「【2026 04 01】」、
 * 「2026/04/01」、"20260401"、「4月1日」、「4/1」). Title-extracted dates
 * are FAR more reliable than `posted_at` (the upload time, often days
 * later than the actual raid) for date-keyed operations like:
 *   - FFLogs auto-link matching
 *   - first_clear_at backfill
 *   - "time to clear" duration aggregation
 *
 * Year-explicit formats (YYYY MM DD) are matched first since they're
 * unambiguous. Year-less formats fall back to `fallbackYear` (typically
 * the year of the video's posted_at or the current year).
 *
 * Returns null when no date can be inferred from the title.
 *
 * 1.9.17: extracted from `@/lib/server/fflogs.ts` so the same regex
 * suite is available to non-FFLogs code paths (clear-date backfill,
 * etc).
 */
export function extractDateFromTitle(
  title: string | null | undefined,
  fallbackYear?: number,
): { y: number; m: number; d: number } | null {
  if (!title) return null;
  const validate = (y: number, m: number, d: number) =>
    m >= 1 && m <= 12 && d >= 1 && d <= 31;

  // Year-explicit: 「2026 04 01」「2026/04/01」「2026-04-01」「2026年4月1日」
  const yexp = title.match(
    /(20\d{2})[\s年\/\-.](\d{1,2})[\s月\/\-.](\d{1,2})/,
  );
  if (yexp) {
    const y = parseInt(yexp[1]!, 10);
    const m = parseInt(yexp[2]!, 10);
    const d = parseInt(yexp[3]!, 10);
    if (validate(y, m, d)) return { y, m, d };
  }
  // Compact 8-digit: "20260401"
  const c8 = title.match(/(?<!\d)(20\d{2})(\d{2})(\d{2})(?!\d)/);
  if (c8) {
    const y = parseInt(c8[1]!, 10);
    const m = parseInt(c8[2]!, 10);
    const d = parseInt(c8[3]!, 10);
    if (validate(y, m, d)) return { y, m, d };
  }

  // Year-less patterns need context.
  if (fallbackYear === undefined) return null;

  // Japanese: 「4月1日」「04月01日」
  const jp = title.match(/(?<!\d)(\d{1,2})月\s*(\d{1,2})日/);
  if (jp) {
    const m = parseInt(jp[1]!, 10);
    const d = parseInt(jp[2]!, 10);
    if (validate(fallbackYear, m, d)) return { y: fallbackYear, m, d };
  }

  // Slash: "4/1" or "04/01" — boundary ensures we don't match parts of
  // longer numeric tokens like "1080/120".
  const slash = title.match(/(?<![\d\/])(\d{1,2})\/(\d{1,2})(?![\d\/])/);
  if (slash) {
    const m = parseInt(slash[1]!, 10);
    const d = parseInt(slash[2]!, 10);
    if (validate(fallbackYear, m, d)) return { y: fallbackYear, m, d };
  }

  // Compact 4-digit: "0401" — risky, only inside 【...】 or [...] to
  // avoid matching things like "1080" (resolution) or other 4-digit
  // numbers.
  const c4Bracket = title.match(/[【\[]\s*(\d{2})(\d{2})\s*[】\]]/);
  if (c4Bracket) {
    const m = parseInt(c4Bracket[1]!, 10);
    const d = parseInt(c4Bracket[2]!, 10);
    if (validate(fallbackYear, m, d)) return { y: fallbackYear, m, d };
  }

  return null;
}

/**
 * Convert an extracted title-date to an ISO 8601 timestamp.
 *
 * The returned moment is set to **22:00 JST** (the typical raid hour)
 * so it sorts naturally alongside `posted_at` ISO strings without
 * accidentally landing in the previous JST day. The hour-of-day choice
 * is unimportant for date-only comparisons but matters when ordering
 * mixed [titleDate / postedAt] timestamps.
 *
 * Returns null if the title has no parseable date.
 */
export function titleDateToIso(
  title: string | null | undefined,
  fallbackYear?: number,
): string | null {
  const d = extractDateFromTitle(title, fallbackYear);
  if (!d) return null;
  // 22:00 JST = 13:00 UTC
  return new Date(Date.UTC(d.y, d.m - 1, d.d, 13, 0, 0)).toISOString();
}
