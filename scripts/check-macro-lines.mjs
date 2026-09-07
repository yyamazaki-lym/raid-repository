/**
 * マクロの行数 (src/lib/macro-lines.ts) の検証 (2026-09-07、UI-6)。
 * 実行: `node scripts/check-macro-lines.mjs`
 *
 * FF14 のマクロは 15 行まで。マクロタブのコードブロックにこの行数を出して
 * 「貼れないマクロ」に気付けるようにしたので、数え方 (空行を数えない /
 * 末尾改行で 1 行増えない) を固定する。末尾改行を数えると 15 行のマクロが
 * 「16 行」と出て、直しようのない警告になる。
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

const outDir = mkdtempSync(join(tmpdir(), "macro-lines-check-"));
try {
  execFileSync(
    "npx",
    ["tsc", "src/lib/macro-lines.ts", "--outDir", outDir, "--target", "es2022",
     "--module", "es2022", "--moduleResolution", "bundler", "--strict"],
    { stdio: "inherit" },
  );
  for (const f of readdirSync(outDir)) {
    if (!f.endsWith(".js")) continue;
    const fp = join(outDir, f);
    writeFileSync(fp, readFileSync(fp, "utf8").replace(
      /(from\s+["'])(\.\.?\/[^"']+?)(?<!\.js)(["'])/g, "$1$2.js$3"));
  }
  const { countMacroLines, macroLineInfo, MACRO_LINE_LIMIT } = await import(
    pathToFileURL(join(outDir, "macro-lines.js")).href
  );

  console.log("行数の数え方");
  check("空文字は 0", countMacroLines(""), 0);
  check("1 行", countMacroLines("/p test"), 1);
  check("3 行", countMacroLines("/p a\n/p b\n/p c"), 3);
  check("末尾改行で増えない", countMacroLines("/p a\n/p b\n"), 2);
  check("末尾改行が 2 つでも増えない", countMacroLines("/p a\n\n\n"), 1);
  check("途中の空行は数えない", countMacroLines("/p a\n\n/p b"), 2);
  check("空白だけの行は数えない", countMacroLines("/p a\n   \n/p b"), 2);
  check("全角スペースだけの行も数えない", countMacroLines("/p a\n　　\n/p b"), 2);
  check("タブだけの行も数えない", countMacroLines("/p a\n\t\n/p b"), 2);
  check("CRLF の \\r は行の中身にならない", countMacroLines("/p a\r\n/p b\r\n"), 2);

  console.log("\n上限の判定");
  check("上限は 15", MACRO_LINE_LIMIT, 15);
  const fifteen = Array.from({ length: 15 }, (_, i) => `/p ${i}`).join("\n");
  check("15 行はちょうど収まる", macroLineInfo(fifteen, MACRO_LINE_LIMIT), {
    lines: 15, limit: 15, over: false,
  });
  check("末尾改行つきの 15 行も収まる", macroLineInfo(fifteen + "\n", MACRO_LINE_LIMIT), {
    lines: 15, limit: 15, over: false,
  });
  check("16 行は超過", macroLineInfo(fifteen + "\n/p x", MACRO_LINE_LIMIT), {
    lines: 16, limit: 15, over: true,
  });
  check("上限を渡さなければ判定しない", macroLineInfo(fifteen + "\n/p x"), {
    lines: 16, limit: null, over: false,
  });
  check("空文字に上限を渡しても超過にならない", macroLineInfo("", MACRO_LINE_LIMIT), {
    lines: 0, limit: 15, over: false,
  });
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
