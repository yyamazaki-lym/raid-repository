/**
 * レポート / fight → カテゴリ解決 (src/lib/fflogs-category.ts) の検証 (2026-09-06)。
 * 実行: `node scripts/check-fflogs-category.mjs`
 *
 * 実機: 絶オメガの 2024-07 以降 (Dawntrail の "Ultimates (Legacy)" zone、
 * タイトル「絶シリーズ（過去）」) がカテゴリに紐づかず練習ログに出なかった件。
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const SRC = "src/lib/fflogs-category.ts";
let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) console.log(`  ok   ${name}`);
  else { failures += 1; console.log(`  FAIL ${name}\n       expected: ${e}\n       actual:   ${a}`); }
}

const outDir = mkdtempSync(join(tmpdir(), "fflogs-category-check-"));
try {
  execFileSync("npx", ["tsc", SRC, "--outDir", outDir, "--target", "es2022", "--module", "es2022", "--moduleResolution", "bundler", "--strict"], { stdio: "inherit" });
  // tsc は拡張子なしの相対 import を出すので Node ESM 向けに .js を付ける。
  const { readdirSync, readFileSync, writeFileSync } = await import("node:fs");
  for (const f of readdirSync(outDir)) {
    if (!f.endsWith(".js")) continue;
    const fp = join(outDir, f);
    writeFileSync(fp, readFileSync(fp, "utf8").replace(/(from\s+["'])(\.\.?\/[^"']+?)(?<!\.js)(["'])/g, "$1$2.js$3"));
  }
  const m = await import(pathToFileURL(join(outDir, "fflogs-category.js")).href);

  const cats = [
    { id: "top", name: "絶オメガ検証戦", zoneIds: [], keywords: [] },
    { id: "dsr", name: "絶竜詩戦争", zoneIds: [], keywords: [] },
    { id: "tea", name: "絶アレキサンダー討滅戦", zoneIds: [], keywords: [] },
    { id: "heavy", name: "至天の座アルカディア零式：ヘビー級", zoneIds: [], keywords: [] },
  ];

  console.log("\n[レポート単位]");
  check("zone 名 (Endwalker 期の絶オメガ zone)", m.resolveCategory(cats, 53, "The Omega Protocol (Ultimate)", "day 12"), "top");
  check("Legacy zone + 汎用タイトルは決められない", m.resolveCategory(cats, 59, "Ultimates (Legacy)", "絶シリーズ（過去）"), null);
  check("zone ID 明示 (1 件)", m.resolveCategory([{ ...cats[0], zoneIds: [59] }, cats[1]], 59, "Ultimates (Legacy)", null), "top");
  check("zone ID が複数カテゴリに重なると null", m.resolveCategory([{ ...cats[0], zoneIds: [59] }, { ...cats[1], zoneIds: [59] }], 59, "Ultimates (Legacy)", null), null);

  console.log("\n[fight 単位]");
  check("The Omega Protocol → 絶オメガ", m.resolveCategoryByFightName(cats, "The Omega Protocol"), "top");
  check("Dragonsong's Reprise → 絶竜詩", m.resolveCategoryByFightName(cats, "Dragonsong's Reprise"), "dsr");
  check("The Epic of Alexander → 絶アレキ", m.resolveCategoryByFightName(cats, "The Epic of Alexander"), "tea");
  check("零式のボス名は決まらない", m.resolveCategoryByFightName(cats, "Dancing Green"), null);
  check("fight 名優先、無ければレポート", [
    m.resolveFightCategory(cats, "The Omega Protocol", "dsr"),
    m.resolveFightCategory(cats, "Dancing Green", "heavy"),
    m.resolveFightCategory(cats, null, null),
  ], ["top", "heavy", null]);

  console.log("\n[代表カテゴリ]");
  check("最多", m.consensusCategory(["top", "top", "dsr", null]), "top");
  check("同数は先勝ち", m.consensusCategory(["dsr", "top"]), "dsr");
  check("全部 null", m.consensusCategory([null, null]), null);
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
if (failures > 0) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log("\nall checks passed");
