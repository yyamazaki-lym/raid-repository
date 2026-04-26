/**
 * Heuristic for detecting "this video documents a clear" from its title.
 *
 * Used in two places:
 *   - Manual link creation (browser-side), to auto-fill `categories.first_clear_at`
 *   - Discord import (server-side), same purpose
 *
 * The matcher is deliberately simple — false positives are recoverable
 * (the user can clear the field via the category edit dialog), and false
 * negatives just mean a manual edit is needed. We exclude "未クリア" since
 * that's the one common Japanese token where "クリア" appears without
 * actually meaning a clear happened.
 *
 * NB: `\bclear\b` matches the English word boundary form so titles like
 * "Sephirot Ex Clear" trigger but "clearance" / "unclear" don't.
 */
export function isClearTitle(title: string | null | undefined): boolean {
  if (!title) return false;
  // Explicit negative — "未クリア" (not yet cleared) is the most common
  // false-positive token.
  if (title.includes("未クリア")) return false;
  // Japanese: any occurrence of クリア counts.
  if (title.includes("クリア")) return true;
  // English: word "clear" (case-insensitive).
  if (/\bclear\b/i.test(title)) return true;
  return false;
}
