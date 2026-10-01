/**
 * FFLogs 同期の重複実行ロックとポイント制への対応の検査
 * (2026-10-01 監査 C-5 / C-7)。
 * 実行: `node scripts/check-fflogs-sync-guards.mjs`
 *
 *   1. `acquireLease` (src/lib/sync-lease.ts): 2 つの実行が同時に取り合っても
 *      取れるのは 1 つ / 期限切れのロックは取り直せる / 期限内は取れない
 *   2. `reportLimitForBudget` (src/lib/fflogs-rate-budget.ts): ポイントの
 *      残り割合で今回の枠を絞る (照会に失敗したら枠を変えない)
 *   3. 配線 (ソースを読む): 両段がロックを取る / 日付登録の 1 件取り込みは
 *      ロックを取らない / 429 で打ち切る / cron は診断用の introspection を
 *      引かない / currentUser を 2 回引かない
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

/** app_settings の 1 行の偽物。条件の評価と書き換えを同じ同期ブロックで行う。 */
function fakeRow(initial) {
  const state = { row: initial };
  const tick = () => new Promise((r) => setImmediate(r));
  const ops = {
    takeExpired: async (value, nowIso) => {
      await tick();
      if (!state.row || state.row.value === null || !(state.row.value < nowIso)) return false;
      state.row = { value };
      return true;
    },
    takeNull: async (value) => {
      await tick();
      if (!state.row || state.row.value !== null) return false;
      state.row = { value };
      return true;
    },
    insertIfAbsent: async (value) => {
      await tick();
      if (state.row) return false;
      state.row = { value };
      return true;
    },
  };
  return { state, ops };
}

function compile(file, outDir) {
  execFileSync(
    process.execPath,
    [
      "node_modules/typescript/bin/tsc", file,
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
}

const outDir = mkdtempSync(join(tmpdir(), "fflogs-sync-guards-check-"));
try {
  compile("src/lib/sync-lease.ts", outDir);
  compile("src/lib/fflogs-rate-budget.ts", outDir);
  const { acquireLease, leaseValue, SYNC_LEASE_TTL_MS } = await import(
    pathToFileURL(join(outDir, "sync-lease.js")).href
  );
  const B = await import(pathToFileURL(join(outDir, "fflogs-rate-budget.js")).href);

  console.log("acquireLease");
  const now = Date.parse("2026-10-01T10:00:00.000Z");
  {
    const { state, ops } = fakeRow(undefined);
    const v = await acquireLease(ops, now, "a");
    check("行が無い → 取れる", v, leaseValue(now + SYNC_LEASE_TTL_MS, "a"));
    check("  └ 行は期限つきの値になる", state.row.value.startsWith("2026-10-01T10:06:00.000Z|"), true);
  }
  {
    const { ops } = fakeRow({ value: leaseValue(now + 60_000, "other") });
    check("期限内のロック → 取れない", await acquireLease(ops, now, "a"), null);
  }
  {
    const { ops } = fakeRow({ value: leaseValue(now - 1, "dead") });
    check("期限切れのロック → 取り直せる", (await acquireLease(ops, now, "a")) !== null, true);
  }
  {
    const { ops } = fakeRow({ value: null });
    check("値が NULL → 取れる", (await acquireLease(ops, now, "a")) !== null, true);
  }
  for (const [label, initial] of [
    ["行が無い", undefined],
    ["期限切れ", { value: leaseValue(now - 1, "dead") }],
    ["NULL", { value: null }],
  ]) {
    const { ops } = fakeRow(initial);
    const results = await Promise.all([
      acquireLease(ops, now, "a"),
      acquireLease(ops, now, "b"),
    ]);
    check(`同時に 2 つ (${label}) → 取れるのは 1 つ`, results.filter((r) => r !== null).length, 1);
  }
  check("ロックは maxDuration (300s) より長い", SYNC_LEASE_TTL_MS > 300_000, true);

  console.log("reportLimitForBudget");
  const budget = (spent) => ({ limitPerHour: 3600, pointsSpentThisHour: spent, pointsResetIn: 1800 });
  check("照会に失敗 (null) → 枠を変えない", B.reportLimitForBudget(40, null), 40);
  check("残り 100% → 40", B.reportLimitForBudget(40, budget(0)), 40);
  check("残りちょうど 25% → 40 (しきい値未満で絞る)", B.reportLimitForBudget(40, budget(2700)), 40);
  check("残り 20% → 5 件に絞る", B.reportLimitForBudget(40, budget(2880)), 5);
  check("残り 20% で要求が 3 件 → 3", B.reportLimitForBudget(3, budget(2880)), 3);
  check("残り 4% → 取りに行かない", B.reportLimitForBudget(40, budget(3456)), 0);
  check("使いすぎ (残り負) → 取りに行かない", B.reportLimitForBudget(40, budget(5000)), 0);
  check("壊れた上限 (0) → 枠を変えない", B.reportLimitForBudget(40, { limitPerHour: 0, pointsSpentThisHour: 0, pointsResetIn: 0 }), 40);
  check("残り割合", B.remainingRatio(budget(900)), 0.75);

  console.log("配線");
  const fflogs = readFileSync("src/lib/server/fflogs.ts", "utf8");
  const fights = readFileSync("src/lib/server/fflogs-fights.ts", "utf8");
  const route = readFileSync("src/app/api/cron/fflogs-sync/route.ts", "utf8");
  check(
    "リンク段はロックを取ってから本体を呼ぶ",
    /withSyncLease\(\s*client,\s*FFLOGS_LINK_LEASE_KEY,\s*\(\) => linkFflogsReportsToVideosUnlocked\(opts\)/.test(fflogs),
    true,
  );
  check(
    "取り込み段はロックを取ってから本体を呼ぶ",
    /withSyncLease\(\s*client,\s*FFLOGS_FIGHTS_LEASE_KEY,\s*\(\) => syncFflogsFightsUnlocked\(opts\)/.test(fights),
    true,
  );
  check(
    "日付登録の 1 件取り込み (onlyCodes) はロックを取らない",
    /if \(opts\?\.onlyCodes\) return syncFflogsFightsUnlocked\(opts\);/.test(fights),
    true,
  );
  check("429 を rate として返す", /if \(res\.status === 429\) \{\s*return \{ ok: false, kind: "rate"/.test(fights), true);
  check(
    "429 のレポートは台帳に書かず打ち切る",
    /if \(!res\.ok && res\.rateLimited\) \{\s*fetched -= 1;\s*rateLimited = true;\s*truncated = true;\s*return;/.test(fights),
    true,
  );
  check("429 の後は次のレポートを取りに行かない", /if \(rateLimited\) \{\s*truncated = true;\s*return;/.test(fights), true);
  check(
    "ポイント残量で枠を絞る",
    /const limit = reportLimitForBudget\(\s*opts\?\.limit \?\? DEFAULT_REPORT_LIMIT,\s*rateBudget,\s*\);/.test(fights),
    true,
  );
  check("cron は introspection を引かない", /diagnostics: false/.test(route) && /if \(opts\?\.diagnostics !== false\) \{\s*schemaIntrospect = await introspectFflogsSchema/.test(fflogs), true);
  check(
    "currentUser は v2 の結果を使い回す",
    /v2Result && v2Result\.ok\s*\?\s*\{ ok: true as const, id: v2Result\.me\.id/.test(fflogs),
    true,
  );
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

if (failures > 0) {
  console.log(`\n${failures} 件失敗`);
  process.exit(1);
}
console.log("\nすべて ok");
