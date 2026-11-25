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
    process.execPath,
    ["node_modules/typescript/bin/tsc", ...SRC, "--outDir", outDir, "--target", "es2022", "--module", "es2022",
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

  console.log("\n[隠した見出し行 (2026-11-25、L-8)]");
  // 本番の実物 (絶もうひとつの未来): ジョブ名・アビリティ名の行をシートで隠して
  // いて、gviz の CSV からは落ちる。export の CSV には全行が入る。
  const ID = "1iiRaSESMf_bKw3IOMXdfb-5Merlrwhmvj2f1zMwouG0";
  const shareUrl = `https://docs.google.com/spreadsheets/d/${ID}/edit?gid=2111891566#gid=2111891566`;
  check(
    "export の URL (URL の gid)",
    mod.toSheetExportCsvUrl(shareUrl),
    `https://docs.google.com/spreadsheets/d/${ID}/export?format=csv&gid=2111891566`,
  );
  check(
    "export の URL (層の gid で上書き)",
    mod.toSheetExportCsvUrl(shareUrl, "123"),
    `https://docs.google.com/spreadsheets/d/${ID}/export?format=csv&gid=123`,
  );
  check(
    "公開 (pub) の URL・別ホスト・壊れた URL は null",
    [
      mod.toSheetExportCsvUrl("https://docs.google.com/spreadsheets/d/e/2PACX-abcdefghijk/pubhtml?gid=0"),
      mod.toSheetExportCsvUrl(`https://evil.example.com/spreadsheets/d/${ID}/edit`),
      mod.toSheetExportCsvUrl("not a url"),
      mod.toSheetExportCsvUrl(null),
    ],
    [null, null, null, null],
  );

  // 実物の形を縮めたもの。列 0..4 は Phase/Time/Action 等、5..8 がチェック列。
  const fullGrid = [
    ["", "", "", "", "", "", "", "", ""],
    ["", "Phase", "Total Time", "Time", "Action", "Mitigation", "Barrier", "Mitigation", "Mitigation"],
    ["", "TRUE", "", "", "P1_フェイトブレイカー", "ナイト", "ナイト", "賢者", "賢者"], // ジョブ (隠し行)
    ["", "FALSE", "", "", "Skill", "パッセージ・オブ・アームズ", "ディヴァインヴェール", "ホーリズム", "ケーラコレ"], // 技名 (隠し行)
    ["", "TRUE", "", "", "Assign", "RANGE_PARTY", "RANGE_PARTY", "RANGE_PARTY", "RANGE_PARTY"], // 対象 (隠し行)
    ["", "FALSE", "", "", "Charge", "1", "1", "1", "1"],
    ["", "Phase", "Time", "", "Action", "", "", "", ""],
    ["", "戦闘前", "-00:20", "-00:20", "戦闘開始まで20秒", "FALSE", "FALSE", "FALSE", "FALSE"], // 隠し行
    ["", "開幕", "00:00", "00:00", "戦闘開始！", "FALSE", "TRUE", "FALSE", "FALSE"],
    ["", "", "00:03", "00:03", "AA ", "FALSE", "FALSE", "TRUE", "FALSE"],
    ["", "", "00:06", "00:06", "AA", "TRUE", "FALSE", "FALSE", "TRUE", ""],
  ];
  // gviz は隠した行 (2〜5、7) を落とし、見出しを 1 行目に寄せる。セルの空白は toSheetTable が削る。
  const viewRaw = [fullGrid[6], fullGrid[8], fullGrid[9], fullGrid[10]];
  const view = mod.toSheetTable(viewRaw);
  const viewGrid = [view.headers, ...view.rows];
  const checks = mod.diagnoseSheetColumns(view).filter((c) => c.role === "check").map((c) => c.index);
  check("表示中の表のチェック列", checks, [5, 6, 7, 8]);
  check("表示中の表 (gviz) からは見出し行が見つからない (今までの症状)", mod.findAbilityHeaderRows(viewGrid, checks), null);
  check("全行の表 (export) と列の並びが揃っている", mod.sameColumnLayout(view, fullGrid), true);
  const fullRows = mod.findAbilityHeaderRows(fullGrid, checks);
  check("全行の表から見出し行が見つかる", fullRows, { abilityRow: 3, jobRow: 2, targetRow: 4 });
  const fullLabels = mod.buildAutoColumnLabels(fullGrid, fullRows);
  check("列 5 は パッセージ・オブ・アームズ / ナイト", fullLabels[5], { name: "パッセージ・オブ・アームズ", job: "ナイト" });
  check("列 8 は ケーラコレ / 賢者", fullLabels[8], { name: "ケーラコレ", job: "賢者" });

  // 対照: 列が 1 本ずれた表・別のシートの表・空の表では揃っていると言わない。
  check("1 列ずれた全行の表は揃っていない", mod.sameColumnLayout(view, fullGrid.map((r) => ["", ...r])), false);
  check(
    "別のシートの表は揃っていない",
    mod.sameColumnLayout(view, [["", "P2", "01:00", "01:00", "別の技", "TRUE", "TRUE", "TRUE", "TRUE"]]),
    false,
  );
  check("データ行の無い表示中の表は揃っていない", mod.sameColumnLayout({ headers: ["a"], rows: [["", ""]] }, fullGrid), false);
  // 8 割の線 (表示中の表のデータ行は 3 本)。一致しない行 ["x", …] を混ぜて比べる。
  const odd = ["x", "合わない行"];
  check("4 行中 3 行 (75%) は揃っていない", mod.sameColumnLayout({ headers: view.headers, rows: [...view.rows, odd] }, fullGrid), false);
  check("5 行中 4 行 (80%) は揃っている", mod.sameColumnLayout({ headers: view.headers, rows: [...view.rows, view.rows[0], odd] }, fullGrid), true);

} finally {
  rmSync(outDir, { recursive: true, force: true });
}

console.log("\n[軽減表のページの配線]");
const page = readFileSync("src/app/(portal)/category/[slug]/mitigation/page.tsx", "utf8").replace(/\r\n/g, "\n");
check(
  "見出し行が見つからないときだけ全行の表を取る",
  /if \(table\.ok && !headerRows && checkColumns\.length > 0\) \{\s*const full = await fetchSheetFullGrid\(category\.mitigationSheetUrl, activeGid\);/.test(page),
  true,
);
check("列の並びが揃っているときだけ使う", /if \(full && sameColumnLayout\(table\.table, full\)\) \{/.test(page), true);
check("自動ラベルは見出しを見つけた表から作る", /buildAutoColumnLabels\(labelSource\.grid, labelSource\.rows\)/.test(page), true);
check(
  "カードから除く見出し行は表示中の表で見つけた分だけ (全行の表の行番号を混ぜない)",
  /if \(headerRows\) \{\s*for \(const r of \[\s*headerRows\.jobRow,/.test(page),
  true,
);

console.log(failures === 0 ? "\nすべて OK" : `\n${failures} 件 FAIL`);
process.exit(failures === 0 ? 0 : 1);
