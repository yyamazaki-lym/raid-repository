/**
 * マクロの行数 (UI-6、2026-09-07)。
 *
 * FF14 のマクロは **15 行まで**。16 行目以降はゲーム内に貼れないので、
 * portal 側で作った / 貼られたマクロが 15 行を超えていたら、コピーして
 * ゲームに持っていく前に気付けるようにする。
 *
 * ## 数え方
 *
 * **末尾の空行だけを落として、残りの物理行を数える。**
 *
 *   - 末尾の改行 (エディタが付ける) は数えない。1 行と数えると 15 行の
 *     マクロが「16 行」と出て、直しようのない警告になる
 *   - **途中の空行は数える。** ゲーム内マクロは 1 行 = 1 スロットで、
 *     空行もスロットを消費する。当初は「空行は送られない」と考えて
 *     除いていたが、それだと空行を 1 つ含む 16 行のマクロが「15/15」と
 *     出て通ってしまい、貼ると最後の行が落ちる — 上限チェックの目的
 *     (貼れるかどうか) と逆になる (2026-09-07 マージ前レビューで検出)
 *
 * 検証: `node scripts/check-macro-lines.mjs`
 */

/** ゲーム内マクロの行数上限。 */
export const MACRO_LINE_LIMIT = 15;

/**
 * 末尾の空行を落としたあとの物理行数。
 *
 * 途中の空行はゲーム内でスロットを消費するので数える。末尾だけ落とすのは
 * エディタが付ける改行で警告が出ないようにするため。全角スペースだけの行も
 * 「空」として扱う (マクロ本文の整形で入りやすい)。
 */
export function countMacroLines(text: string): number {
  if (!text) return 0;
  const lines = text.split("\n");
  const isBlank = (line: string) => line.replace(/[\s　]/g, "") === "";
  let end = lines.length;
  while (end > 0 && isBlank(lines[end - 1]!)) end -= 1;
  return end;
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
