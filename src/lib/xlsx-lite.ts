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

/** zip 内の相対パス解決 (`xl/worksheets/_rels/..` から `../drawings/d.xml`)。 */
export function resolveZipPath(baseFile: string, rel: string): string {
  const parts = baseFile.split("/").slice(0, -1);
  for (const seg of rel.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== "." && seg !== "") parts.push(seg);
  }
  return parts.join("/");
}

/** `.rels` から `Id → Target` を読む。 */
export function parseRels(xml: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.set(m[1]!, decodeXmlText(m[2]!));
  // 属性順が逆のものも受ける (書き出し側で順序は保証されない)。
  const re2 = /<Relationship\b[^>]*\bTarget="([^"]+)"[^>]*\bId="([^"]+)"/g;
  while ((m = re2.exec(xml)) !== null) {
    if (!out.has(m[2]!)) out.set(m[2]!, decodeXmlText(m[1]!));
  }
  return out;
}

export type XlsxAnchoredImage = {
  row: number;
  column: number;
  /** zip 内の画像パス (`xl/media/image1.png`)。 */
  mediaPath: string;
};

/**
 * drawing XML からセルに紐づいた画像を拾う。
 *
 * Google Sheets の「画像をセル内に挿入」は数式ではなく**埋め込み画像**に
 * なるため、`=IMAGE()` の抽出だけでは取りこぼす。こちらは URL が残らない
 * (画像バイトのみ) が、位置 (行・列) は正確に分かるので、**アイコンを
 * そのまま表示して人が名前を付ける**用途には十分。
 */
export function parseDrawingAnchors(
  xml: string,
  rels: Map<string, string>,
  drawingPath: string,
): XlsxAnchoredImage[] {
  const out: XlsxAnchoredImage[] = [];
  const blockRe =
    /<(?:xdr:)?(?:two|one)CellAnchor\b[\s\S]*?<\/(?:xdr:)?(?:two|one)CellAnchor>/g;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(xml)) !== null) {
    const block = m[0];
    const from = /<(?:xdr:)?from>([\s\S]*?)<\/(?:xdr:)?from>/.exec(block);
    if (!from) continue;
    const col = /<(?:xdr:)?col>(\d+)<\/(?:xdr:)?col>/.exec(from[1]!);
    const row = /<(?:xdr:)?row>(\d+)<\/(?:xdr:)?row>/.exec(from[1]!);
    const embed = /<(?:a:)?blip\b[^>]*\br:embed="([^"]+)"/.exec(block);
    if (!col || !row || !embed) continue;
    const target = rels.get(embed[1]!);
    if (!target) continue;
    out.push({
      row: Number(row[1]),
      column: Number(col[1]),
      mediaPath: resolveZipPath(drawingPath, target),
    });
  }
  return out;
}

/**
 * ワークブックの「タブ順のシート名 → ワークシート XML のパス」。
 *
 * ⚠ `sheet1.xml` の**番号順がタブ順と一致するとは限らない**
 * (2026-08-31: 一致する前提で組んでいたため、アイコンが隣のシートの
 * ものとして扱われ、列がズレた)。対応は `xl/_rels/workbook.xml.rels`
 * の r:id を辿って初めて分かる。
 */
export function resolveWorkbookSheets(
  files: Map<string, Uint8Array>,
): Array<{ name: string; path: string }> {
  const dec = new TextDecoder("utf-8");
  const wb = files.get("xl/workbook.xml");
  if (!wb) return [];
  const wbXml = dec.decode(wb);
  const relsBytes = files.get("xl/_rels/workbook.xml.rels");
  const rels = relsBytes
    ? parseRels(dec.decode(relsBytes))
    : new Map<string, string>();

  const out: Array<{ name: string; path: string }> = [];
  const tags = wbXml.match(/<sheet\b[^>]*\/?>/g) ?? [];
  // rels が無い/壊れている場合の保険。番号順は当てにならないが、
  // 何も返さないよりはよい。
  const numbered = [...files.keys()]
    .filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k))
    .sort(
      (a, b) =>
        Number(/(\d+)\.xml$/.exec(a)![1]) - Number(/(\d+)\.xml$/.exec(b)![1]),
    );
  tags.forEach((tag, i) => {
    const name = /\bname="([^"]*)"/.exec(tag)?.[1];
    if (name === undefined) return;
    const rid = /\br:id="([^"]+)"/.exec(tag)?.[1];
    const target = rid ? rels.get(rid) : undefined;
    const path = target
      ? resolveZipPath("xl/workbook.xml", target)
      : (numbered[i] ?? "");
    if (path) out.push({ name: decodeXmlText(name), path });
  });
  return out;
}

/** xlsx 全体から「シート名 → IMAGE セル」を作る。 */
export function extractImageCellsBySheet(
  files: Map<string, Uint8Array>,
): Map<string, XlsxImageCell[]> {
  const dec = new TextDecoder("utf-8");
  const out = new Map<string, XlsxImageCell[]>();
  for (const { name, path } of resolveWorkbookSheets(files)) {
    const xml = files.get(path);
    if (!xml) continue;
    out.set(name, extractImageFormulaCells(dec.decode(xml)));
  }
  return out;
}

/** 同じ対応表で「シート名 → セルに埋め込まれた画像」を作る。 */
export function extractAnchoredImagesBySheet(
  files: Map<string, Uint8Array>,
): Map<string, XlsxAnchoredImage[]> {
  const dec = new TextDecoder("utf-8");
  const out = new Map<string, XlsxAnchoredImage[]>();
  for (const { name, path } of resolveWorkbookSheets(files)) {
    const sheetBytes = files.get(path);
    if (!sheetBytes) continue;
    out.set(name, []);
    const sheetXml = dec.decode(sheetBytes);
    const drawingRef = /<drawing\b[^>]*\br:id="([^"]+)"/.exec(sheetXml);
    if (!drawingRef) continue;
    const sheetRels = files.get(
      `${path.replace(/\/([^/]+)$/, "/_rels/$1")}.rels`,
    );
    if (!sheetRels) continue;
    const target = parseRels(dec.decode(sheetRels)).get(drawingRef[1]!);
    if (!target) continue;
    const drawingPath = resolveZipPath(path, target);
    const drawingXml = files.get(drawingPath);
    if (!drawingXml) continue;
    const drawingRels = files.get(
      `${drawingPath.replace(/\/([^/]+)$/, "/_rels/$1")}.rels`,
    );
    const rels = drawingRels
      ? parseRels(dec.decode(drawingRels))
      : new Map<string, string>();
    out.set(name, parseDrawingAnchors(dec.decode(drawingXml), rels, drawingPath));
  }
  return out;
}
