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

  console.log("\n[壊れた入力]");
  check("zip でなければ空", mod.unzip(new Uint8Array([1, 2, 3])).size, 0);
  check("空でも落ちない", mod.unzip(new Uint8Array(0)).size, 0);
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

console.log(failures === 0 ? "\nすべて OK" : `\n${failures} 件 FAIL`);
process.exit(failures === 0 ? 0 : 1);
