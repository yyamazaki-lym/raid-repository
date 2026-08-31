/**
 * 軽減表の「アビリティ名の見出し行」検出の検証 (2026-08-31)。
 * 実行: `node scripts/check-ability-header.mjs`
 *
 * 実物の xlsx (アルカディアヘビー級 軽減表) を解析して分かった構造:
 *   行3 = ジョブ名 / 行4 = アビリティ名 / 行5 = 対象種別
 *   26 行目のアイコンは =INDEX(Skill!D:D, MATCH(<列>$4, Skill!C:C, 0))
 *   すなわち 4 行目の名前で引かれているだけ。
 * ここを取り違えると、カードに**別の軽減名**が並ぶ。
 */

import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// mitigation-terms も一緒にコンパイルする (sheet-csv が import している)。
const SRC = ["src/lib/sheet-csv.ts", "src/lib/mitigation-terms.ts"];

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

const outDir = mkdtempSync(join(tmpdir(), "ability-header-check-"));
try {
  execFileSync(
    "npx",
    ["tsc", ...SRC, "--outDir", outDir, "--target", "es2022", "--module", "es2022",
     "--moduleResolution", "bundler", "--strict"],
    { stdio: "inherit" },
  );
  // 出力は拡張子なしの相対 import になるので、ESM で読めるよう補う。
  for (const f of readdirSync(outDir)) {
    const full = join(outDir, f);
    writeFileSync(
      full,
      readFileSync(full, "utf8").replace(
        /from "(\.\/[^"]+)"/g,
        (_, p) => `from "${p}.js"`,
      ),
    );
  }
  const mod = await import(pathToFileURL(join(outDir, "sheet-csv.js")).href);

  // 実物と同じ並び。列 0..3 は Phase/Time/Action 等、4 以降がアビリティ列。
  const grid = [
    ["", "", "", "", "", "", "", ""],                                   // 行1
    ["", "", "", "", "", "", "", ""],                                   // 行2
    ["hide", "", "", "", "暗黒騎士", "暗黒騎士", "忍者", "赤魔道士"],      // 行3 ジョブ
    ["", "", "", "", "リプライザル", "ダークミッショナリー", "牽制", "アドル"], // 行4 技名
    ["", "", "", "", "RANGE_ENEMY", "RANGE_PARTY", "SINGLE_ENEMY", "SINGLE_ENEMY"], // 行5 対象
    ["Phase", "Time", "Action", "Type", "", "", "", ""],                // 行6 見出し
    ["P1", "0:21", "AA", "Physical", "FALSE", "FALSE", "TRUE", "FALSE"],
    ["P1", "0:40", "トップティアスラム", "Physical", "TRUE", "FALSE", "TRUE", "TRUE"],
  ];

  console.log("\n[見出し 3 行の検出]");
  const rows = mod.findAbilityHeaderRows(grid, [4, 5, 6, 7]);
  check("対象種別の行を見つける", rows.targetRow, 4);
  check("その 1 つ上がアビリティ行", rows.abilityRow, 3);
  check("2 つ上がジョブ行", rows.jobRow, 2);

  console.log("\n[列 → 名前 + ジョブ]");
  const labels = mod.buildAutoColumnLabels(grid, rows);
  check("DO 相当の列は牽制/忍者", labels[6], { name: "牽制", job: "忍者" });
  check("EA 相当の列はアドル/赤魔道士", labels[7], {
    name: "アドル",
    job: "赤魔道士",
  });
  check("複合語も落とさない", labels[5], {
    name: "ダークミッショナリー",
    job: "暗黒騎士",
  });
  // 制御用の "hide" をジョブ名として出さない。
  check("値の無い列は作らない", labels[0], undefined);

  console.log("\n[取り違えないこと]");
  // 対象種別が無いシートでも、チェック列に名前が並ぶ行を選べる。
  // (名前らしい値が 3 列以上そろって初めて採用する。数が少ないと
  //  たまたま文字が入っている行を誤って見出しにしてしまうため。)
  const noTarget = [
    ["", "", "", "", ""],
    ["", "", "牽制", "アドル", "リプライザル"],
    ["Phase", "Action", "", "", ""],
    ["P1", "AA", "TRUE", "FALSE", "TRUE"],
  ];
  check(
    "対象種別が無ければ文字列の多い行",
    mod.findAbilityHeaderRows(noTarget, [2, 3, 4]).abilityRow,
    1,
  );
  check(
    "候補が 3 列に満たなければ採用しない",
    mod.findAbilityHeaderRows(
      [["", "", ""], ["", "牽制", "アドル"], ["P1", "TRUE", "FALSE"]],
      [1, 2],
    ),
    null,
  );
  // 名前らしい行が無いのに決め打ちしない (誤ラベルは誤情報になる)。
  check(
    "手がかりが無ければ null",
    mod.findAbilityHeaderRows(
      [["Phase", "Action"], ["P1", "AA"], ["P1", "AA"]],
      [1],
    ),
    null,
  );
  // 数値・時刻・TRUE/FALSE を名前として拾わない。
  const numeric = [
    ["", "", "", ""],
    ["", "", "0:21", "150000"],
    ["", "", "SELF", "SELF"],
  ];
  check("数値や時刻は名前にしない", mod.findAbilityHeaderRows(numeric, [2, 3]), null);

  console.log("\n[見出し行を判定から除く]");
  const table = { headers: grid[0], rows: grid.slice(1) };
  // 見出し行を残すと、技名の文字列でチェック列が「文字列の列」に化ける。
  const kept = mod.diagnoseSheetColumns(table);
  const dropped = mod.diagnoseSheetColumns(table, new Set([1, 2, 3, 4]));
  check("除かないと check にならない", kept[6].role, "text");
  check("除けば check になる", dropped[6].role, "check");
  check("ON 数も正しく数える", dropped[6].checkedCount, 2);

  console.log("\n[担当なしの値をカードに出さない]");
  // 実機で「無し」だけのチップが 1 行に何個も並んでいた。
  for (const v of ["無し", "なし", "ナシ", "None", "N/A", "-"]) {
    check(`${v} はノイズ`, mod.isNoiseValue(v), true);
  }
  // 実在する担当者名や技名を巻き添えに消さない。
  for (const v of ["牽制", "マクロコスモス", "MT", "無敵"]) {
    check(`${v} は残す`, mod.isNoiseValue(v), false);
  }

} finally {
  rmSync(outDir, { recursive: true, force: true });
}

console.log(failures === 0 ? "\nすべて OK" : `\n${failures} 件 FAIL`);
process.exit(failures === 0 ? 0 : 1);
