/**
 * 技名の日本語化 (src/lib/xivapi-actions.ts) の純関数部分の検証 (2026-09-06)。
 * 実行: `node scripts/check-xivapi-actions.mjs`
 *
 * XIVAPI 実 API には本環境から到達できないため、v2 の応答の形
 * (`rows[].row_id` / `rows[].fields.Name`) に対する契約検証という位置づけ。
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const SRC = "src/lib/xivapi-actions.ts";

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

const outDir = mkdtempSync(join(tmpdir(), "xivapi-actions-check-"));
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
  const m = await import(pathToFileURL(join(outDir, "xivapi-actions.js")).href);

  console.log("\n[引くかどうか]");
  check("英語名は引く", m.needsJapaneseLookup("Akh Morn"), true);
  check("日本語名は引かない", m.needsJapaneseLookup("アク・モーン"), false);
  check("null / 空は引かない", [m.needsJapaneseLookup(null), m.needsJapaneseLookup("")], [false, false]);

  console.log("\n[URL]");
  check(
    "重複除去 / 昇順 / 0 と負値を除く",
    m.buildActionSheetUrl([26814, 3, 26814, 0, -1, 3.5]),
    "https://v2.xivapi.com/api/sheet/Action?rows=3,26814&fields=Name&language=ja",
  );

  console.log("\n[応答のパース]");
  const parsed = m.parseActionSheetRows({
    schema: "exdschema@x",
    rows: [
      { row_id: 26814, fields: { Name: "アク・モーン" } },
      { row_id: 1, fields: { Name: "" } },
      { row_id: 2, fields: {} },
      { row_id: "3", fields: { Name: "x" } },
      null,
    ],
  });
  check("row_id → Name (空 / 欠損 / 文字列 ID は捨てる)", [...parsed.entries()], [[26814, "アク・モーン"]]);
  check("rows が無い", [...m.parseActionSheetRows({ error: "x" }).entries()], []);
  check("object 以外", [...m.parseActionSheetRows("nope").entries()], []);

  console.log("\n[引くべき ID の選別]");
  const events = [
    { t: 1, job: "Paladin", ability: "Akh Morn", id: 26814 },
    { t: 2, job: "WhiteMage", ability: "Akh Morn", id: 26814 },
    { t: 3, job: "Bard", ability: "アク・モーン", id: 26814 },
    { t: 4, job: "Bard", ability: "Exaflare", id: 500, ja: "エクサフレア" },
    { t: 5, job: "Bard", ability: "Doom" },
    { t: 6, job: "Bard", ability: "Slam", id: 99 },
  ];
  check("重複除去 / 日本語済み / ID 無しを除く", m.collectLookupIds(events), [26814, 99]);
  check("chunk", m.chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  check("chunk 空", m.chunk([], 2), []);

  console.log("\n[書き戻し]");
  const names = new Map([
    [26814, "アク・モーン"],
    [99, "Slam"],
  ]);
  const n = m.applyJapaneseNames(events, names);
  check("書き換えた件数 (同名は書かない / 既存 ja は保持)", n, 2);
  check(
    "書き戻し結果",
    events.map((e) => e.ja ?? null),
    ["アク・モーン", "アク・モーン", null, "エクサフレア", null, null],
  );
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
