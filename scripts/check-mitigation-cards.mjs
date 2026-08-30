/**
 * 軽減表カードの抽出ロジック検証 (2026-08-30)。
 * 実行: `node scripts/check-mitigation-cards.mjs`
 *
 * チェックボックス列の抽出は「担当者の列を奪わない」ことが要点 (奪うと
 * 「MT: 堅陣」の表示が消える) なので、そこを重点的に検証する。
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}\n       expected: ${e}\n       actual:   ${a}`); }
}
const outDir = mkdtempSync(join(tmpdir(), "mit-"));
try {
  execFileSync("npx", ["tsc","src/lib/sheet-csv.ts","--outDir",outDir,"--target","es2022","--module","es2022","--moduleResolution","bundler","--strict"], { stdio: "inherit" });
  const mod = await import(pathToFileURL(join(outDir, "sheet-csv.js")).href);

  const table = {
    headers: ["Phase","Time","Action","Damage","軽減率","最終ダメージ","MT","H1","堅陣","士気","",""],
    rows: [
      ["", "00:16","アルカディアン・フレイム","370,000","8.41","149,960","堅陣","医術","TRUE","FALSE","TRUE","FALSE"],
      ["", "00:20","AA","105,000","0","105,000","","","FALSE","FALSE","FALSE","FALSE"],
      ["", "00:28","レプリケーション","0","0","0","","士気","FALSE","TRUE","FALSE","TRUE"],
      ["", "", "", "", "", "", "", "", "", "", "牽制", "ブレス"],
    ],
  };
  const cols = table.headers.map((_, i) => i).slice(1);
  const rows = mod.buildSheetCardRows(table, cols, { mitigation: true });

  console.log("\n[チェック列の抽出]");
  const flame = rows.find((r) => r.heading.includes("アルカディアン"));
  check("見出しに時刻+技名", flame.heading, "00:16 アルカディアン・フレイム");
  check("ON の列だけ拾う", flame.checks.map((c) => c.label), ["堅陣", "牽制"]);
  const rep = rows.find((r) => r.heading.includes("レプリケーション"));
  check("行ごとに ON が変わる", rep.checks.map((c) => c.label), ["士気", "ブレス"]);

  console.log("\n[担当列を奪わない]");
  check(
    "MT/H1 の担当セルは cells に残る",
    flame.cells.map((c) => `${c.label}:${c.value}`),
    ["MT:堅陣", "H1:医術"],
  );
  check(
    "チェック列は cells に出さない",
    flame.cells.some((c) => c.value === "TRUE"),
    false,
  );

  console.log("\n[見出しが空の列はラベル候補で補う]");
  check(
    "空見出しの列は列内の非 boolean 値をラベルに",
    flame.checks.map((c) => c.label).includes("牽制"),
    true,
  );

  console.log("\n[AA と数値サマリ]");
  check("AA 行は出さない", rows.some((r) => r.heading.includes("AA")), false);
  check(
    "ダメージ→軽減率→最終の順",
    flame.stats.map((s) => s.kind),
    ["damage", "rate", "final"],
  );
} finally { rmSync(outDir, { recursive: true, force: true }); }
console.log("");
if (failures) { console.error(`${failures} 件失敗`); process.exit(1); }
console.log("すべて成功");
