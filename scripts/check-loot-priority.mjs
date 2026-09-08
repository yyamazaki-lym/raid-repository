/**
 * ロットの「欲しい人」行列 (src/lib/loot-priority.ts) の検証
 * (2026-09-08、W-24 + W-25)。
 * 実行: `node scripts/check-loot-priority.mjs`
 *
 * 固定したいのは 4 点:
 *   1. 提案順が **取得済の少ない順 → 残りの多い順 → 表示名** で、
 *      実行ごとに揺れない
 *   2. ナイト以外で OffHand を数えない (分母が 12 にならない / 行も出ない)
 *   3. そのジョブで数えない部位が `obtainedSlots` に入っていても無視する
 *      (ジョブを後から変えたときに「12/11 取得」にならない)
 *   4. セルの意味 (最良 / 代替あり / 済 / 対象外) が 1 箇所で決まる
 *
 * ⚠ tsc は `process.execPath` + `node_modules/typescript/bin/tsc` で起動する
 *   (`npx` 経由は Windows で ENOENT / EINVAL になり、CI の ubuntu では
 *   通るので壊れていることに気付けない)。
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

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

const outDir = mkdtempSync(join(tmpdir(), "loot-priority-check-"));
try {
  execFileSync(
    process.execPath,
    [
      "node_modules/typescript/bin/tsc",
      "src/lib/loot-priority.ts",
      "--outDir", outDir,
      "--target", "es2022",
      "--module", "es2022",
      "--moduleResolution", "bundler",
      "--strict",
    ],
    { stdio: "inherit" },
  );
  for (const f of readdirSync(outDir)) {
    if (!f.endsWith(".js")) continue;
    const fp = join(outDir, f);
    writeFileSync(fp, readFileSync(fp, "utf8").replace(
      /(from\s+["'])(\.\.?\/[^"']+?)(?<!\.js)(["'])/g, "$1$2.js$3"));
  }
  const m = await import(pathToFileURL(join(outDir, "loot-priority.js")).href);

  const mem = (id, label, job, obtainedSlots) => ({
    bisLinkId: id,
    label,
    job,
    obtainedSlots,
  });

  console.log("\n[提案順]");
  let mx = m.buildLootWantMatrix([
    mem("a", "あかね", "SAM", ["Weapon", "Head", "Body"]),
    mem("b", "びわ", "WHM", ["Weapon"]),
    mem("c", "ちとせ", "DRK", ["Weapon", "Head"]),
  ]);
  const legs = mx.rows.find((r) => r.slot === "Legs");
  check(
    "取得済の少ない順",
    legs.wanters.map((w) => [w.label, w.obtained, w.rank]),
    [
      ["びわ", 1, 1],
      ["ちとせ", 2, 2],
      ["あかね", 3, 3],
    ],
  );
  check(
    "取得済が同数なら表示名で安定 (残りも同数)",
    m
      .buildLootWantMatrix([
        mem("z", "ずみ", "SAM", ["Weapon"]),
        mem("a", "あかね", "SAM", ["Weapon"]),
      ])
      .rows.find((r) => r.slot === "Legs")
      .wanters.map((w) => w.label),
    ["あかね", "ずみ"],
  );

  console.log("\n[部位の数え方]");
  mx = m.buildLootWantMatrix([mem("p", "ぱら", "PLD", [])]);
  check("ナイトは 12 部位", mx.members[0].total, 12);
  check("OffHand の行が出る", mx.rows.some((r) => r.slot === "OffHand"), true);
  mx = m.buildLootWantMatrix([mem("s", "さむ", "SAM", [])]);
  check("侍は 11 部位", mx.members[0].total, 11);
  check("OffHand の行は出ない", mx.rows.some((r) => r.slot === "OffHand"), false);
  check(
    "ジョブ不明も 11 部位",
    m.buildLootWantMatrix([mem("n", "なし", null, [])]).members[0].total,
    11,
  );
  check(
    "数えない部位の取得済は無視する",
    m.buildLootWantMatrix([mem("s", "さむ", "SAM", ["OffHand", "Weapon"])])
      .members[0].obtained,
    1,
  );

  console.log("\n[済 / 完成]");
  const all = m.buildLootWantMatrix([
    mem("s", "さむ", "SAM", [
      "Weapon", "Head", "Body", "Hand", "Legs", "Feet",
      "Ears", "Neck", "Wrist", "RingLeft", "RingRight",
    ]),
  ]);
  check("全部位取得なら allDone", all.allDone, true);
  check("済の人は doneIds に入る", all.rows[0].doneIds, ["s"]);
  check("欲しい人 0 人", all.rows[0].wanters.length, 0);
  check("空入力", m.buildLootWantMatrix([]), { members: [], rows: [], allDone: true });

  console.log("\n[セルの意味]");
  mx = m.buildLootWantMatrix([
    mem("a", "あかね", "SAM", ["Legs"]),
    mem("b", "びわ", "WHM", []),
    mem("p", "ぱら", "PLD", []),
  ]);
  const legsRow = mx.rows.find((r) => r.slot === "Legs");
  const offhandRow = mx.rows.find((r) => r.slot === "OffHand");
  // びわ (WHM) と ぱら (PLD) はどちらも取得済 0。第 2 キー「残りの多い順」で
  // 12 部位のナイトが先に来る (11 部位の白魔は 2 番目)。
  check(
    "最良 / 代替あり / 済",
    [
      m.lootCellKind(legsRow, "p"),
      m.lootCellKind(legsRow, "b"),
      m.lootCellKind(legsRow, "a"),
    ],
    ["first", "other", "done"],
  );
  check(
    "そのジョブで数えない部位は対象外",
    m.lootCellKind(offhandRow, "a"),
    "n/a",
  );
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
