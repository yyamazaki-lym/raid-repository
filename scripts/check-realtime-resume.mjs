/**
 * Realtime 購読の復帰時の取り直し (src/lib/realtime-resume.ts) と、
 * 練習ログの日付が狭い幅で省略されないこと (2026-10-01 監査 U-5 / U-1)。
 * 実行: `node scripts/check-realtime-resume.mjs`
 *
 *   1. `shouldRefetchOnVisible` の境界 (隠れていない / 30 秒未満 / ちょうど /
 *      超え / 壊れた時刻)
 *   2. 共通フック `useRealtimeChannel` が `visibilitychange` と `online` を
 *      聞いて `onResume` を呼び、外すときに両方とも外す
 *   3. 購読の 2 つの入口 (`useRealtimeTable` / 日付メモ) が `onResume` で
 *      取り直す (= 6 つの購読すべてに効く)
 *   4. 練習ログの日ごとの行で、日付が縮められて省略されない
 *
 * 2〜4 は呼び出し側のソースにしか書けない前提なので、ソースを読んで確かめる。
 */
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
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

const outDir = mkdtempSync(join(tmpdir(), "realtime-resume-check-"));
try {
  execFileSync(
    process.execPath,
    [
      "node_modules/typescript/bin/tsc",
      "src/lib/realtime-resume.ts",
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
  const { shouldRefetchOnVisible, RESUME_REFETCH_MIN_HIDDEN_MS } = await import(
    pathToFileURL(join(outDir, "realtime-resume.js")).href
  );

  console.log("shouldRefetchOnVisible");
  const now = 1_000_000;
  const MIN = RESUME_REFETCH_MIN_HIDDEN_MS;
  check("隠れていなかった → 取り直さない", shouldRefetchOnVisible(null, now), false);
  check("一瞬の切り替え (1 秒) → 取り直さない", shouldRefetchOnVisible(now - 1000, now), false);
  check("しきい値ちょうど → 取り直す", shouldRefetchOnVisible(now - MIN, now), true);
  check("背面に 10 分 → 取り直す", shouldRefetchOnVisible(now - 600_000, now), true);
  check("壊れた時刻 (NaN) → 取り直さない", shouldRefetchOnVisible(Number.NaN, now), false);
  check("しきい値は 30 秒", MIN, 30_000);

  console.log("共通フック (use-realtime-table.ts)");
  const hook = readFileSync("src/lib/use-realtime-table.ts", "utf8");
  const chStart = hook.indexOf("export function useRealtimeChannel(");
  const chEnd = hook.indexOf("\nexport function useRealtimeTable", chStart);
  const channel = hook.slice(chStart, chEnd);
  check("visibilitychange を聞く", /document\.addEventListener\("visibilitychange", onVisibility\)/.test(channel), true);
  check("online を聞く", /window\.addEventListener\("online", onOnline\)/.test(channel), true);
  check("外すときに visibilitychange も外す", /document\.removeEventListener\("visibilitychange", onVisibility\)/.test(channel), true);
  check("外すときに online も外す", /window\.removeEventListener\("online", onOnline\)/.test(channel), true);
  check("見えたときの判定は shouldRefetchOnVisible", /shouldRefetchOnVisible\(hiddenAt, Date\.now\(\)\)/.test(channel), true);
  check("online では無条件に onResume", /const onOnline = \(\) => \{\s*optsRef\.current\.onResume\?\.\(\);/.test(channel), true);

  console.log("購読の入口");
  const table = hook.slice(hook.indexOf("export function useRealtimeTable"));
  check("useRealtimeTable は onResume で取り直す", /onResume: \(\) => \{\s*void refetch\(\);/.test(table), true);
  const memos = readFileSync("src/lib/schedule-memos-client.ts", "utf8");
  const memoCall = memos.slice(memos.indexOf("useRealtimeChannel({"));
  check("日付メモは onResume で全件取り直す", /onResume: \(\) => \{\s*void refetchAll\(\);/.test(memoCall), true);

  console.log("練習ログの日付 (day-row.tsx)");
  const day = readFileSync("src/components/portal/logs/day-row.tsx", "utf8");
  // ⚠ 行の id (`log-day-${day.date}`) にも `{day.date}` が含まれるので、
  // 日付列の中身 (読み上げ用の span) を起点に窓を切る。
  const at = day.indexOf('sr-only sm:not-sr-only">{day.date}');
  const around = day.slice(Math.max(0, at - 400), at + 50);
  check("日付が出ている", at > 0, true);
  check("日付の列を縮めない (shrink-0)", /flex-1 shrink-0[^"]*whitespace-nowrap/.test(around), true);
  check("日付の列で truncate / min-w-0 を使わない", /truncate|min-w-0/.test(around.slice(around.lastIndexOf("<span className=\"flex-1"))), false);
  check("狭い幅では月日を出す", /sm:hidden">\s*\{day\.date\.slice\(5\)\}/.test(day), true);
  check("読み上げには年付きを渡す", /sr-only sm:not-sr-only">\{day\.date\}/.test(day), true);
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

if (failures > 0) {
  console.log(`\n${failures} 件失敗`);
  process.exit(1);
}
console.log("\nすべて ok");
