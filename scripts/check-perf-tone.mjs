/**
 * 5 段階スケール (src/lib/perf-tone.ts) の閾値検証 (2026-09-06 UI-12)。
 * 実行: `node scripts/check-perf-tone.mjs`
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}\n       expected: ${e}\n       actual:   ${a}`); }
}
const outDir = mkdtempSync(join(tmpdir(), "perf-tone-"));
try {
  execFileSync(process.execPath, ["node_modules/typescript/bin/tsc", "src/lib/perf-tone.ts", "--outDir", outDir, "--target", "es2022", "--module", "es2022", "--moduleResolution", "bundler", "--strict"], { stdio: "inherit" });
  const m = await import(pathToFileURL(join(outDir, "perf-tone.js")).href);

  console.log("\n[残 HP%]");
  check("討伐", m.perfForRemainingPercent(0), "best");
  check("0.5% (惜しい) は good", m.perfForRemainingPercent(0.5), "good");
  check("10%", m.perfForRemainingPercent(10), "good");
  check("30%", m.perfForRemainingPercent(30), "mid");
  check("60%", m.perfForRemainingPercent(60), "warn");
  check("61%", m.perfForRemainingPercent(61), "bad");
  check("null", m.perfForRemainingPercent(null), "neutral");

  console.log("\n[達成率 / 到達度]");
  check("1.0", m.perfForRatio(1), "best");
  check("0.7", m.perfForRatio(0.7), "good");
  check("0.6", m.perfForRatio(0.6), "mid");
  check("0.4", m.perfForRatio(0.4), "warn");
  check("0.1", m.perfForRatio(0.1), "bad");
  check("progress 100", m.perfForProgress(100), "best");
  check("progress 50", m.perfForProgress(50), "warn");
  check("progress 150 は clamp", m.perfForProgress(150), "best");
  check("NaN", m.perfForRatio(Number.NaN), "neutral");

  console.log("\n[死亡数]");
  check("0", m.perfForDeaths(0), "best");
  check("1", m.perfForDeaths(1), "good");
  check("2", m.perfForDeaths(2), "mid");
  check("4", m.perfForDeaths(4), "warn");
  check("5", m.perfForDeaths(5), "bad");
  check("null", m.perfForDeaths(null), "neutral");

  console.log("\n[辞書の整合]");
  const levels = ["best", "good", "mid", "warn", "bad", "neutral"];
  // PERF_BOX は箱を大量に並べる列専用のトーン (2026-09-08、L-5 ①)。
  // レベルが欠けると `PERF_BOX[level]` が undefined になり、箱が
  // 無色 (= 5 段階が読めない) で描かれる。
  for (const dict of ["PERF_TEXT", "PERF_CHIP", "PERF_BOX", "PERF_BAR", "PERF_BAR_SOFT"]) {
    check(`${dict} に全レベル`, levels.every((l) => typeof m[dict][l] === "string" && m[dict][l].length > 0), true);
  }
  // 箱のトーンはチップより薄いこと (並べたときの色の総量を抑えるのが目的
  // なので、同じ値に戻ると実機報告「識別色が強すぎる」に逆戻りする)。
  check(
    "PERF_BOX はチップより薄い背景",
    levels.slice(0, 5).every((l) => m.PERF_BOX[l] !== m.PERF_CHIP[l] && /bg-[a-z]+-400\/5 /.test(m.PERF_BOX[l] + " ")),
    true,
  );
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
if (failures > 0) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log("\nall checks passed");
