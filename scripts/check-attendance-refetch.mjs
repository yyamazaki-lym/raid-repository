/**
 * 出席の突合のための取り直し (2026-10-06) の検証。
 * 実行: `node scripts/check-attendance-refetch.mjs`
 *
 * 参加者名は保存しない (W-6) ので、「ログ名」を後から入れた日はレポートを
 * 取り直さないと数え直せない。通常の同期は直近 14 日しか取り直さないため、
 * 出席サマリーの窓 (90 日) のそれより前の日が紐づかないまま残っていた。
 *   1. 取り直す対象の選び方 (`src/lib/schedule/attendance-refetch.ts`)
 *   2. 配線: 幹部だけ・読み取りの失敗で全部を取り直さない・URL 取り込みと同じ経路
 *   3. 取り直しを「新しいレポート」の通知に数えない (ベスト更新の判定は残す)
 *
 * ⚠ tsc の起動は `process.execPath` + `node_modules/typescript/bin/tsc`
 *   (`npx` は Windows で走らない)。
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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
const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

const outDir = mkdtempSync(join(tmpdir(), "att-refetch-check-"));
try {
  execFileSync(
    process.execPath,
    [
      "node_modules/typescript/bin/tsc", "src/lib/schedule/attendance-refetch.ts",
      "--outDir", outDir, "--rootDir", "src/lib",
      "--target", "es2022", "--module", "es2022", "--moduleResolution", "bundler", "--strict",
    ],
    { stdio: "inherit" },
  );
  for (const f of readdirSync(outDir, { recursive: true })) {
    if (!f.endsWith(".js")) continue;
    const fp = join(outDir, f);
    writeFileSync(fp, readFileSync(fp, "utf8").replace(/(from\s+["'])(\.\.?\/[^"']+?)(?<!\.js)(["'])/g, "$1$2.js$3"));
  }
  const { selectRefetchTargets, RECENT_REFETCH_MS } = await import(
    pathToFileURL(join(outDir, "schedule", "attendance-refetch.js")).href
  );

  console.log("1. 取り直す対象の選び方");
  const now = Date.parse("2026-10-06T03:00:00Z");
  const ago = (min) => new Date(now - min * 60 * 1000).toISOString();
  const day = (d) => Date.parse(`2026-${d}T12:30:00Z`);
  const reports = [
    { reportCode: "A_sep18", firstStartMs: day("09-18") },
    { reportCode: "B_sep24", firstStartMs: day("09-24") },
    { reportCode: "C_matched", firstStartMs: day("10-01") },
    { reportCode: "D_private", firstStartMs: day("09-27") },
    { reportCode: "D2_transient", firstStartMs: day("09-26") },
    { reportCode: "E_archived", firstStartMs: day("08-20") },
    { reportCode: "F_justnow", firstStartMs: day("10-04") },
    { reportCode: "G_noledger", firstStartMs: day("08-10") },
    { reportCode: "H_older", firstStartMs: day("09-30") },
  ];
  const ledger = new Map([
    ["A_sep18", { ok: true, reason: null, syncedAt: ago(60 * 24 * 10) }],
    ["B_sep24", { ok: true, reason: "details-missing:3:1", syncedAt: ago(60 * 24) }],
    ["C_matched", { ok: true, reason: null, syncedAt: ago(60 * 24) }],
    // 恒久失敗 (private) は外す。一時的な失敗は残す (通常の同期は紐づけの無い
    // レポートを再試行しないので、ここで外すと二度と取り直されない)。
    ["D_private", { ok: false, reason: "You do not have permission to view this report.", syncedAt: ago(60 * 24) }],
    ["D2_transient", { ok: false, reason: "fflogs v2 5xx: 502 Bad Gateway", syncedAt: ago(60 * 24) }],
    ["E_archived", { ok: true, reason: "details-archived:30", syncedAt: ago(60 * 24) }],
    ["F_justnow", { ok: true, reason: null, syncedAt: ago(29) }],
    ["H_older", { ok: true, reason: null, syncedAt: ago(31) }],
  ]);
  const base = { reports, matchedCodes: new Set(["C_matched"]), ledger, nowMs: now, limit: 25 };
  const all = selectRefetchTargets(base);
  check(
    "突合の行があるもの・恒久失敗・保管扱い・30 分以内に取り直したものを外し、新しい順 (一時的な失敗は残す)",
    all.codes,
    ["H_older", "D2_transient", "B_sep24", "A_sep18", "G_noledger"],
  );
  check("全部入れば残りは 0", all.remaining, 0);
  check("直前とみなす時間は 30 分", RECENT_REFETCH_MS, 30 * 60 * 1000);
  const two = selectRefetchTargets({ ...base, limit: 2 });
  check("上限で切って残りを数える", [two.codes, two.remaining], [["H_older", "D2_transient"], 3]);
  check("上限 0 なら何も取らない", selectRefetchTargets({ ...base, limit: 0 }), { codes: [], remaining: 5 });
  check(
    "同じレポートが 2 回来ても 1 回だけ",
    selectRefetchTargets({ ...base, reports: [...reports, { reportCode: "A_sep18", firstStartMs: day("09-18") }] }).codes,
    ["H_older", "D2_transient", "B_sep24", "A_sep18", "G_noledger"],
  );
  check(
    "台帳の時刻が読めなければ直前扱いにしない",
    selectRefetchTargets({ ...base, reports: [reports[0]], ledger: new Map([["A_sep18", { ok: true, reason: null, syncedAt: "bad" }]]) }).codes,
    ["A_sep18"],
  );
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

console.log("\n2. 配線");
const action = read("src/lib/server/attendance-summary-actions.ts");
const start = action.indexOf("export async function refetchUnmatchedAttendanceAction(");
const body = start >= 0 ? action.slice(start, action.indexOf("\nfunction emptyRefetchResult", start)) : "";
check(
  "幹部でなければ DB に触る前に返す",
  /const auth = await assertAdminResult\(\);\s*if \(!auth\.ok\) return \{ ok: false, reason: "ADMIN ロールが必要です" \};\s*try \{\s*const db = createSupabaseServiceRoleClient\(\);/.test(body),
  true,
);
check(
  "読み取りの失敗を「突合の行が無い」と扱わない",
  /const readError = actualsRes\.error \?\? ledgerRes\.error;\s*if \(readError\) \{[\s\S]{0,200}?return \{ ok: false,/.test(body) &&
    /if \(daysRes\.error\) \{[\s\S]{0,200}?return \{ ok: false,/.test(body),
  true,
);
check("窓は出席サマリーと同じ", /const cutoffMs = nowMs - WINDOW_DAYS \* 24 \* 60 \* 60 \* 1000;/.test(body), true);
check(
  "選んだレポートだけを、分類と日付を変えずに取り直す",
  /await syncFflogsFights\(\{\s*onlyCodes: targets\.codes,\s*preserveExisting: true,\s*\}\)/.test(body),
  true,
);
check("取り直した件数は実際に取りに行った数", /requested: result\.reportsFetched,/.test(body), true);
check("時間切れで残った分も残りに足す", /remaining: targets\.remaining \+ result\.remaining,/.test(body), true);
check("突合の行の読み取りは order 付き", /\.order\("report_code", \{ ascending: true \}\)\s*\.order\("discord_user_id", \{ ascending: true \}\)\s*\.range\(from, to\)/.test(body), true);

const dialog = read("src/components/portal/schedule/attendance-summary-dialog.tsx");
check("ダイアログ: 幹部で、突合できなかった日があるときだけボタン", /h && !data!\.selfOnly && h\.unmatched > 0 \? \(/.test(dialog), true);
check(
  "ダイアログ: 0 日の表示と通常の表示の両方に出す",
  (dialog.match(/\{refetchBlock\}/g) ?? []).length,
  2,
);
check("ダイアログ: 取り直したら集計を読み直す", /setError\(null\);\s*await load\(\);\s*\}\);\s*\};/.test(dialog), true);
check("ダイアログ: 対応表に無い名前・名前 0 件も知らせる", /m\.logsSync\.attendanceUnresolved\(/.test(dialog) && /m\.logsSync\.attendanceNoNames\(r\.attendanceNoNameReports\)/.test(dialog), true);
check(
  "ダイアログ: 対象があるのに 1 件も取れなかったときは「ありません」と出さない",
  /if \(r\.requested === 0\) \{[\s\S]{0,300}?if \(r\.remaining > 0\) \{\s*toast\.warning\(m\.attendanceHistory\.refetchStalled\(r\.remaining\)\);\s*\} else \{\s*toast\.info\(m\.attendanceHistory\.refetchNothing\);/.test(dialog),
  true,
);

console.log("\n2b. 取り直しで分類・日付・台帳を壊さない (preserveExisting)");
const syncSrc = read("src/lib/server/fflogs-fights.ts");
check(
  "URL 指定: カテゴリは リンク → 貼ったコンテンツ (台帳の多数決を既定にしない — 未分類の pull が流れ込む)",
  /categoryId: ref\.categoryId \?\? opts\?\.importCategoryId \?\? null,/.test(syncSrc) &&
    !/importCategoryId \?\? prev\?\.categoryId/.test(syncSrc),
  true,
);
check(
  "失敗: 「既存を保つ」では private が確定したときだけ台帳に書く (v1 の一時的な失敗を非公開にしない)",
  /if \(opts\?\.preserveExisting && savedReason !== CONFIRMED_PRIVATE_REASON\) \{\s*return;\s*\}\s*await db\.from\("fflogs_report_syncs"\)\.upsert\(/.test(syncSrc),
  true,
);
check(
  "台帳を読めなければ「既存を保つ」取り直しはやめる",
  /if \(ledgerRes\.error\) \{[\s\S]{0,400}?if \(opts\?\.preserveExisting\) \{\s*return \{\s*ok: false,/.test(syncSrc),
  true,
);
check(
  "失敗: 分かっているカテゴリと日付を null で潰さない",
  /category_id: ref\.categoryId \?\? prevLedger\?\.categoryId \?\? null,\s*session_date: ref\.sessionDate \?\? prevLedger\?\.sessionDate \?\? null,\s*ok: false,/.test(syncSrc),
  true,
);
check(
  "保存済みの pull のカテゴリを使う (未分類もそのまま・読めなければ書かない)",
  /const keepExisting = opts\?\.preserveExisting === true;/.test(syncSrc) &&
    /if \(existingError\) \{[\s\S]{0,400}?return;\s*\}/.test(syncSrc) &&
    /existingCategoryOf\.set\(Number\(r\.fight_id\), r\.category_id \?\? null\);/.test(syncSrc) &&
    /existingCategoryOf\.has\(f\.id\)\s*\?\s*\(existingCategoryOf\.get\(f\.id\) \?\? null\)\s*:\s*resolveFightCategory\(/.test(syncSrc),
  true,
);
check(
  "台帳のカテゴリと日付は台帳の値を優先する",
  /\(keepExisting \? prevLedger\?\.categoryId : null\) \?\?\s*consensusCategory\(/.test(syncSrc) &&
    /ref\.sessionDate \?\?\s*\(keepExisting \? prevLedger\?\.sessionDate : null\) \?\?\s*jstYmdString\(/.test(syncSrc),
  true,
);

console.log("\n3. 取り直しを「新しいレポート」に数えない");
const sync = read("src/lib/server/fflogs-fights.ts");
check(
  "台帳の fight 数が 0 (まだ pull を取り込めていない) レポートだけを数える (一時的な失敗を挟んでも数え直さない)",
  /const isNewReport =\s*\(prevLedger\?\.fightCount \?\? 0\) === 0 && existingCategoryOf\.size === 0;/.test(sync) &&
    /fightCount:\s*typeof row\.fight_count === "number"/.test(sync) &&
    /reason, fight_count",/.test(sync),
  true,
);
check(
  "「既存を保つ」取り直しでは、新しく出た pull のカテゴリだけを通知の判定に渡す (古いコンテンツの初討伐を出さない)",
  /for \(const f of acceptedFights\) \{\s*if \(keepExisting && existingCategoryOf\.has\(f\.id\)\) continue;/.test(sync),
  true,
);
check(
  "カテゴリは 0 件でも載せる (ベスト更新・初討伐の判定は map のカテゴリを見る)",
  /newReportsByCategory\.set\(\s*cid,\s*\(newReportsByCategory\.get\(cid\) \?\? 0\) \+ \(isNewReport \? 1 : 0\),\s*\);/.test(sync),
  true,
);
const notify = read("src/lib/logs-notify.ts");
check("通知: 0 件なら「新しいレポート」を出さない", /if \(newReports > 0\) \{\s*out\.push\(\{ kind: "newReport", reports: newReports \}\);/.test(notify), true);

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
