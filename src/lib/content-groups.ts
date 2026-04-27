/**
 * Bilingual content classifier for FFXIV raids / tiers.
 *
 * Originally lived in `@/lib/server/fflogs.ts` for the auto-link
 * matcher. Extracted to a shared module (1.9.17) so first-clear
 * backfill / discord-import / time-to-clear aggregation can reuse the
 * same classifier to filter videos that don't belong to a category
 * (e.g. an LH-級 video accidentally added to the Cruiser category).
 *
 * Order matters: longer / more-specific keywords listed first within
 * each group. `findContentGroups()` matches longest-first using a
 * masking pass so a more specific keyword (e.g. "ライトヘビー級")
 * prevents a more general one (e.g. "ヘビー級") from spuriously
 * matching the same characters.
 */
export const CONTENT_GROUPS: Array<string[]> = [
  // 0: Ultimate Alexander (TEA)
  ["絶アレキサンダー", "epic of alexander", "ultimate alexander", "tea"],
  // 1: Ultimate Bahamut (UCOB)
  ["絶バハムート", "unending coil of bahamut", "ucob"],
  // 2: Ultimate Ultima Weapon (UWU)
  ["絶アルテマウェポン", "ultima weapon ultimate", "uwu"],
  // 3: Ultimate Dragonsong (DSR)
  ["絶ニーズヘッグ", "dragonsong's reprise", "dragonsong reprise", "dsr"],
  // 4: Ultimate Omega Protocol (TOP)
  ["絶オメガ検証戦", "絶オメガ検証", "the omega protocol", "top "],
  // 5: Ultimate Futures Rewritten (FRU)
  ["絶エンドシンガー", "futures rewritten", "fru "],
  // 6: Ultimate Zodiark
  ["絶ゾディアーク", "ultimate zodiark"],
  // 7: Asphodelos (P1-4S, EW Tier 1)
  ["アスフォデロス", "asphodelos", "p1s", "p2s", "p3s", "p4s"],
  // 8: Abyssos (P5-8S, EW Tier 2)
  ["アビス", "abyssos", "p5s", "p6s", "p7s", "p8s"],
  // 9: Anabaseios (P9-12S, EW Tier 3)
  ["アナバセイオス", "anabaseios", "p9s", "p10s", "p11s", "p12s"],
  // 10: Arcadion AAC Light-heavyweight Tier (DT M1-4S)
  // Abbreviations: 「LH級」 (1.9.17) / 「ライトヘビー」(no 級) for
  // titles that omit the suffix.
  [
    "至天の座アルカディア：ライトヘビー級",
    "アルカディア：ライトヘビー級",
    "ライトヘビー級",
    "ライトヘビー",
    "lh級",
    "aac light-heavyweight",
    "light-heavyweight",
    "lightheavyweight",
    "m1s",
    "m2s",
    "m3s",
    "m4s",
  ],
  // 11: Arcadion AAC Cruiserweight Tier (DT M5-8S, expected)
  [
    "至天の座アルカディア：クルーザー級",
    "アルカディア：クルーザー級",
    "クルーザー級",
    "クルーザー",
    "クル級",
    "aac cruiserweight",
    "cruiserweight",
    "m5s",
    "m6s",
    "m7s",
    "m8s",
  ],
  // 12: Arcadion AAC Heavyweight Tier
  // NB: keep "ヘビー級" rendering AFTER the LH-tier list so longest-
  // first masking eliminates "ライトヘビー級" before "ヘビー級" gets
  // its turn at matching.
  [
    "至天の座アルカディア：ヘビー級",
    "アルカディア：ヘビー級",
    "ヘビー級",
    "ヘビ級",
    "aac heavyweight",
    "heavyweight",
  ],
  // 13: Arcadion AAC Welterweight Tier
  [
    "至天の座アルカディア：ウェルター級",
    "アルカディア：ウェルター級",
    "ウェルター級",
    "ウェル級",
    "aac welterweight",
    "welterweight",
  ],
  // 14: Criterion / Variant dungeons
  ["criterion", "variant", "criterion dungeon"],
];

/**
 * Normalize a content string for keyword matching:
 *   - lowercase
 *   - fullwidth → halfwidth ASCII (digits + alphabet)
 *   - fullwidth colon `：` → halfwidth `:`
 *   - ideographic space → ASCII space
 *   - katakana middle dot → ASCII space
 *
 * Without this, e.g. seed-data category names with halfwidth colon
 * (`アルカディア:ヘビー級`) wouldn't match keyword variants written with
 * fullwidth `：`.
 */
export function normalizeContentText(text: string): string {
  return (
    text
      .toLowerCase()
      // Fullwidth letters / digits → ASCII (U+FF21..U+FF5A etc.)
      .replace(/[！-～]/g, (ch) =>
        String.fromCharCode(ch.charCodeAt(0) - 0xfee0),
      )
      .replace(/[　]/g, " ") // ideographic space
      .replace(/[・]/g, " ") // katakana middle dot
  );
}

/**
 * Returns the set of content group ids that the given text matches.
 * Uses longest-match-wins masking so a more specific keyword (e.g.
 * "ライトヘビー級") prevents a more general one (e.g. "ヘビー級") from
 * spuriously matching the same characters.
 */
export function findContentGroups(text: string): Set<number> {
  const norm = normalizeContentText(text);
  const all: Array<{ group: number; kw: string }> = [];
  for (let i = 0; i < CONTENT_GROUPS.length; i++) {
    for (const kw of CONTENT_GROUPS[i]!) {
      all.push({ group: i, kw: normalizeContentText(kw) });
    }
  }
  all.sort((a, b) => b.kw.length - a.kw.length);
  const groups = new Set<number>();
  let masked = norm;
  for (const { group, kw } of all) {
    if (masked.includes(kw)) {
      groups.add(group);
      masked = masked.split(kw).join(" ".repeat(kw.length));
    }
  }
  return groups;
}

/**
 * Returns true if the video looks like it belongs to the given
 * category. Uses cross-language group classification.
 *
 *   - Both classified to overlapping group → belongs (true).
 *   - Both classified, disjoint → does NOT belong (false).
 *   - Either side unclassified → ambiguous, return true (lenient
 *     fallback so generic titles like "練習会" don't get rejected).
 */
export function videoBelongsToCategory(
  videoTitle: string | null | undefined,
  categoryName: string | null | undefined,
): boolean {
  if (!videoTitle || !categoryName) return true;
  const cGroups = findContentGroups(categoryName);
  if (cGroups.size === 0) return true;
  const vGroups = findContentGroups(videoTitle);
  if (vGroups.size === 0) return true;
  for (const g of cGroups) if (vGroups.has(g)) return true;
  return false;
}
