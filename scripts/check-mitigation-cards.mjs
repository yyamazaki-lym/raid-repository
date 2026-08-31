/**
 * 軽減表カードの抽出ロジック検証 (2026-08-30)。
 * 実行: `node scripts/check-mitigation-cards.mjs`
 *
 * チェックボックス列の抽出は「担当者の列を奪わない」ことが要点 (奪うと
 * 「MT: 堅陣」の表示が消える) なので、そこを重点的に検証する。
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  // sheet-csv は mitigation-terms を import するので両方コンパイルする。
  // tsc は相対 import に拡張子を付けない (bundler 前提) が、Node の ESM は
  // 拡張子必須なので出力後に補う。
  execFileSync(
    "npx",
    [
      "tsc",
      "src/lib/sheet-csv.ts",
      "src/lib/mitigation-terms.ts",
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
  for (const f of ["sheet-csv.js", "mitigation-terms.js"]) {
    const path = join(outDir, f);
    writeFileSync(
      path,
      readFileSync(path, "utf8").replace(
        /from "(\.\/[^"]+?)"/g,
        (m, spec) => (spec.endsWith(".js") ? m : `from "${spec}.js"`),
      ),
    );
  }
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

  console.log("\n[列名の手動登録]");
  // アイコン見出し = CSV に文字が無く、値も TRUE/FALSE だけの列。
  // 自動では名前が付かないので、手動登録があるときだけ拾う。
  const iconTable = {
    headers: ["Time", "Action", "Damage", "", ""],
    rows: [
      ["00:16", "フィクサー", "400,000", "TRUE", "FALSE"],
      ["00:41", "リーサル", "800,000", "FALSE", "TRUE"],
    ],
  };
  const iconCols = iconTable.headers.map((_, i) => i).slice(1);
  const noLabels = mod.buildSheetCardRows(iconTable, iconCols, { mitigation: true });
  check(
    "名前が無ければアイコン列は出さない",
    noLabels[0].checks ?? [],
    [],
  );
  const withLabels = mod.buildSheetCardRows(iconTable, iconCols, {
    mitigation: true,
    columnLabels: { 3: "堅陣", 4: "士気" },
  });
  check(
    "登録した名前で表示する",
    withLabels[0].checks.map((c) => c.label),
    ["堅陣"],
  );
  check(
    "行ごとに ON の列が変わる",
    withLabels[1].checks.map((c) => c.label),
    ["士気"],
  );

  console.log("\n[列の診断]");
  const diag = mod.diagnoseSheetColumns(iconTable);
  check("列記号", diag.map((d) => d.letter), ["A", "B", "C", "D", "E"]);
  check(
    "アイコン列はチェックと判定",
    diag.filter((d) => d.role === "check").map((d) => d.letter),
    ["D", "E"],
  );
  check("ダメージ列を判定", diag[2].role, "damage");
  check("ON 数を数える", diag[3].checkedCount, 1);
  check("27 列目は AB", mod.columnLetter(27), "AB");

  console.log("\n[数値サマリのラベル]");
  // 実機報告「軽減率が 2 つ存在して分かりにくい」: ラベルはシートの
  // 実際の列見出しを使う (種別名を出すと同名が並ぶ)。
  const twoRates = {
    headers: ["Time", "Damage", "軽減率", "被ダメージ", "最終ダメージ"],
    rows: [["00:16", "400,000", "0.62", "249,318", "249,318"]],
  };
  const rateRows = mod.buildSheetCardRows(
    twoRates,
    twoRates.headers.map((_, i) => i).slice(1),
    { mitigation: true },
  );
  check(
    // 定型語 (Damage) は日本語化されるが、区別できる名前であることが要点。
    "ラベルはシートの列見出し (定型語は日本語化)",
    rateRows[0].stats.map((s) => s.label),
    ["ダメージ", "被ダメージ", "軽減率", "最終ダメージ"],
  );
  check(
    "同じラベル+同じ値は畳む",
    rateRows[0].stats.filter((s) => s.value === "249,318").length,
    2,
  );

  console.log("\n[アビリティ名の行 (26 行目相当) を見出しに使う]");
  // 実シートは「見出し行 = アイコン (CSV では空)」「次の行 = アビリティ名」
  // という 2 段組み。名前の段を検出して見出しの代わりに使う。
  const twoTier = {
    headers: ["Time", "Action", "Type", "", "", ""],
    rows: [
      ["", "", "", "堅陣", "士気", "牽制"],
      ["00:16", "フィクサー", "Magic", "TRUE", "FALSE", "TRUE"],
      ["00:41", "リーサル", "Physical", "FALSE", "TRUE", "FALSE"],
    ],
  };
  const twoTierRows = mod.buildSheetCardRows(
    twoTier,
    twoTier.headers.map((_, i) => i).slice(1),
    { mitigation: true },
  );
  check("名前の行はカードにしない", twoTierRows.length, 2);
  check(
    "名前の行から見出しを取る",
    twoTierRows[0].checks.map((c) => c.label),
    ["堅陣", "牽制"],
  );
  check(
    "行ごとに ON が変わる",
    twoTierRows[1].checks.map((c) => c.label),
    ["士気"],
  );

  console.log("\n[英語の日本語化]");
  const en = {
    headers: ["Time", "Action", "Type", "Damage", "Calculate Mitigation"],
    rows: [["00:16", "Fixer", "Magic", "400,000", "0.62"]],
  };
  const enRows = mod.buildSheetCardRows(
    en,
    en.headers.map((_, i) => i).slice(1),
    { mitigation: true },
  );
  check(
    "定型語の見出しは日本語に",
    enRows[0].stats.map((s) => s.label),
    ["ダメージ", "軽減計算"],
  );
  check(
    "種別の値も日本語に (Type: Magic → 種別: 魔法)",
    enRows[0].cells.map((c) => `${c.label}:${c.value}`),
    ["種別:魔法"],
  );
  check(
    "技名は英語のままにする (勝手に訳さない)",
    enRows[0].heading.includes("Fixer"),
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
