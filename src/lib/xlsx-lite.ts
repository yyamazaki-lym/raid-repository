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

/**
 * `xl/sharedStrings.xml` の文字列表。
 * xlsx はセルの文字列を共有テーブルに逃がすので、これが無いとシート本文を
 * 読めない。`<si>` は `<t>` 1 個か、書式ごとに分かれた `<r><t>` の連なり。
 */
export function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let m: RegExpExecArray | null;
  while ((m = siRe.exec(xml)) !== null) {
    let text = "";
    const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let t: RegExpExecArray | null;
    while ((t = tRe.exec(m[1]!)) !== null) text += t[1]!;
    out.push(decodeXmlText(text));
  }
  return out;
}

/**
 * ワークシートの文字列セルを列挙する (照合用の指紋)。
 *
 * gid は xlsx に残らないため、**CSV 側の本文と突き合わせて**どのシートが
 * その層かを決めるのに使う。名前や列の重なりで当てるより確実
 * (2026-08-31: 隣のシートを掴む事故が続いたため)。
 */
export function extractSheetTexts(
  xml: string,
  shared: string[],
  limit = 4000,
): string[] {
  const out: string[] = [];
  const cellRe = /<c\b([^>]*)>([\s\S]*?)<\/c>/g;
  let m: RegExpExecArray | null;
  while ((m = cellRe.exec(xml)) !== null && out.length < limit) {
    const attrs = m[1]!;
    const body = m[2]!;
    const type = /\bt="([^"]+)"/.exec(attrs)?.[1];
    let text: string | null = null;
    if (type === "s") {
      const v = /<v>([\s\S]*?)<\/v>/.exec(body);
      if (v) text = shared[Number(v[1])] ?? null;
    } else if (type === "inlineStr") {
      const t = /<t\b[^>]*>([\s\S]*?)<\/t>/.exec(body);
      if (t) text = decodeXmlText(t[1]!);
    } else if (type === "str") {
      const v = /<v>([\s\S]*?)<\/v>/.exec(body);
      if (v) text = decodeXmlText(v[1]!);
    }
    if (text) {
      const trimmed = text.trim();
      // 1 文字の記号や真偽値は、どのシートにもあるので指紋にならない。
      if (trimmed.length >= 2 && !/^(TRUE|FALSE)$/i.test(trimmed)) {
        out.push(trimmed);
      }
    }
  }
  return out;
}

/** シート名 → 本文の文字列 (照合用)。 */
export function extractTextsBySheet(
  files: Map<string, Uint8Array>,
): Map<string, string[]> {
  const dec = new TextDecoder("utf-8");
  const ss = files.get("xl/sharedStrings.xml");
  const shared = ss ? parseSharedStrings(dec.decode(ss)) : [];
  const out = new Map<string, string[]>();
  for (const { name, path } of resolveWorkbookSheets(files)) {
    const xml = files.get(path);
    if (!xml) continue;
    out.set(name, extractSheetTexts(dec.decode(xml), shared));
  }
  return out;
}

/**
 * CSV 本文と最も一致するシート名を返す。
 *
 * 一致率 = |共通する語| / |CSV の語|。隣接する層 (M12S-1 と M12S-2 など) は
 * 技名を多く共有するので、**閾値を置いて、二番手と十分に差がある場合だけ**
 * 採用する。曖昧なときに決め打ちすると、これまでと同じ「隣のシートを掴む」
 * 事故になる。
 */
export function matchSheetByContent(
  textsBySheet: Map<string, string[]>,
  csvTexts: string[],
  { minScore = 0.5, minLead = 0.08 }: { minScore?: number; minLead?: number } = {},
): { sheet: string; score: number; runnerUp: number } | null {
  const target = new Set(csvTexts.filter((t) => t.trim().length >= 2));
  if (target.size === 0) return null;
  const scored = [...textsBySheet.entries()]
    .map(([sheet, texts]) => {
      const seen = new Set(texts);
      let hit = 0;
      for (const t of target) if (seen.has(t)) hit += 1;
      return { sheet, score: hit / target.size };
    })
    .sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best || best.score < minScore) return null;
  const runnerUp = scored[1]?.score ?? 0;
  if (best.score - runnerUp < minLead) return null;
  return { sheet: best.sheet, score: best.score, runnerUp };
}

/** ワークシートの先頭 N 行をグリッド (行 × 列) にして返す。 */
export function extractSheetGrid(
  xml: string,
  shared: string[],
  maxRows = 30,
): string[][] {
  const grid: string[][] = [];
  const cellRe = /<c\b[^>]*\br="([A-Z]+)(\d+)"([^>]*)>([\s\S]*?)<\/c>/g;
  let m: RegExpExecArray | null;
  while ((m = cellRe.exec(xml)) !== null) {
    const row = Number(m[2]) - 1;
    if (row >= maxRows) continue;
    const col = columnLettersToIndex(m[1]!);
    const attrs = m[3]!;
    const body = m[4]!;
    const type = /\bt="([^"]+)"/.exec(attrs)?.[1];
    let text = "";
    if (type === "s") {
      const v = /<v>([\s\S]*?)<\/v>/.exec(body);
      if (v) text = shared[Number(v[1])] ?? "";
    } else if (type === "inlineStr") {
      const t = /<t\b[^>]*>([\s\S]*?)<\/t>/.exec(body);
      if (t) text = decodeXmlText(t[1]!);
    } else if (type === "b") {
      const v = /<v>([\s\S]*?)<\/v>/.exec(body);
      if (v) text = v[1] === "1" ? "TRUE" : "FALSE";
    } else {
      const v = /<v>([\s\S]*?)<\/v>/.exec(body);
      if (v) text = decodeXmlText(v[1]!);
    }
    while (grid.length <= row) grid.push([]);
    const line = grid[row]!;
    while (line.length <= col) line.push("");
    line[col] = text;
  }
  // 行が 1 つも無い場合でも呼び出し側が添字で触れるよう埋めておく。
  while (grid.length < Math.min(maxRows, 8)) grid.push([]);
  return grid;
}

/** シート名で先頭 N 行のグリッドを引く。 */
export function sheetGridByName(
  files: Map<string, Uint8Array>,
  sheetName: string,
  maxRows = 30,
): string[][] | null {
  const dec = new TextDecoder("utf-8");
  const target = resolveWorkbookSheets(files).find((s) => s.name === sheetName);
  if (!target) return null;
  const xml = files.get(target.path);
  if (!xml) return null;
  const ssBytes = files.get("xl/sharedStrings.xml");
  const shared = ssBytes ? parseSharedStrings(dec.decode(ssBytes)) : [];
  return extractSheetGrid(dec.decode(xml), shared, maxRows);
}

/**
 * CSV 本文と最も一致するシートを、**珍しい語を重く見て**選ぶ (2026-08-31)。
 *
 * 単純な一致率では、隣接する層 (M9S / M10S / M12S-1 / M12S-2 …) が技名や
 * ジョブ名を大量に共有するため差が付かず、取り違えが起きていた。
 * 「そのシートにしか出てこない語」ほど層を言い当てる力が強いので、
 * 出現シート数の逆数で重み付けする (TF-IDF と同じ考え方)。
 *
 * さらに、**CSV の中に xlsx のシート名そのものが出てくる**ことがある
 * (このテンプレートは D3 にシート名を書いている)。それが見つかれば
 * 内容照合より確実なので優先する。
 */
export function matchSheetByContentWeighted(
  textsBySheet: Map<string, string[]>,
  csvTexts: string[],
  { minLead = 1.4, minScore = 0.15 }: { minLead?: number; minScore?: number } = {},
): { sheet: string; score: number; runnerUp: number; decisive: boolean } | null {
  const sheets = [...textsBySheet.keys()];
  if (sheets.length === 0) return null;
  const csvSet = new Set(csvTexts.map((t) => t.trim()).filter((t) => t.length >= 2));
  if (csvSet.size === 0) return null;

  // 1) CSV にシート名そのものが入っていれば、それが答え。
  const named = sheets.filter((s) => s.trim().length >= 2 && csvSet.has(s.trim()));
  if (named.length === 1) {
    return { sheet: named[0]!, score: 1, runnerUp: 0, decisive: true };
  }

  // 2) 出現シート数で重み付けした一致度。
  const sets = new Map(
    [...textsBySheet].map(([s, ts]) => [s, new Set(ts.map((t) => t.trim()))]),
  );
  const docFreq = new Map<string, number>();
  for (const t of csvSet) {
    let n = 0;
    for (const set of sets.values()) if (set.has(t)) n += 1;
    if (n > 0) docFreq.set(t, n);
  }
  let total = 0;
  const weight = new Map<string, number>();
  for (const [t, n] of docFreq) {
    const w = 1 / n;
    weight.set(t, w);
    total += w;
  }
  if (total === 0) return null;
  const scored = sheets
    .map((sheet) => {
      let sum = 0;
      const set = sets.get(sheet)!;
      for (const [t, w] of weight) if (set.has(t)) sum += w;
      return { sheet, score: sum / total };
    })
    .sort((a, b) => b.score - a.score);
  const best = scored[0]!;
  const runnerUp = scored[1]?.score ?? 0;
  if (best.score < minScore) return null;
  // 二番手の minLead 倍は無いと確定しない (似た層を掴む事故を防ぐ)。
  if (runnerUp > 0 && best.score < runnerUp * minLead) return null;
  return { sheet: best.sheet, score: best.score, runnerUp, decisive: false };
}
