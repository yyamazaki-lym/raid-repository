import { inflateRawSync } from "node:zlib";

/**
 * xlsx (= zip + XML) から `=IMAGE("...")` の**数式そのもの**を取り出す
 * 最小実装 (2026-08-31)。
 *
 * ## なぜ必要か
 *
 * 軽減表のアビリティ欄は `=IMAGE(url)` で公式アイコンを貼っている。
 * ところが Google Sheets のエクスポートは経路によって見えるものが違う:
 *
 *   - CSV / gviz  … **数式の結果**を文字列化する → IMAGE セルは空
 *   - pubhtml     … `<img>` で描画される。ただし「ウェブに公開」が必要
 *   - **xlsx**    … `<f>IMAGE("...")</f>` として**数式が残る**。
 *                   「リンクを知っている全員が閲覧可」だけで落とせる
 *
 * つまり xlsx が、公開設定を増やさずに URL を取れる唯一の経路。
 *
 * ## なぜ自前で unzip するのか
 *
 * 必要なのは「zip を開いて 2〜3 個の XML を読む」だけで、xlsx ライブラリを
 * 足すと依存とバンドルが増えるわりに使うのはごく一部になる。zip の
 * セントラルディレクトリ読みと inflateRaw (node 標準) で足りる。
 *
 * 対応するのは stored (0) と deflate (8) のみ。zip64 は未対応
 * (シート 1 個が 4GB を超えることはない)。
 */

export type XlsxImageCell = {
  /** 0 始まりの行番号 (シート上の行 - 1)。 */
  row: number;
  /** 0 始まりの列番号 (CSV の列インデックスと一致)。 */
  column: number;
  /** IMAGE() の第 1 引数の URL。 */
  url: string;
};

/** zip の中身を「パス → 展開済みバイト列」で返す。壊れていれば空。 */
export function unzip(buf: Uint8Array): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const eocd = findEocd(buf);
  if (eocd < 0) return out;
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  for (let i = 0; i < count; i += 1) {
    if (p + 46 > buf.length || view.getUint32(p, true) !== 0x02014b50) break;
    const method = view.getUint16(p + 10, true);
    const compSize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOff = view.getUint32(p + 42, true);
    const name = new TextDecoder("utf-8").decode(
      buf.subarray(p + 46, p + 46 + nameLen),
    );
    p += 46 + nameLen + extraLen + commentLen;

    if (localOff + 30 > buf.length) continue;
    if (view.getUint32(localOff, true) !== 0x04034b50) continue;
    const lNameLen = view.getUint16(localOff + 26, true);
    const lExtraLen = view.getUint16(localOff + 28, true);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const data = buf.subarray(start, start + compSize);
    try {
      if (method === 0) out.set(name, data);
      else if (method === 8) out.set(name, new Uint8Array(inflateRawSync(data)));
    } catch {
      // 1 エントリーの破損で全体を落とさない (欲しい XML は別エントリー)。
    }
  }
  return out;
}

function findEocd(buf: Uint8Array): number {
  // EOCD はコメント (最大 64KB) の手前にあるので末尾から探す。
  const from = Math.max(0, buf.length - 66_000);
  for (let i = buf.length - 22; i >= from; i -= 1) {
    if (
      buf[i] === 0x50 &&
      buf[i + 1] === 0x4b &&
      buf[i + 2] === 0x05 &&
      buf[i + 3] === 0x06
    ) {
      return i;
    }
  }
  return -1;
}

/** `xl/workbook.xml` からシート名を**タブ順**で返す。 */
export function parseWorkbookSheetNames(xml: string): string[] {
  const out: string[] = [];
  const re = /<sheet\b[^>]*\bname="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(decodeXmlText(m[1]!));
  return out;
}

/** ワークシート XML から `=IMAGE("url")` のセルを拾う。 */
export function extractImageFormulaCells(xml: string): XlsxImageCell[] {
  const out: XlsxImageCell[] = [];
  // <c r="AB26" ...> … <f>IMAGE("https://…")</f>
  const cellRe = /<c\b[^>]*\br="([A-Z]+)(\d+)"[^>]*>([\s\S]*?)<\/c>/g;
  let m: RegExpExecArray | null;
  while ((m = cellRe.exec(xml)) !== null) {
    const body = m[3]!;
    const f = /<f\b[^>]*>([\s\S]*?)<\/f>/.exec(body);
    if (!f) continue;
    const url = imageUrlFromFormula(decodeXmlText(f[1]!));
    if (!url) continue;
    out.push({
      row: Number(m[2]) - 1,
      column: columnLettersToIndex(m[1]!),
      url,
    });
  }
  return out;
}

/**
 * 数式から IMAGE() の URL を取り出す。
 * `IMAGE("u")` / `=IMAGE("u",4,40,40)` / `_xlfn.IMAGE("u")` を受ける。
 * 文字列リテラルでない (セル参照で URL を組む) ものは対象外 — 値が無いと
 * 解決できず、推測で誤った URL を作るより取れない方がよい。
 */
export function imageUrlFromFormula(formula: string): string | null {
  const m = /\bIMAGE\s*\(\s*"([^"]+)"/i.exec(formula);
  if (!m) return null;
  const url = m[1]!.trim();
  return /^https?:\/\//i.test(url) ? url : null;
}

/** `A` → 0, `Z` → 25, `AA` → 26。 */
export function columnLettersToIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) {
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n - 1;
}

function decodeXmlText(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/**
 * xlsx 全体から「シート名 → IMAGE セル」を作る。
 *
 * gid は xlsx に残らないので、シート名で引けるようにする。ワークシートの
 * ファイル名 (`sheet1.xml`…) は workbook.xml のタブ順と一致するため、
 * 番号順に並べて名前を対応させる。
 */
export function extractImageCellsBySheet(
  files: Map<string, Uint8Array>,
): Map<string, XlsxImageCell[]> {
  const dec = new TextDecoder("utf-8");
  const wb = files.get("xl/workbook.xml");
  const names = wb ? parseWorkbookSheetNames(dec.decode(wb)) : [];
  const sheetPaths = [...files.keys()]
    .filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k))
    .sort(
      (a, b) =>
        Number(/(\d+)\.xml$/.exec(a)![1]) - Number(/(\d+)\.xml$/.exec(b)![1]),
    );
  const out = new Map<string, XlsxImageCell[]>();
  sheetPaths.forEach((path, i) => {
    const cells = extractImageFormulaCells(dec.decode(files.get(path)!));
    out.set(names[i] ?? path, cells);
  });
  return out;
}
