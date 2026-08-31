/**
 * xlsx から IMAGE 数式を取り出す最小実装の検証 (2026-08-31)。
 * 実行: `node scripts/check-xlsx-lite.mjs`
 *
 * ここが列番号を 1 つでもズラすと、軽減表に**誤った軽減名**が並ぶ。
 * 実際の zip を組み立てて、展開から列番号の算出まで通しで確認する。
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { deflateRawSync, crc32 } from "node:zlib";

const SRC = "src/lib/xlsx-lite.ts";

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${name}\n       expected: ${e}\n       actual:   ${a}`);
  }
}

/** テスト用の最小 zip (deflate) を組み立てる。 */
function makeZip(entries) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const [name, text] of entries) {
    const raw = Buffer.from(text, "utf-8");
    const data = deflateRawSync(raw);
    const nameBuf = Buffer.from(name, "utf-8");
    const crc = crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, data);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(raw.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const localsBuf = Buffer.concat(locals);
  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(localsBuf.length, 16);
  return new Uint8Array(Buffer.concat([localsBuf, centralBuf, eocd]));
}

const outDir = mkdtempSync(join(tmpdir(), "xlsx-lite-check-"));
try {
  execFileSync(
    "npx",
    [
      "tsc",
      SRC,
      "--outDir",
      outDir,
      "--target",
      "es2022",
      "--module",
      "es2022",
      "--moduleResolution",
      "bundler",
      "--strict",
    ],
    { stdio: "inherit" },
  );
  const mod = await import(pathToFileURL(join(outDir, "xlsx-lite.js")).href);

  console.log("\n[列記号 → 列番号 (CSV と一致すること)]");
  check("A は 0", mod.columnLettersToIndex("A"), 0);
  check("Z は 25", mod.columnLettersToIndex("Z"), 25);
  check("AA は 26", mod.columnLettersToIndex("AA"), 26);
  // 実例: 「DO 列 = 牽制」。ここがズレると別の軽減名が入る。
  check("DO は 118", mod.columnLettersToIndex("DO"), 118);
  check("EA は 130", mod.columnLettersToIndex("EA"), 130);

  console.log("\n[IMAGE 数式の解釈]");
  check(
    "引数付きでも URL を取る",
    mod.imageUrlFromFormula('IMAGE("https://lds-img.finalfantasyxiv.com/h/1/a.png",4,40,40)'),
    "https://lds-img.finalfantasyxiv.com/h/1/a.png",
  );
  check(
    "先頭の = と _xlfn. を許容",
    mod.imageUrlFromFormula('=_xlfn.IMAGE("https://x/y.png")'),
    "https://x/y.png",
  );
  // セル参照で URL を組む式は解決できない。推測で誤った URL を作らない。
  check(
    "セル参照の式は取らない",
    mod.imageUrlFromFormula("IMAGE(A1)"),
    null,
  );
  check("IMAGE 以外は取らない", mod.imageUrlFromFormula('HYPERLINK("https://x")'), null);
  check("http(s) 以外は取らない", mod.imageUrlFromFormula('IMAGE("ftp://x/y.png")'), null);

  console.log("\n[zip 展開 → シート別 IMAGE セル]");
  const workbook =
    '<workbook><sheets>' +
    '<sheet name="P1_鉄天騎士" sheetId="1" r:id="rId1"/>' +
    '<sheet name="P2_トールダン" sheetId="2" r:id="rId2"/>' +
    "</sheets></workbook>";
  const sheet1 =
    '<worksheet><sheetData><row r="26">' +
    '<c r="E26" t="s"><v>0</v></c>' +
    '<c r="DO26"><f>IMAGE("https://lds-img.finalfantasyxiv.com/h/1/keihi.png")</f><v>0</v></c>' +
    '<c r="EA26"><f>IMAGE("https://lds-img.finalfantasyxiv.com/h/2/addle.png")</f></c>' +
    "</row></sheetData></worksheet>";
  const sheet2 =
    '<worksheet><sheetData><row r="26">' +
    '<c r="B26"><f>IMAGE("https://lds-img.finalfantasyxiv.com/h/3/rampart.png")</f></c>' +
    "</row></sheetData></worksheet>";
  const zip = makeZip([
    ["xl/workbook.xml", workbook],
    ["xl/worksheets/sheet1.xml", sheet1],
    ["xl/worksheets/sheet2.xml", sheet2],
    ["xl/styles.xml", "<styleSheet/>"],
  ]);

  const files = mod.unzip(zip);
  check("zip を展開できる", files.size, 4);
  check("シート名をタブ順で読む", mod.parseWorkbookSheetNames(workbook), [
    "P1_鉄天騎士",
    "P2_トールダン",
  ]);

  const bySheet = mod.extractImageCellsBySheet(files);
  check("シート名で引ける", [...bySheet.keys()], ["P1_鉄天騎士", "P2_トールダン"]);
  check("列・行・URL を取る", bySheet.get("P1_鉄天騎士"), [
    { row: 25, column: 118, url: "https://lds-img.finalfantasyxiv.com/h/1/keihi.png" },
    { row: 25, column: 130, url: "https://lds-img.finalfantasyxiv.com/h/2/addle.png" },
  ]);
  check(
    "sheet2 は別のシート名に紐づく",
    bySheet.get("P2_トールダン").map((c) => c.column),
    [1],
  );
  // 数式の無いセル (E26 の見出し等) を拾わない。
  check("数式の無いセルは無視", bySheet.get("P1_鉄天騎士").length, 2);


  console.log("\n[埋め込み画像 (画像をセル内に挿入)]");
  // Google の「画像をセル内に挿入」は数式ではなく drawing になる。
  // URL は残らないが、行・列は正確に取れる必要がある。
  const drawing =
    '<xdr:wsDr>' +
    '<xdr:twoCellAnchor editAs="oneCell">' +
    '<xdr:from><xdr:col>118</xdr:col><xdr:colOff>0</xdr:colOff>' +
    '<xdr:row>25</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>' +
    '<xdr:pic><xdr:blipFill><a:blip r:embed="rId1"/></xdr:blipFill></xdr:pic>' +
    "</xdr:twoCellAnchor>" +
    '<xdr:oneCellAnchor>' +
    '<xdr:from><xdr:col>130</xdr:col><xdr:row>25</xdr:row></xdr:from>' +
    '<xdr:pic><xdr:blipFill><a:blip r:embed="rId2"/></xdr:blipFill></xdr:pic>' +
    "</xdr:oneCellAnchor>" +
    "</xdr:wsDr>";
  const drawingRels =
    '<Relationships>' +
    '<Relationship Id="rId1" Type="x" Target="../media/image1.png"/>' +
    '<Relationship Id="rId2" Type="x" Target="../media/image2.png"/>' +
    "</Relationships>";

  check("rels を Id → Target で読む", [...mod.parseRels(drawingRels).entries()], [
    ["rId1", "../media/image1.png"],
    ["rId2", "../media/image2.png"],
  ]);
  check(
    "相対パスを解決する",
    mod.resolveZipPath("xl/drawings/drawing1.xml", "../media/image1.png"),
    "xl/media/image1.png",
  );
  check(
    "twoCell/oneCell 両方から行・列を取る",
    mod.parseDrawingAnchors(drawing, mod.parseRels(drawingRels), "xl/drawings/drawing1.xml"),
    [
      { row: 25, column: 118, mediaPath: "xl/media/image1.png" },
      { row: 25, column: 130, mediaPath: "xl/media/image2.png" },
    ],
  );

  const zip2 = makeZip([
    ["xl/workbook.xml", workbook],
    ["xl/worksheets/sheet1.xml", '<worksheet><drawing r:id="rIdD"/></worksheet>'],
    [
      "xl/worksheets/_rels/sheet1.xml.rels",
      '<Relationships><Relationship Id="rIdD" Type="x" Target="../drawings/drawing1.xml"/></Relationships>',
    ],
    ["xl/drawings/drawing1.xml", drawing],
    ["xl/drawings/_rels/drawing1.xml.rels", drawingRels],
    ["xl/worksheets/sheet2.xml", "<worksheet/>"],
  ]);
  const anchored = mod.extractAnchoredImagesBySheet(mod.unzip(zip2));
  check(
    "シートを辿って埋め込み画像に届く",
    anchored.get("P1_\u9244\u5929\u9a0e\u58eb").map((a) => a.column),
    [118, 130],
  );
  // drawing が無いシートで落ちない。
  check("drawing の無いシートは空", anchored.get("P2_\u30c8\u30fc\u30eb\u30c0\u30f3"), []);


  console.log("\n[シート名 → XML の対応 (rels 経由)]");
  // 2026-08-31 実機: sheet1.xml の番号順 = タブ順 と思い込んでいたため、
  // アイコンが隣のシートのものとして扱われ、列がズレた。
  const wbOrdered =
    '<workbook><sheets>' +
    '<sheet name="M12S-2" sheetId="7" r:id="rId9"/>' +
    '<sheet name="裏M12S-1" sheetId="6" r:id="rId4"/>' +
    "</sheets></workbook>";
  const wbRels =
    "<Relationships>" +
    '<Relationship Id="rId9" Target="worksheets/sheet3.xml"/>' +
    '<Relationship Id="rId4" Target="worksheets/sheet1.xml"/>' +
    "</Relationships>";
  const zip3 = makeZip([
    ["xl/workbook.xml", wbOrdered],
    ["xl/_rels/workbook.xml.rels", wbRels],
    [
      "xl/worksheets/sheet1.xml",
      '<worksheet><c r="B26"><f>IMAGE("https://x/ura.png")</f></c></worksheet>',
    ],
    [
      "xl/worksheets/sheet3.xml",
      '<worksheet><c r="DO26"><f>IMAGE("https://x/m12s2.png")</f></c></worksheet>',
    ],
  ]);
  const files3 = mod.unzip(zip3);
  check("番号順ではなく rels で対応づける", mod.resolveWorkbookSheets(files3), [
    { name: "M12S-2", path: "xl/worksheets/sheet3.xml" },
    { name: "裏M12S-1", path: "xl/worksheets/sheet1.xml" },
  ]);
  const bySheet3 = mod.extractImageCellsBySheet(files3);
  check(
    "アイコンが正しいシートに付く",
    bySheet3.get("M12S-2").map((c) => c.url),
    ["https://x/m12s2.png"],
  );
  check(
    "隣のシートに混ざらない",
    bySheet3.get("裏M12S-1").map((c) => c.url),
    ["https://x/ura.png"],
  );


  console.log("\n[CSV 本文との照合で層を確定させる]");
  const ssXml =
    "<sst>" +
    "<si><t>トップティアスラム</t></si>" +
    "<si><r><t>マイティ</t></r><r><t>マジック</t></r></si>" +
    "<si><t>ウィングドスカージ</t></si>" +
    "<si><t>AA</t></si>" +
    "<si><t>スネークキック</t></si>" +
    "</sst>";
  check("共有文字列を読む", mod.parseSharedStrings(ssXml), [
    "トップティアスラム",
    "マイティマジック",
    "ウィングドスカージ",
    "AA",
    "スネークキック",
  ]);

  const shared = mod.parseSharedStrings(ssXml);
  const sheetTextXml =
    '<worksheet>' +
    '<c r="E1" t="s"><v>0</v></c>' +
    '<c r="E2" t="s"><v>1</v></c>' +
    '<c r="F2" t="b"><v>1</v></c>' +
    '<c r="G2" t="inlineStr"><is><t>レプリケーション</t></is></c>' +
    '<c r="H2" t="str"><v>TRUE</v></c>' +
    "</worksheet>";
  // 数値・真偽値は指紋にならないので除く。
  check("文字列セルだけを拾う", mod.extractSheetTexts(sheetTextXml, shared), [
    "トップティアスラム",
    "マイティマジック",
    "レプリケーション",
  ]);

  const texts = new Map([
    ["M12S-1", ["トップティアスラム", "スネークキック", "ダブルソバット"]],
    ["M12S-2", ["トップティアスラム", "マイティマジック", "ウィングドスカージ", "レプリケーション"]],
  ]);
  const csv = ["トップティアスラム", "マイティマジック", "ウィングドスカージ", "レプリケーション"];
  const matched = mod.matchSheetByContent(texts, csv);
  check("本文が一致するシートを選ぶ", matched.sheet, "M12S-2");
  check("一致率を返す", matched.score, 1);

  // 隣接する層は技名を多く共有する。差が小さいときに決め打ちしない。
  const ambiguous = new Map([
    ["M12S-1", ["A", "B", "C", "D"]],
    ["M12S-2", ["A", "B", "C", "E"]],
  ]);
  check(
    "二番手と差が無ければ確定しない",
    mod.matchSheetByContent(ambiguous, ["A", "B", "C", "D"]),
    null,
  );
  // どのシートとも一致しないなら確定しない。
  check(
    "一致率が低ければ確定しない",
    mod.matchSheetByContent(texts, ["X", "Y", "Z", "W"]),
    null,
  );
  check("CSV が空なら null", mod.matchSheetByContent(texts, []), null);

  console.log("\n[壊れた入力]");
  check("zip でなければ空", mod.unzip(new Uint8Array([1, 2, 3])).size, 0);
  check("空でも落ちない", mod.unzip(new Uint8Array(0)).size, 0);
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

console.log(failures === 0 ? "\nすべて OK" : `\n${failures} 件 FAIL`);
process.exit(failures === 0 ? 0 : 1);
