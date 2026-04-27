/**
 * Heuristic for detecting "this video documents a clear" from its title.
 *
 * Used in:
 *   - Manual link creation (browser-side), to auto-fill `categories.first_clear_at`
 *   - Discord import (server-side), same purpose
 *   - The first-clear backfill server action that rebuilds from existing videos
 *
 * 1.9.16 made this category-aware:
 *   - Ultimate (絶 / `ultimate`): single fight, simple clear keyword is enough
 *   - 4-person content (Criterion / Variant): single fight, simple keyword
 *   - Savage tier (P1-4S, P5-8S, ..., M1-4S, M5-8S, ...): require "4 層"
 *     (or equivalent final-floor token) AND the clear keyword. A "1層クリア"
 *     should NOT mark the tier as cleared.
 *
 * The matcher is deliberately simple — false positives are recoverable
 * (the user can clear the field via the category edit dialog), and false
 * negatives just mean a manual edit is needed. We exclude "未クリア" since
 * that's the one common Japanese token where "クリア" appears without
 * actually meaning a clear happened.
 */

/** Returns true if the text contains a generic "cleared" keyword. */
function hasClearKeyword(title: string): boolean {
  if (title.includes("未クリア")) return false;
  if (title.includes("クリア")) return true;
  if (/\bclear(ed)?\b/i.test(title)) return true;
  return false;
}

/** Returns true if the text contains a "final floor" marker for Savage. */
function hasFinalFloorMarker(title: string): boolean {
  // Japanese: 「4層」「四層」「4 層」(with various separators)
  if (/4\s*層/.test(title)) return true;
  if (title.includes("四層")) return true;
  // FFXIV Savage final-fight IDs by tier:
  //   - P4S / P8S / P12S — Endwalker savage tiers
  //   - M4S / M8S — Arcadion savage tiers (current)
  if (/\b[pPmM](4|8|12)S\b/.test(title)) return true;
  if (/\b(P4S|P8S|P12S|M4S|M8S)\b/i.test(title)) return true;
  return false;
}

/**
 * Returns true if the category looks like an Ultimate (single fight,
 * no floor structure). Detected by the "絶" prefix in the Japanese
 * name or by an "ultimate" keyword in any name variant.
 */
function isUltimateCategory(categoryName: string | null | undefined): boolean {
  if (!categoryName) return false;
  if (categoryName.startsWith("絶")) return true;
  if (/ultimate/i.test(categoryName)) return true;
  return false;
}

/**
 * Returns true if the category is a 4-person Criterion / Variant
 * dungeon (single fight, no floor structure).
 */
function isFourPlayerSingleFightCategory(
  categoryName: string | null | undefined,
): boolean {
  if (!categoryName) return false;
  if (/criterion/i.test(categoryName)) return true;
  if (/variant/i.test(categoryName)) return true;
  return false;
}

/**
 * Generic clear-title check (no category context). Kept for backward
 * compat with callers that don't have category info handy. New code
 * should prefer `isClearTitleForCategory`.
 */
export function isClearTitle(title: string | null | undefined): boolean {
  if (!title) return false;
  return hasClearKeyword(title);
}

/**
 * Category-aware clear detection (1.9.16).
 *
 *   - Ultimate / 4-person single fight: simple clear keyword suffices.
 *   - Savage tier: require BOTH a final-floor marker (4層 / P4S /
 *     M8S etc.) AND a clear keyword. Avoids "1層クリア" / "3層クリア"
 *     prematurely setting the tier's first_clear_at.
 *
 * If `categoryName` is null/undefined, falls back to the simple
 * `isClearTitle` semantics so callers that haven't been migrated to
 * pass category info don't regress.
 */
export function isClearTitleForCategory(
  title: string | null | undefined,
  categoryName: string | null | undefined,
): boolean {
  if (!title) return false;
  if (!hasClearKeyword(title)) return false;
  // Ultimate / 4-person → keyword is enough.
  if (
    isUltimateCategory(categoryName) ||
    isFourPlayerSingleFightCategory(categoryName)
  ) {
    return true;
  }
  // Default (零式 Savage tiers AND any unclassified category): demand
  // the final-floor marker. Treating unclassified as "Savage-like" is
  // the conservative default — better to miss an auto-detect than to
  // mark a tier cleared after a stage-1 clear.
  return hasFinalFloorMarker(title);
}

/**
 * Returns true if the title looks like the user's FIRST-floor practice
 * for a Savage tier (e.g. "1層練習" / "P1S" / "M1S" / "M5S" — the
 * tier's entry floor). Used by the "みなしクリア時間" calc that
 * sums durations from the first-floor practice video onwards.
 *
 * For Ultimate / single-fight content there's no notion of "first
 * floor", so this returns false — callers should fall back to
 * `posted_at` of the earliest video for those categories.
 */
export function isFirstFloorPracticeTitle(
  title: string | null | undefined,
  categoryName: string | null | undefined,
): boolean {
  if (!title) return false;
  if (
    isUltimateCategory(categoryName) ||
    isFourPlayerSingleFightCategory(categoryName)
  ) {
    return false;
  }
  // Japanese: 「1層」「一層」
  if (/(?<!\d)1\s*層/.test(title)) return true;
  if (title.includes("一層")) return true;
  // English: "Floor 1" / "F1"
  if (/\bfloor\s*1\b/i.test(title)) return true;
  if (/\bF1\b/i.test(title)) return true;
  // Tier-specific entry-floor IDs:
  //   - Endwalker Savage: P1S, P5S, P9S
  //   - Arcadion Savage: M1S, M5S
  if (/\b(P1S|P5S|P9S|M1S|M5S)\b/i.test(title)) return true;
  return false;
}
