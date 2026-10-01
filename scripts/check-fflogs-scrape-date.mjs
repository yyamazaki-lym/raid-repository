/**
 * FFLogs のレポート一覧に出る英語の日付の解釈 (src/lib/fflogs-scrape-date.ts)。
 * 実行: `node scripts/check-fflogs-scrape-date.mjs`
 *
 *   1. 前提: V8 の `Date.parse` は時刻の無い英語の日付 + オフセットを NaN に
 *      する (これが候補から黙って落ちていた原因)。時刻つきは読める
 *   2. `parseEnglishVisibleDate` の境界: 時刻なし = 00:00 / 12 時間制 (12 AM =
 *      0 時、12 PM = 12 時) / 24 時間制 / 月の略称 / 存在しない日付・範囲外の
 *      時刻・知らない月名・壊れたオフセットは null / オフセットの付け方
 *   3. 時刻つきの形では、以前の `Date.parse(text + " +0900")` と同じ値になる
 *      (挙動を変えるのは時刻の無い形だけ)
 *   4. 配線: `extractTimestampMs` の候補 2 が `parseEnglishVisibleDate` を使い、
 *      `Date.parse(m[0] ...)` に戻っていない
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

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

const outDir = mkdtempSync(join(tmpdir(), "fflogs-scrape-date-check-"));
try {
  execFileSync(
    process.execPath,
    [
      "node_modules/typescript/bin/tsc",
      "src/lib/fflogs-scrape-date.ts",
      "--outDir", outDir,
      "--target", "es2022",
      "--module", "es2022",
      "--moduleResolution", "bundler",
      "--strict",
    ],
    { stdio: "inherit" },
  );
  const { parseEnglishVisibleDate: p } = await import(
    pathToFileURL(join(outDir, "fflogs-scrape-date.js")).href
  );
  const JST = "+09:00";
  /** JST の壁時計 → UTC ms */
  const jst = (y, mo, d, h = 0, mi = 0) => Date.UTC(y, mo - 1, d, h - 9, mi);

  console.log("1. 前提 (V8 の Date.parse)");
  check("時刻なし + オフセットは NaN (落ちていた原因)", Number.isNaN(Date.parse("April 17, 2026 +0900")), true);
  check("時刻つきは読める", Date.parse("April 17, 2026 12:33 AM +0900"), jst(2026, 4, 17, 0, 33));

  console.log("2. parseEnglishVisibleDate");
  check("時刻なし → その日の 00:00", p("April 17, 2026", JST), jst(2026, 4, 17));
  check("月の略称", p("Apr 17, 2026", JST), jst(2026, 4, 17));
  check("Sept", p("Sept 3, 2026", JST), jst(2026, 9, 3));
  check("大文字小文字を問わない", p("APRIL 17, 2026", JST), jst(2026, 4, 17));
  check("12 時間制 PM", p("April 17, 2026 9:05 PM", JST), jst(2026, 4, 17, 21, 5));
  check("12 AM は 0 時", p("April 17, 2026 12:33 AM", JST), jst(2026, 4, 17, 0, 33));
  check("12 PM は 12 時", p("April 17, 2026 12:33 PM", JST), jst(2026, 4, 17, 12, 33));
  check("AM/PM の前に空白なし", p("April 17, 2026 9:05PM", JST), jst(2026, 4, 17, 21, 5));
  check("24 時間制", p("April 17, 2026 21:05", JST), jst(2026, 4, 17, 21, 5));
  check("前後の空白は無視", p("  April 17, 2026  ", JST), jst(2026, 4, 17));
  check("閏日", p("February 29, 2028", JST), jst(2028, 2, 29));
  check("存在しない日 (2 月 30 日) は null", p("February 30, 2026", JST), null);
  check("閏年でない 2 月 29 日は null", p("February 29, 2026", JST), null);
  check("13 PM は null", p("April 17, 2026 13:00 PM", JST), null);
  check("0 AM は null", p("April 17, 2026 0:30 AM", JST), null);
  check("24 時は null", p("April 17, 2026 24:00", JST), null);
  check("60 分は null", p("April 17, 2026 9:60 PM", JST), null);
  check("知らない月名は null", p("Created 17, 2026", JST), null);
  check("カンマ無しの形は null (呼び出し側の正規表現も当てない)", p("Sat Mar 21 2026", JST), null);
  check("壊れたオフセットは null", p("April 17, 2026", "+0900"), null);
  check("負のオフセット", p("April 17, 2026 9:05 PM", "-05:00"), Date.UTC(2026, 3, 18, 2, 5));

  console.log("3. 時刻つきは以前と同じ値");
  for (const s of ["April 17, 2026 12:33 AM", "Apr 3, 2026 9:05 PM", "December 31, 2026 11:59 PM", "January 1, 2027 12:00 AM"]) {
    check(`${s}`, p(s, JST), Date.parse(`${s} +0900`));
  }

  console.log("4. 配線");
  const src = readFileSync("src/lib/server/fflogs.ts", "utf8").replace(/\r\n/g, "\n");
  const at = src.indexOf("// 2. English:");
  const block = src.slice(at, src.indexOf("// 3. ISO:", at));
  check("候補 2 のブロックがある", at > 0, true);
  check("parseEnglishVisibleDate で読む", /const t = parseEnglishVisibleDate\(m\[0\], [^)]+\);\s*if \(t !== null\)\s*candidates\.push\(\{ pos: m\.index!, ms: t, priority: 2 \}\);/.test(block), true);
  check("Date.parse(m[0] ...) に戻っていない", /Date\.parse\(m\[0\]/.test(block), false);
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

if (failures > 0) {
  console.log(`\n${failures} 件失敗`);
  process.exit(1);
}
console.log("\nすべて ok");
