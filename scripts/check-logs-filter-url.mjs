/**
 * 練習ログの絞り込み URL (src/lib/logs-filter-url.ts) の検証
 * (2026-09-08、UI-5)。
 * 実行: `node scripts/check-logs-filter-url.mjs`
 *
 * 重点は 3 つ:
 *   - 4層前半 / 後半が `4a` / `4b` になり、内部 index (4 / 5) が漏れないこと
 *   - 候補に無い値 (閲覧者が URL に手で書いた値) が null に倒れること
 *     — 照合しないと「どの pull にも一致しない空の一覧」が出る
 *   - 「全層」に戻したときにキーごと消え、他のキーは残ること
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const SRC = "src/lib/logs-filter-url.ts";

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

const outDir = mkdtempSync(join(tmpdir(), "logs-filter-url-check-"));
try {
  execFileSync(
    "npx",
    [
      "tsc", SRC,
      "--outDir", outDir,
      "--target", "es2022",
      "--module", "es2022",
      "--moduleResolution", "bundler",
      "--strict",
    ],
    { stdio: "inherit" },
  );
  const { floorParamValue, parseFloorParam, parsePhaseParam, withParam } =
    await import(pathToFileURL(join(outDir, "logs-filter-url.js")).href);

  // 4 層構成 + 最終層が前半 / 後半に分かれるティア (M8S 型)。内部 index は
  // 1..5、表示層番号は 1..4。
  const CHOICES = [
    { index: 1, displayFloor: 1, half: null },
    { index: 2, displayFloor: 2, half: null },
    { index: 3, displayFloor: 3, half: null },
    { index: 4, displayFloor: 4, half: "first" },
    { index: 5, displayFloor: 4, half: "second" },
  ];

  console.log("URL 値の組み立て");
  check(
    "分割の無い層は番号そのまま / 前半後半は a・b",
    CHOICES.map(floorParamValue),
    ["1", "2", "3", "4a", "4b"],
  );
  check(
    "内部 index (5) は URL に出さない",
    floorParamValue(CHOICES[4]),
    "4b",
  );

  console.log("\n層パラメータの解釈");
  check("3 → index 3", parseFloorParam("3", CHOICES), 3);
  check("4a → index 4 (前半)", parseFloorParam("4a", CHOICES), 4);
  check("4b → index 5 (後半)", parseFloorParam("4b", CHOICES), 5);
  check("大文字も受ける", parseFloorParam("4B", CHOICES), 5);
  check("前後の空白を落とす", parseFloorParam("  4a ", CHOICES), 4);
  check("未指定は null", parseFloorParam(null, CHOICES), null);
  check("空文字は null", parseFloorParam("", CHOICES), null);
  // ここが肝: 候補に無い値を通すと空の一覧が出る。
  check("候補に無い層は null", parseFloorParam("9", CHOICES), null);
  check("5 は候補に無い (内部 index を書かれても効かない)", parseFloorParam("5", CHOICES), null);
  check("数字でない値は null", parseFloorParam("../etc", CHOICES), null);
  check("候補が空なら常に null", parseFloorParam("1", []), null);
  // 分割の無いティア (encounter が 4 つ) では 4a / 4b は存在しない。
  const PLAIN = [
    { index: 1, displayFloor: 1, half: null },
    { index: 2, displayFloor: 2, half: null },
    { index: 3, displayFloor: 3, half: null },
    { index: 4, displayFloor: 4, half: null },
  ];
  check("分割の無いティアで 4 は通る", parseFloorParam("4", PLAIN), 4);
  check("分割の無いティアで 4a は通らない", parseFloorParam("4a", PLAIN), null);

  console.log("\nフェーズパラメータの解釈");
  const PHASES = [1, 2, 3, 4, 5, 6, 7];
  check("2 → 2", parsePhaseParam("2", PHASES), 2);
  check("P2 のように貼られても受ける", parsePhaseParam("P2", PHASES), 2);
  check("p7 (小文字)", parsePhaseParam("p7", PHASES), 7);
  check("観測されていないフェーズは null", parsePhaseParam("9", PHASES), null);
  check("空 / 未指定は null", [parsePhaseParam("", PHASES), parsePhaseParam(null, PHASES)], [null, null]);
  check("数字でない値は null", parsePhaseParam("abc", PHASES), null);
  check("候補が空なら常に null", parsePhaseParam("1", []), null);

  console.log("\nクエリ文字列の差し替え");
  check("空から 1 個足す", withParam("", "floor", "4b"), "floor=4b");
  check("? 付きでも受ける", withParam("?floor=1", "floor", "4b"), "floor=4b");
  check("null でキーごと落とす", withParam("floor=4b", "floor", null), "");
  check("空文字でもキーごと落とす", withParam("floor=4b", "floor", ""), "");
  check(
    "他のキーは残す",
    withParam("view=cards&floor=1", "floor", "3"),
    "view=cards&floor=3",
  );
  check(
    "他のキーだけ残して落とす",
    withParam("view=cards&floor=1", "floor", null),
    "view=cards",
  );
  check(
    "値はエンコードされる (URL に生で載せない)",
    withParam("", "floor", "a b&c"),
    "floor=a+b%26c",
  );
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
