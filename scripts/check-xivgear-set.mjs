/**
 * XivGear `/fulldata` 要約パーサの検証 (2026-08-30)。
 * 実行: `node scripts/check-xivgear-set.mjs`
 *
 * 入力サンプルは上流の型定義 (xiv-gear-planner/gear-planner の
 * packages/xivmath/src/geartypes.ts, SheetStatsExport / SetStatsExport /
 * ItemSlotExport) に合わせて構成している。実 API には本環境から到達
 * できないため、契約 (型) に対する検証という位置づけ。
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const SRC = "src/lib/xivgear-set.ts";

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

const outDir = mkdtempSync(join(tmpdir(), "xivgear-check-"));
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
  const mod = await import(pathToFileURL(join(outDir, "xivgear-set.js")).href);

  const slot = (id, materiaIds = []) => ({
    id,
    materia: materiaIds.map((m) => ({ id: m })),
  });
  /** 全部位 (盾なし) が埋まった竜騎士のセット。 */
  const fullDrg = {
    Weapon: slot(1001, [10, 10]),
    Head: slot(1002, [10, -1]),
    Body: slot(1003, [10, 10]),
    Hand: slot(1004),
    Legs: slot(1005),
    Feet: slot(1006),
    Ears: slot(1007),
    Neck: slot(1008),
    Wrist: slot(1009),
    RingLeft: slot(1010),
    RingRight: slot(1011),
  };

  console.log("\n[基本の要約]");
  const s1 = mod.parseXivgearFulldata({
    name: "ヘビー級 BiS",
    job: "DRG",
    level: 100,
    sets: [
      {
        name: "2.5 GCD",
        food: 4000,
        items: fullDrg,
        computedStats: {
          crit: 3000,
          determination: 2000,
          dhit: 1500,
          skillspeed: 500,
          spellspeed: 0,
          piety: 0,
          tenacity: 0,
        },
      },
    ],
  });
  check("シート名", s1.sheetName, "ヘビー級 BiS");
  check("ジョブ", s1.job, "DRG");
  check("セット名", s1.sets[0].name, "2.5 GCD");
  check("埋まった部位数", s1.sets[0].filledSlots, 11);
  check("盾なしジョブの期待部位数は 11", s1.sets[0].expectedSlots, 11);
  check("未設定なし", s1.sets[0].missingSlots, []);
  check("マテリア数 (id=-1 は数えない)", s1.sets[0].materiaCount, 5);
  check("食事あり", s1.sets[0].hasFood, true);
  check(
    "値 0 のサブステは出さない",
    s1.sets[0].stats.map((x) => x.label),
    ["クリティカル", "意志力", "ダイレクト", "SS(物理)"],
  );

  console.log("\n[未設定スロットの検出]");
  const partial = { ...fullDrg };
  delete partial.Legs;
  delete partial.RingRight;
  const s2 = mod.parseXivgearFulldata({
    name: "作りかけ",
    job: "DRG",
    level: 100,
    sets: [{ name: "wip", items: partial, computedStats: {} }],
  });
  check("未設定スロットを日本語で列挙", s2.sets[0].missingSlots, [
    "脚",
    "指輪(右)",
  ]);
  check("食事なし", s2.sets[0].hasFood, false);

  console.log("\n[盾の扱い]");
  const pldNoShield = mod.parseXivgearFulldata({
    name: "PLD",
    job: "PLD",
    level: 100,
    sets: [{ name: "s", items: fullDrg, computedStats: {} }],
  });
  check("ナイトは盾込みで 12 部位", pldNoShield.sets[0].expectedSlots, 12);
  check("盾が無ければ未設定に出る", pldNoShield.sets[0].missingSlots, ["盾"]);

  const whmNoShield = mod.parseXivgearFulldata({
    name: "WHM",
    job: "WHM",
    level: 100,
    sets: [{ name: "s", items: fullDrg, computedStats: {} }],
  });
  check(
    "ナイト以外は盾が無くても未設定にしない",
    whmNoShield.sets[0].missingSlots,
    [],
  );

  console.log("\n[複数セット / セパレータ]");
  const multi = mod.parseXivgearFulldata({
    name: "sheet",
    job: "SGE",
    level: 100,
    sets: [
      { name: "sep", isSeparator: true, items: {} },
      { name: "A", items: fullDrg, computedStats: {} },
      { name: "B", jobOverride: "WHM", items: fullDrg, computedStats: {} },
    ],
  });
  check("セパレータは除外", multi.sets.length, 2);
  check("jobOverride が優先される", multi.sets[1].job, "WHM");
  check("override 無しはシートのジョブ", multi.sets[0].job, "SGE");

  console.log("\n[壊れた入力]");
  check("null", mod.parseXivgearFulldata(null), null);
  check("sets が無い", mod.parseXivgearFulldata({ name: "x" }), null);
  check("配列", mod.parseXivgearFulldata([1, 2]), null);
  check(
    "実データが 1 件も無い",
    mod.parseXivgearFulldata({ name: "x", sets: [{ isSeparator: true }] }),
    null,
  );
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

console.log("");
if (failures > 0) {
  console.error(`${failures} 件失敗`);
  process.exit(1);
}
console.log("すべて成功");
