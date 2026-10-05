/**
 * FFLogs 同期 cron の時間予算 (src/lib/fflogs-sync-budget.ts) の検証
 * (2026-10-01 監査 C-1)。
 * 実行: `node scripts/check-fflogs-sync-budget.mjs`
 *
 * `/api/cron/fflogs-sync` は 2 段 (リンク → pull 取り込み) を直列に走らせる。
 * 段ごとに予算を数えていた頃は 240s + 120s が maxDuration (300s) を超えて
 * いた。ここでは次の 3 つを固定する:
 *
 *   1. `resolveSyncDeadline` が「自分の予算」と「共有期限」の早い方を返す
 *   2. 共有期限 + 期限後に走り得る処理 < maxDuration (予算の算術)
 *   3. route が期限を 1 つだけ切り、両段に同じものを渡している /
 *      両段がそれを `resolveSyncDeadline` で受けている (構造)
 *
 * 3 は呼び出し側にしか書けない前提なので、ソースを読んで確かめる。
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

/** `marker` を含む関数の本体 (次の `\nexport ` か EOF まで) を切り出す。 */
function sliceFrom(src, marker) {
  const start = src.indexOf(marker);
  if (start < 0) return "";
  const next = src.indexOf("\nexport ", start + marker.length);
  return next < 0 ? src.slice(start) : src.slice(start, next);
}

const outDir = mkdtempSync(join(tmpdir(), "fflogs-sync-budget-check-"));
try {
  execFileSync(
    process.execPath,
    [
      "node_modules/typescript/bin/tsc",
      "src/lib/fflogs-sync-budget.ts",
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
  const m = await import(
    pathToFileURL(join(outDir, "fflogs-sync-budget.js")).href
  );
  const {
    resolveSyncDeadline,
    FFLOGS_SYNC_ROUTE_FETCH_BUDGET_MS,
    FFLOGS_SYNC_ROUTE_MAX_DURATION_SEC,
    FFLOGS_SYNC_WORST_TAIL_MS,
  } = m;

  console.log("resolveSyncDeadline");
  const now = 1_000_000;
  check("共有期限なし → 自分の予算", resolveSyncDeadline(now, 120_000), now + 120_000);
  check("null も共有期限なし扱い", resolveSyncDeadline(now, 120_000, null), now + 120_000);
  check(
    "共有期限の方が早い → 共有期限",
    resolveSyncDeadline(now, 120_000, now + 30_000),
    now + 30_000,
  );
  check(
    "自分の予算の方が早い → 自分の予算",
    resolveSyncDeadline(now, 120_000, now + 500_000),
    now + 120_000,
  );
  check(
    "共有期限を過ぎていればそのまま過去を返す (= すぐ打ち切る)",
    resolveSyncDeadline(now, 120_000, now - 1) < now,
    true,
  );
  check(
    "NaN の共有期限は無視する",
    resolveSyncDeadline(now, 120_000, Number.NaN),
    now + 120_000,
  );

  console.log("予算の算術");
  check(
    "共有期限 + 期限後の処理 < maxDuration",
    FFLOGS_SYNC_ROUTE_FETCH_BUDGET_MS + FFLOGS_SYNC_WORST_TAIL_MS <
      FFLOGS_SYNC_ROUTE_MAX_DURATION_SEC * 1000,
    true,
  );

  console.log("構造 (route)");
  const route = readFileSync("src/app/api/cron/fflogs-sync/route.ts", "utf8");
  const maxDuration = route.match(/export const maxDuration = (\d+);/)?.[1];
  check(
    "route の maxDuration が予算モジュールの前提と一致",
    Number(maxDuration),
    FFLOGS_SYNC_ROUTE_MAX_DURATION_SEC,
  );
  // 2026-10-05: 週のまとめ (C-4) も route の開始時刻から期限を出すので、
  // 開始時刻を `routeStartMs` に取ってから足す形も受ける (共有期限は 1 つのまま)。
  check(
    "route が共有期限を 1 つだけ切る",
    (route.match(/(?:Date\.now\(\)|routeStartMs) \+ FFLOGS_SYNC_ROUTE_FETCH_BUDGET_MS/g) ?? [])
      .length,
    1,
  );
  check(
    "共有期限の起点は route の開始時刻",
    /const deadlineAtMs = Date\.now\(\) \+ FFLOGS_SYNC_ROUTE_FETCH_BUDGET_MS;/.test(route) ||
      /const routeStartMs = Date\.now\(\);\s*const deadlineAtMs = routeStartMs \+ FFLOGS_SYNC_ROUTE_FETCH_BUDGET_MS;/.test(route),
    true,
  );
  check(
    "リンク段に共有期限を渡す",
    /linkFflogsReportsToVideos\(\{[^}]*\bdeadlineAtMs\b[^}]*\}\)/.test(route),
    true,
  );
  check(
    "pull 取り込み段に共有期限を渡す",
    /syncFflogsFights\(\{[^}]*\bdeadlineAtMs\b[^}]*\}\)/.test(route),
    true,
  );
  check(
    "期限を過ぎていたら pull 取り込み段を始めない",
    /Date\.now\(\) < deadlineAtMs\s*\?\s*await syncFflogsFights\(/.test(route),
    true,
  );

  console.log("構造 (各段)");
  const link = sliceFrom(
    readFileSync("src/lib/server/fflogs.ts", "utf8"),
    "async function linkFflogsReportsToVideosUnlocked(",
  );
  check(
    "リンク段が共有期限を resolveSyncDeadline で受ける",
    /resolveSyncDeadline\(\s*Date\.now\(\),\s*FFLOGS_SYNC_TIME_BUDGET_MS,\s*opts\?\.deadlineAtMs,?\s*\)/.test(
      link,
    ),
    true,
  );
  check(
    "リンク段に独自の期限計算が残っていない",
    /Date\.now\(\) \+ FFLOGS_SYNC_TIME_BUDGET_MS/.test(link),
    false,
  );
  const fights = sliceFrom(
    readFileSync("src/lib/server/fflogs-fights.ts", "utf8"),
    "async function syncFflogsFightsUnlocked(",
  );
  check(
    "取り込み段が共有期限を resolveSyncDeadline で受ける",
    /resolveSyncDeadline\(\s*Date\.now\(\),\s*TIME_BUDGET_MS,\s*opts\?\.deadlineAtMs,?\s*\)/.test(
      fights,
    ),
    true,
  );
  check(
    "取り込み段に独自の期限計算が残っていない",
    /Date\.now\(\) \+ TIME_BUDGET_MS/.test(fights),
    false,
  );
  // fallback 連鎖 (v1 → cookie) の手前で期限を見る。v1 の呼び出しより前に
  // `Date.now() > deadlineAtMs` があること。
  const v1At = fights.indexOf("fetchReportFightsViaV1(ref.code)");
  const guardAt = fights.lastIndexOf("Date.now() > deadlineAtMs", v1At);
  const permissionAt = fights.lastIndexOf("PERMISSION_ERROR_RE.test", v1At);
  check(
    "fallback 連鎖の手前で期限を見る",
    v1At > 0 && guardAt > permissionAt && permissionAt > 0,
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
