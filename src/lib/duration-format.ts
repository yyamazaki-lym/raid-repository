/**
 * Shared duration / clear-date formatting helpers.
 *
 * Used in the category list view (cumulative practice time, time-to-clear,
 * first-clear date badges) and on the per-category videos page (header
 * stats). Extracted to a module so the same labels show up consistently
 * everywhere.
 */

/**
 * Compact duration label. Designed for tight badge layouts.
 *   <60m: `42m`
 *   ≥1h:  `12h`, `12h30m`
 *   ≥100h: `120h` (drop the minutes once total dwarfs them)
 */
export function formatDurationShort(seconds: number): string {
  const totalMinutes = Math.floor(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (hours >= 100) return `${hours}h`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h${minutes}m`;
}

/** Verbose duration for hover tooltips — Japanese readable form. */
export function formatDurationLong(seconds: number): string {
  const totalMinutes = Math.floor(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}分`;
  if (minutes === 0) return `${hours}時間`;
  return `${hours}時間${minutes}分`;
}

/**
 * Format the first-clear timestamp:
 *   "short" → `25/12/15` (YY/M/D in local TZ — 1.9.17 added the year
 *               so users can disambiguate clears from different years
 *               at a glance, since the badge is otherwise tiny)
 *   "long"  → `2025-12-15 (月)` for hover tooltip
 */
export function formatFirstClear(iso: string, mode: "short" | "long"): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  if (mode === "short") {
    const yy = String(d.getFullYear()).slice(-2);
    return `${yy}/${d.getMonth() + 1}/${d.getDate()}`;
  }
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const wd = ["日", "月", "火", "水", "木", "金", "土"][d.getDay()];
  return `${y}-${m}-${day} (${wd})`;
}
