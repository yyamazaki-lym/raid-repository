/**
 * 練習ログの取り込みが「黙って止まる・黙って欠ける」のを見えるようにする
 * (2026-10-05、取り込み〜紐づけ〜解析の精査) の検証。
 * 実行: `node scripts/check-fflogs-sync-visibility.mjs`
 *
 * 精査で見つかったもの:
 *   1. 詳細 (PT DPS・死亡数・ワイプ原因) が取れなくても台帳が「同期済み」になり、
 *      14 日を過ぎると二度と取り直さなかった → 台帳に印を付けて最大 3 回取り直す
 *      (`src/lib/fflogs-detail-retry.ts`)。件数をトーストに出す
 *   2. pull の保存に失敗しても理由が出なかった → 失敗の一覧に理由を足す
 *   3. 本番で FFLogs 同期が設定で OFF になっていたのに「自動処理」は正常と表示
 *      → 既定 ON の FFLogs 同期が設定で止まっているときは警告する
 *   4. 設定画面を開くたびに「FFLogs 表示名 (基本)」が消えていた → 掃除をやめる
 *
 * 2026-10-06: FFLogs が保管扱い (archive) にした古いレポートは、詳細を何度
 * 取り直しても返らない → 別の印にして取り直さない (1b)。
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
function fnBody(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) return "";
  const end = src.indexOf("\n}\n", start);
  return end < 0 ? src.slice(start) : src.slice(start, end);
}

const outDir = mkdtempSync(join(tmpdir(), "fflogs-sync-visibility-check-"));
try {
  execFileSync(
    process.execPath,
    [
      "node_modules/typescript/bin/tsc", "src/lib/fflogs-detail-retry.ts", "src/lib/cron-status.ts",
      "--outDir", outDir, "--rootDir", "src/lib",
      "--target", "es2022", "--module", "es2022", "--moduleResolution", "bundler", "--strict",
    ],
    { stdio: "inherit" },
  );
  for (const f of readdirSync(outDir)) {
    if (!f.endsWith(".js")) continue;
    const fp = join(outDir, f);
    writeFileSync(fp, readFileSync(fp, "utf8").replace(/(from\s+["'])(\.\.?\/[^"']+?)(?<!\.js)(["'])/g, "$1$2.js$3"));
  }
  const r = await import(pathToFileURL(join(outDir, "fflogs-detail-retry.js")).href);
  const c = await import(pathToFileURL(join(outDir, "cron-status.js")).href);

  console.log("1. 詳細が取れなかったレポートの印");
  check("全部取れたら印を消す", r.detailsMissingReason(0, "details-missing:3:1"), null);
  check("初めて欠けたら 1 回目", r.detailsMissingReason(5, null), "details-missing:5:1");
  check("前回の印に 1 を足す", r.detailsMissingReason(2, "details-missing:5:1"), "details-missing:2:2");
  check("他の理由 (失敗) からは 1 回目", r.detailsMissingReason(2, "private report"), "details-missing:2:1");
  check("読む", r.parseDetailsMissing("details-missing:7:2"), { missing: 7, attempts: 2 });
  check("形が違えば null", [r.parseDetailsMissing(null), r.parseDetailsMissing("details-missing:x:1"), r.parseDetailsMissing("private")], [null, null, null]);
  check("上限は 3 回", r.MAX_DETAIL_RETRIES, 3);
  check(
    "取り直すのは上限未満の印だけ",
    ["details-missing:1:1", "details-missing:1:2", "details-missing:1:3", null, "private"].map(r.shouldRetryMissingDetails),
    [true, true, false, false, false],
  );

  // 2026-10-06: FFLogs が保管扱いにした古いレポート (本番で 2022 年のものが 12 件)。
  console.log("\n1b. 保管扱いのレポートは取り直さない");
  const archivedMsg =
    "This report has been archived. Subscribing users can access the report content via the /user API endpoint.";
  check("FFLogs の文言を保管扱いと読む", r.isArchivedReportError(archivedMsg), true);
  check(
    "他のエラー・空は保管扱いにしない",
    [r.isArchivedReportError("You do not have permission to view this report."), r.isArchivedReportError(null), r.isArchivedReportError("")],
    [false, false, false],
  );
  check("保管扱いなら別の印", r.detailsLedgerReason(30, null, true), "details-archived:30");
  check("保管扱いの印は前回の取り直し回数を引き継がない", r.detailsLedgerReason(30, "details-missing:30:2", true), "details-archived:30");
  check("保管扱いでなければ従来の印", r.detailsLedgerReason(5, "details-missing:5:1", false), "details-missing:5:2");
  check("全部取れたら印を消す (保管扱いでも)", [r.detailsLedgerReason(0, "details-archived:3", true), r.detailsLedgerReason(0, null, false)], [null, null]);
  check("保管扱いの印は取り直さない", r.shouldRetryMissingDetails(r.detailsLedgerReason(30, null, true)), false);

  console.log("\n3. 自動処理の停止の警告");
  const st = (outcome, reason) => ({ at: "2026-10-05T19:56:00Z", outcome, reason, lastOkAt: null, lastErrorAt: null, lastErrorReason: null, consecutiveErrors: 0 });
  check("FFLogs 同期が設定で止まっている", c.isCronDisabledBySetting("fflogs-sync", st("skipped", "disabled")), true);
  check("FFLogs 同期が他の理由で何もしなかった", c.isCronDisabledBySetting("fflogs-sync", st("skipped", "deadline")), false);
  check("FFLogs 同期が成功", c.isCronDisabledBySetting("fflogs-sync", st("ok", null)), false);
  check("既定 OFF の出欠の催促は警告しない", c.isCronDisabledBySetting("attendance-reminder", st("skipped", "disabled")), false);
  check("記録が無ければ警告しない", c.isCronDisabledBySetting("fflogs-sync", null), false);
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

console.log("\n配線");
const sync = read("src/lib/server/fflogs-fights.ts");
check(
  "取り直し: 印のあるレポートは日付に関係なく (14 日の判定より前で)",
  /if \(shouldRetryMissingDetails\(prev\.reason\)\) \{\s*targets\.push\(\{ \.\.\.withDate, priority: 1 \}\);\s*continue;\s*\}\s*\/\/ 直近のセッションはまだ pull が増えるので取り直す。\s*if \(isRecent\(effectiveDate\)\)/.test(sync),
  true,
);
check(
  "数え方: v2 で読めたレポートの、詳細なしで保存した pull (保管扱いは別に数える)",
  /if \(fromV2\) \{\s*missingDetails = plainRows\.length;\s*if \(detailsArchivedHere\) detailsArchived \+= missingDetails;\s*else detailsMissing \+= missingDetails;/.test(sync),
  true,
);
check(
  "台帳: v2 のときだけ印を書く (前回の印から回数を数える・保管扱いは別の印)",
  /reason: fromV2\s*\? detailsLedgerReason\(\s*missingDetails,\s*ledgerMap\.get\(ref\.code\)\?\.reason,\s*detailsArchivedHere,\s*\)\s*: null,/.test(sync),
  true,
);
check("結果: 件数を返す", /videosBridged,\s*detailsMissing,\s*detailsArchived,\s*\};/.test(sync), true);
check(
  "詳細の取得: 保管扱いのエラーで印を立てて打ち切る",
  /if \(isArchivedReportError\(message\)\) \{[\s\S]{0,200}?archived = true;[\s\S]{0,200}?break;\s*\}/.test(sync) &&
    /return \{ details: out, archived \};/.test(sync),
  true,
);
check(
  "詳細の取得結果を受け取る (v1 / cookie 経路は保管扱いにしない)",
  /: \{ details: new Map<number, FightDetail>\(\), archived: false \};\s*const details = fetchedDetails\.details;\s*detailsArchivedHere = fetchedDetails\.archived;/.test(sync),
  true,
);
check("2. pull の保存失敗の理由を一覧に出す", /console\.warn\("\[fflogs-fights\] upsert failed:", error\.message\);\s*\/\/[^\n]*\n\s*failures\.push\(\{ reportCode: ref\.code/.test(sync), true);
const view = read("src/app/(portal)/category/[slug]/logs/logs-view.tsx");
check("トースト: 詳細を取れなかった件数を出す", /result\.detailsMissing > 0\s*\? m\.logsSync\.detailsMissingSuffix\(result\.detailsMissing\)/.test(view), true);
check("トースト: 保管扱いの件数を別に出す", /result\.detailsArchived > 0\s*\? m\.logsSync\.detailsArchivedSuffix\(result\.detailsArchived\)/.test(view), true);
const action = read("src/lib/server/fflogs-fights-actions.ts");
check("Server Action の型も件数を持つ", /detailsMissing: number;/.test(action) && /detailsArchived: number;/.test(action), true);
const section = read("src/components/portal/settings/cron-status-section.tsx");
check("自動処理: 停止中を見出しの件数に入れる", /disabled > 0\s*\? m\.cronStatus\.badgeDisabled\(disabled\)/.test(section), true);
check("自動処理: 停止中は正常の色にしない", /failing > 0 \|\| stale > 0 \|\| disabled > 0\s*\? "off"/.test(section), true);
check("自動処理: 行に理由を出す", /isDisabled \? \(\s*<span className="text-\[12px\] text-amber-300">\s*\{m\.cronStatus\.disabledBySetting\}/.test(section), true);
const oauth = fnBody(read("src/lib/server/fflogs-oauth.ts"), "getFflogsOAuthStatus");
check("4. 設定を開いても FFLogs 表示名を消さない", oauth.length > 0 && !/\.delete\(\)/.test(oauth) && !/"fflogs_username"/.test(oauth), true);
const dict = read("src/lib/i18n/dict/settings.ts");
check("OFF の説明に止まるものを書く (ja / en)", /cronOff:\s*"OFF — 毎朝 04:00 の同期も、/.test(dict) && /cronOff:\s*"OFF — stops the 04:00 daily sync/.test(dict), true);

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
