/**
 * 日付メモの重要度 (src/lib/memo-severity.ts) の検証 (2026-09-07、UI-3)。
 * 実行: `node scripts/check-memo-severity.mjs`
 *
 * 既定は `none` (未設定) で、既存のメモは今までと同じ見た目のまま残す。
 * 「未設定を medium に寄せる」実装に変えると、ただの連絡が全部「注意」の
 * 色で並んで色の意味が薄れるので、そこを固定する。並び順 (major → medium
 * → 未設定 → minor) と、同じ段階の中で元の並びが崩れないこと (安定ソート)
 * も検証する。
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

const outDir = mkdtempSync(join(tmpdir(), "memo-severity-check-"));
try {
  execFileSync(
    process.execPath,
    ["node_modules/typescript/bin/tsc", "src/lib/memo-severity.ts", "--outDir", outDir, "--target", "es2022",
     "--module", "es2022", "--moduleResolution", "bundler", "--strict"],
    { stdio: "inherit" },
  );
  for (const f of readdirSync(outDir)) {
    if (!f.endsWith(".js")) continue;
    const fp = join(outDir, f);
    writeFileSync(fp, readFileSync(fp, "utf8").replace(
      /(from\s+["'])(\.\.?\/[^"']+?)(?<!\.js)(["'])/g, "$1$2.js$3"));
  }
  const v = await import(pathToFileURL(join(outDir, "memo-severity.js")).href);
  const {
    parseMemoSeverity, isMemoSeverity, memoSeverityRank, sortByMemoSeverity,
    filterMemoSeverity, countMinor, memoSeverityToneClass, memoSeverityMark,
    MEMO_SEVERITY_DEFAULT, MEMO_SEVERITIES,
  } = v;

  console.log("値の正規化");
  check("既定は none", MEMO_SEVERITY_DEFAULT, "none");
  check("4 値", [...MEMO_SEVERITIES], ["major", "medium", "minor", "none"]);
  check("major", parseMemoSeverity("major"), "major");
  check("null は既定", parseMemoSeverity(null), "none");
  check("undefined は既定", parseMemoSeverity(undefined), "none");
  check("未知の値は既定 (medium に寄せない)", parseMemoSeverity("urgent"), "none");
  check("空文字は既定", parseMemoSeverity(""), "none");
  check("数値は既定", parseMemoSeverity(1), "none");
  check("大文字は別扱い (既定)", parseMemoSeverity("MAJOR"), "none");
  check("判定関数", [isMemoSeverity("minor"), isMemoSeverity("x")], [true, false]);

  console.log("\n並び順 (major → medium → 未設定 → minor)");
  check("major が一番上", memoSeverityRank("major") < memoSeverityRank("medium"), true);
  check("未設定は medium の下", memoSeverityRank("none") > memoSeverityRank("medium"), true);
  check("minor は未設定より下", memoSeverityRank("minor") > memoSeverityRank("none"), true);
  const items = [
    { id: "a", severity: "minor" },
    { id: "b", severity: "none" },
    { id: "c", severity: "major" },
    { id: "d", severity: "medium" },
    { id: "e", severity: "none" },
    { id: "f", severity: "major" },
  ];
  check(
    "並べ替え",
    sortByMemoSeverity(items).map((i) => i.id),
    ["c", "f", "d", "b", "e", "a"],
  );
  check("同じ段階の中は元の並びを保つ (安定ソート)",
    sortByMemoSeverity(items).filter((i) => i.severity === "none").map((i) => i.id),
    ["b", "e"]);
  check("入力を変更しない", items.map((i) => i.id), ["a", "b", "c", "d", "e", "f"]);
  check("空配列", sortByMemoSeverity([]), []);

  console.log("\n絞り込み (minor を隠す)");
  check("隠すと minor が消える", filterMemoSeverity(items, true).map((i) => i.id),
    ["b", "c", "d", "e", "f"]);
  check("未設定は隠さない",
    filterMemoSeverity(items, true).some((i) => i.severity === "none"), true);
  check("隠さないと全件", filterMemoSeverity(items, false).length, 6);
  check("隠される件数", countMinor(items), 1);
  check("minor が無ければ 0", countMinor([{ id: "x", severity: "major" }]), 0);

  console.log("\n見た目 (色 + 記号)");
  check("major は赤系", /rose/.test(memoSeverityToneClass("major")), true);
  check("medium は橙系", /amber/.test(memoSeverityToneClass("medium")), true);
  check("minor は青系", /sky/.test(memoSeverityToneClass("minor")), true);
  check("未設定は色を付けない",
    /rose|amber|sky/.test(memoSeverityToneClass("none")), false);
  check("記号は 3 段階で別 (色以外の手がかり)",
    [memoSeverityMark("major"), memoSeverityMark("medium"), memoSeverityMark("minor")],
    ["↑", "→", "↓"]);
  check("未設定は記号なし", memoSeverityMark("none"), "");
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
