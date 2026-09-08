/**
 * 週制限の消化ウィンドウ (src/lib/week-jst.ts + src/lib/loot-window-keys.ts)
 * の検証 (2026-09-07、W-33 ②)。
 * 実行: `node scripts/check-loot-window.mjs`
 *
 * 8.0「白銀のワンダラー」(2027-01) でアラガントームストーンが 2 週管理に
 * なり、前週分を遡って取得できるようになります (調査ノート第 4 回 5-2)。
 * 「今週だけ開いている」前提だった消化チェックを 2 週ウィンドウに広げても、
 * 7.x の既定挙動 (今週だけ) が変わらないことを固定する。
 *
 * 週識別子の境界 (火曜 08:00 UTC = JST 17:00) と、月末 / 年末 / うるう年を
 * 跨ぐ前週計算も併せて検証する。
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
  if (a === e) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${name}\n       expected: ${e}\n       actual:   ${a}`);
  }
}

const outDir = mkdtempSync(join(tmpdir(), "loot-window-check-"));
try {
  execFileSync(
    process.execPath,
    [
      "node_modules/typescript/bin/tsc", "src/lib/week-jst.ts", "src/lib/loot-window-keys.ts",
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
    writeFileSync(
      fp,
      readFileSync(fp, "utf8").replace(
        /(from\s+["'])(\.\.?\/[^"']+?)(?<!\.js)(["'])/g,
        "$1$2.js$3",
      ),
    );
  }
  const week = await import(pathToFileURL(join(outDir, "week-jst.js")).href);
  const keys = await import(
    pathToFileURL(join(outDir, "loot-window-keys.js")).href
  );
  const { currentWeekStart, previousWeekStart, openWeekStarts } = week;
  const { parseLootWindowWeeks, LOOT_WINDOW_WEEKS_DEFAULT } = keys;

  // 2026-09-08 (火) 08:00 UTC = JST 17:00 がリセット。
  const justAfterReset = new Date("2026-09-08T08:00:00Z");
  const justBeforeReset = new Date("2026-09-08T07:59:59Z");
  const midWeek = new Date("2026-09-11T03:00:00Z"); // 金曜昼 JST

  console.log("週識別子の境界 (既存挙動の回帰ガード)");
  check("リセット直後は当日の週", currentWeekStart(justAfterReset), "2026-09-08");
  check("リセット直前は前週", currentWeekStart(justBeforeReset), "2026-09-01");
  check("週の途中は同じ週", currentWeekStart(midWeek), "2026-09-08");

  console.log("\n前週の計算");
  check("普通の週", previousWeekStart("2026-09-08"), "2026-09-01");
  check("月を跨ぐ", previousWeekStart("2026-09-01"), "2026-08-25");
  check("年を跨ぐ", previousWeekStart("2027-01-05"), "2026-12-29");
  check("うるう年 (2028-02-29 の週)", previousWeekStart("2028-03-07"), "2028-02-29");
  check("不正な入力はそのまま返す", previousWeekStart("bogus"), "bogus");

  console.log("\n消化ウィンドウ");
  check("既定は 1 週 (今週だけ)", openWeekStarts(midWeek, 1), ["2026-09-08"]);
  check("引数省略も 1 週", openWeekStarts(midWeek), ["2026-09-08"]);
  check(
    "2 週なら今週 + 前週 (8.0 の遡り取得)",
    openWeekStarts(midWeek, 2),
    ["2026-09-08", "2026-09-01"],
  );
  // 先頭は必ず今週 (UI が「今週」を先に描く前提)。
  check(
    "先頭は必ず今週",
    openWeekStarts(midWeek, 2)[0],
    currentWeekStart(midWeek),
  );
  check(
    "リセット直前に 2 週なら前週 + その前",
    openWeekStarts(justBeforeReset, 2),
    ["2026-09-01", "2026-08-25"],
  );
  check(
    "年を跨ぐ 2 週",
    openWeekStarts(new Date("2027-01-06T03:00:00Z"), 2),
    ["2027-01-05", "2026-12-29"],
  );
  check("0 は 1 週に丸める", openWeekStarts(midWeek, 0), ["2026-09-08"]);
  check("小数は 1 週に丸める", openWeekStarts(midWeek, 1.5), ["2026-09-08"]);

  console.log("\n設定値の正規化");
  check("既定は 1", LOOT_WINDOW_WEEKS_DEFAULT, 1);
  check("未設定 (null) は既定", parseLootWindowWeeks(null), 1);
  check("空文字は既定", parseLootWindowWeeks("  "), 1);
  check('"1" は 1', parseLootWindowWeeks("1"), 1);
  check('"2" は 2', parseLootWindowWeeks("2"), 2);
  check("上限超えは既定に倒す", parseLootWindowWeeks("3"), 1);
  check("0 は既定に倒す", parseLootWindowWeeks("0"), 1);
  check("負値は既定に倒す", parseLootWindowWeeks("-1"), 1);
  check("数値でない値は既定に倒す", parseLootWindowWeeks("two"), 1);
  check("小数は既定に倒す", parseLootWindowWeeks("1.5"), 1);
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
