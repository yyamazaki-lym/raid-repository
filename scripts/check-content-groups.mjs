/**
 * コンテンツ分類器 (src/lib/content-groups.ts) の検証 (2026-09-06)。
 * 実行: `node scripts/check-content-groups.mjs`
 *
 * 絶竜詩戦争のカテゴリ名が分類できず FFLogs の英語 zone 名と突き合わせられ
 * なかった件の再発防止。カテゴリ名 (日本語) と FFLogs zone 名 (英語) が
 * 同じグループに落ちることを、絶 / 零式の代表例で確認する。
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const SRC = "src/lib/content-groups.ts";
let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}\n       expected: ${e}\n       actual:   ${a}`);
  }
}

const outDir = mkdtempSync(join(tmpdir(), "content-groups-check-"));
try {
  execFileSync(
    "npx",
    ["tsc", SRC, "--outDir", outDir, "--target", "es2022", "--module", "es2022", "--moduleResolution", "bundler", "--strict"],
    { stdio: "inherit" },
  );
  const m = await import(pathToFileURL(join(outDir, "content-groups.js")).href);
  const g = (t) => [...m.findContentGroups(t)].sort();

  console.log("\n[カテゴリ名 (日本語) と FFLogs zone 名 (英語) が同じグループ]");
  const pairs = [
    ["絶竜詩戦争", "Dragonsong's Reprise (Ultimate)"],
    ["絶竜詩", "Dragonsong's Reprise"],
    ["絶アレキサンダー討滅戦", "The Epic of Alexander (Ultimate)"],
    ["絶バハムート討滅戦", "The Unending Coil of Bahamut (Ultimate)"],
    ["絶アルテマウェポン破壊作戦", "The Weapon's Refrain (Ultimate)"],
    ["絶オメガ検証戦", "The Omega Protocol (Ultimate)"],
    ["絶もうひとつの未来", "Futures Rewritten (Ultimate)"],
    ["至天の座アルカディア零式：ヘビー級", "AAC Heavyweight M9-M12 (Savage)"],
    ["至天の座アルカディア零式：ライトヘビー級", "AAC Light-heavyweight M1-M4 (Savage)"],
    ["至天の座アルカディア零式：クルーザー級", "AAC Cruiserweight M5-M8 (Savage)"],
  ];
  for (const [ja, en] of pairs) {
    const a = g(ja), b = g(en);
    check(`${ja} ⇔ ${en}`, a.length === 1 && a[0] === b[0], true);
  }

  console.log("\n[絶判定]");
  check("絶竜詩戦争 は絶", m.isUltimateContent("絶竜詩戦争"), true);
  check("Dragonsong's Reprise は絶", m.isUltimateContent("Dragonsong's Reprise (Ultimate)"), true);
  check("ヘビー級は絶ではない", m.isUltimateContent("至天の座アルカディア零式：ヘビー級"), false);

  console.log("\n[混同しない]");
  check("ライトヘビー級 は LH のみ", g("至天の座アルカディア：ライトヘビー級"), [10]);
  check("分類不能は空", g("Day 5 練習"), []);
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
