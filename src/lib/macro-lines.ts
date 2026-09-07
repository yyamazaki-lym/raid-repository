/**
 * マクロの行数 (UI-6、2026-09-07)。
 *
 * FF14 のマクロは **15 行まで**。16 行目以降はゲーム内に貼れないので、
 * portal 側で作った / 貼られたマクロが 15 行を超えていたら、コピーして
 * ゲームに持っていく前に気付けるようにする。
 *
 * ## 数え方
 *
 * 空行は数えない。
 *
 *   - 末尾の改行 (エディタが付ける) を 1 行と数えると、15 行のマクロが
 *     「16 行」と出て、直しようのない警告になる
 *   - 途中の空行もゲームでは行として送られないので、見た目の行数より
 *     少なくなる方が実態に合う (貼れるかどうかの判断が目的)
 *
 * 検証: `node scripts/check-macro-lines.mjs`
 */

/** ゲーム内マクロの行数上限。 */
export const MACRO_LINE_LIMIT = 15;

/** 空行を除いた行数。 */
export function countMacroLines(text: string): number {
  if (!text) return 0;
  let n = 0;
  for (const line of text.split("\n")) {
    // 全角スペースだけの行も空行として扱う (マクロ本文の整形で入りやすい)。
    if (line.trim() !== "" && line.replace(/[\s　]/g, "") !== "") n += 1;
  }
  return n;
}

/** 上限を超えているか (`limit` 未指定なら数えるだけで超過判定はしない)。 */
export function macroLineInfo(
  text: string,
  limit?: number,
): { lines: number; limit: number | null; over: boolean } {
  const lines = countMacroLines(text);
  if (limit === undefined) return { lines, limit: null, over: false };
  return { lines, limit, over: lines > limit };
}
