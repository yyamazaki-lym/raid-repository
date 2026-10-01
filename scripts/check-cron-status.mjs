/**
 * 自動処理 (cron) の最終実行と成否の記録 (2026-10-01 監査 F-2) の検査。
 * 実行: `node scripts/check-cron-status.mjs`
 *
 *   1. 純関数 (src/lib/cron-status.ts): 失敗の連続回数・失敗以外で 0 に戻る・
 *      最後の成功 / 失敗の引き継ぎ・理由の切り詰め・壊れた保存値・通知は
 *      失敗に変わった最初の 1 回だけ・「止まっている」判定の境界
 *   2. 配線: src/app/api/cron/ の route **すべて**が CRON_JOBS に載っていて、
 *      認証で弾いた応答以外の `return NextResponse.json(` の直前で
 *      `recordCronRun("<自分の job>", …)` を呼ぶ (新しい cron の記録漏れを止める)
 *   3. 記録は best-effort (例外を route に漏らさない)、通知は既定 OFF で
 *      失敗に変わった最初の 1 回だけ。設定ダイアログに節がある
 */
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
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

const outDir = mkdtempSync(join(tmpdir(), "cron-status-check-"));
try {
  execFileSync(
    process.execPath,
    [
      "node_modules/typescript/bin/tsc",
      "src/lib/cron-status.ts",
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
    writeFileSync(fp, readFileSync(fp, "utf8"));
  }
  const cs = await import(pathToFileURL(join(outDir, "cron-status.js")).href);

  console.log("1. 純関数");
  const t1 = "2026-10-01T00:00:00.000Z";
  const t2 = "2026-10-02T00:00:00.000Z";
  const t3 = "2026-10-03T00:00:00.000Z";
  const okRun = cs.nextCronStatus(null, { outcome: "ok" }, t1);
  check("初回の成功", okRun, {
    at: t1, outcome: "ok", reason: null, lastOkAt: t1,
    lastErrorAt: null, lastErrorReason: null, consecutiveErrors: 0,
  });
  const err1 = cs.nextCronStatus(okRun, { outcome: "error", reason: "discord api 401" }, t2);
  check("失敗: 回数 1、最後の成功を引き継ぐ", [err1.consecutiveErrors, err1.lastOkAt, err1.lastErrorAt, err1.reason], [1, t1, t2, "discord api 401"]);
  check("失敗に変わった最初の 1 回は通知する", cs.shouldAlertCron(err1), true);
  const err2 = cs.nextCronStatus(err1, { outcome: "error", reason: "discord api 401" }, t3);
  check("続けて失敗: 回数 2", err2.consecutiveErrors, 2);
  check("続けて失敗しても再通知しない", cs.shouldAlertCron(err2), false);
  const back = cs.nextCronStatus(err2, { outcome: "skipped", reason: "disabled" }, t3);
  check("失敗以外で回数 0、最後の失敗は残す", [back.consecutiveErrors, back.lastErrorAt, back.lastErrorReason, back.lastOkAt], [0, t3, "discord api 401", t3]);
  check("戻った回は通知しない", cs.shouldAlertCron(back), false);
  const again = cs.nextCronStatus(back, { outcome: "error", reason: "x" }, t3);
  check("また失敗に変わったら通知する", cs.shouldAlertCron(again), true);
  const long = cs.nextCronStatus(null, { outcome: "error", reason: "a".repeat(1000) }, t1);
  check("理由は上限で切り詰める", long.reason.length, cs.CRON_REASON_MAX);
  check("空白だけの理由は null", cs.nextCronStatus(null, { outcome: "ok", reason: "  \n " }, t1).reason, null);
  check("改行は空白 1 つに", cs.nextCronStatus(null, { outcome: "error", reason: "a\n\nb" }, t1).reason, "a b");
  check("保存値の往復", cs.parseCronStatus(JSON.stringify(err2)), err2);
  check("壊れた JSON は null", cs.parseCronStatus("{"), null);
  check("知らない outcome は null", cs.parseCronStatus(JSON.stringify({ ...err2, outcome: "weird" })), null);
  check("負の回数は 0 に", cs.parseCronStatus(JSON.stringify({ ...err2, consecutiveErrors: -3 })).consecutiveErrors, 0);
  check("未保存は null", cs.parseCronStatus(null), null);
  const base = Date.parse(t1);
  check("日次: 26 時間ちょうどはまだ", cs.isCronStale("import-discord", okRun, base + 26 * 3600e3), false);
  check("日次: 26 時間を過ぎたら止まっている", cs.isCronStale("import-discord", okRun, base + 26 * 3600e3 + 1), true);
  check("毎時: 2 時間 10 分を過ぎたら止まっている", cs.isCronStale("attendance-reminder", okRun, base + 130 * 60e3 + 1), true);
  check("毎時: 2 時間ならまだ", cs.isCronStale("attendance-reminder", okRun, base + 120 * 60e3), false);
  check("未実行は判定しない", cs.isCronStale("fflogs-sync", null, base), false);
  check("キーの形", cs.cronStatusKey("fflogs-sync"), "cron_status:fflogs-sync");
  check("全ジョブに間隔がある", cs.CRON_JOBS.every((j) => typeof cs.CRON_STALE_AFTER_MS[j] === "number"), true);

  console.log("2. 配線 (cron の route すべて)");
  const routeDirs = readdirSync("src/app/api/cron").filter((d) =>
    statSync(join("src/app/api/cron", d)).isDirectory(),
  );
  check("route はすべて CRON_JOBS に載っている", routeDirs.filter((d) => !cs.CRON_JOBS.includes(d)), []);
  check("CRON_JOBS に route の無い名前が無い", cs.CRON_JOBS.filter((j) => !routeDirs.includes(j)), []);
  for (const dir of routeDirs) {
    const file = join("src/app/api/cron", dir, "route.ts");
    const src = readFileSync(file, "utf8");
    const lines = src.split("\n");
    const missing = [];
    lines.forEach((line, i) => {
      if (!/return NextResponse\.json\(/.test(line)) return;
      // 直前の文 (空行・コメントを飛ばして遡った最初の `;` で終わる文の塊)
      // に recordCronRun("<dir>" がある
      const window = lines.slice(Math.max(0, i - 30), i).join("\n");
      const lastStmtEnd = window.lastIndexOf("await recordCronRun(");
      const between = lastStmtEnd >= 0 ? window.slice(lastStmtEnd) : "";
      const ok =
        lastStmtEnd >= 0 &&
        new RegExp(`await recordCronRun\\(\\s*"${dir}"`).test(between) &&
        !/return /.test(between.slice(between.indexOf(";")));
      if (!ok) missing.push(`${dir}/route.ts:${i + 1}`);
    });
    check(`${dir}: 応答の直前で記録する`, missing, []);
    check(`${dir}: 認証で弾いた応答は記録しない`, /if \(denied\) return denied;/.test(src) && !/recordCronRun[\s\S]{0,80}if \(denied\)/.test(src), true);
  }

  console.log("3. 記録と通知");
  const server = readFileSync("src/lib/server/cron-status.ts", "utf8");
  const body = server.slice(server.indexOf("export async function recordCronRun("));
  check("全体を try/catch で包む (route に例外を漏らさない)", /\): Promise<void> \{\s*try \{/.test(body) &&/\} catch \(err\) \{\s*console\.warn\("\[cron-status\] record failed"/.test(body), true);
  check("通知は失敗に変わった最初の 1 回だけ", /if \(!shouldAlertCron\(next\)\) return;/.test(body), true);
  check("通知は設定が \"true\" のときだけ (既定 OFF)", /if \(\(byKey\.get\(CRON_ALERT_ENABLED_KEY\) \?\? ""\) !== "true"\) return;/.test(body), true);
  check("メンションは付けない", /allowed_mentions: \{ parse: \[\] \}/.test(body), true);
  check("通知に timeout", /signal: AbortSignal\.timeout\(10_000\)/.test(body), true);
  const actions = readFileSync("src/lib/server/cron-status-actions.ts", "utf8");
  check("Server Action は admin のみ (2 本とも)", (actions.match(/const auth = await assertAdminResult\(\);\s*if \(!auth\.ok\) return/g) ?? []).length, 2);
  const dialog = readFileSync("src/components/portal/settings-dialog.tsx", "utf8");
  check("設定ダイアログに節がある", /<CronStatusSection open=\{open\} canEdit=\{canEdit\} \/>/.test(dialog), true);
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

if (failures > 0) {
  console.log(`\n${failures} 件失敗`);
  process.exit(1);
}
console.log("\nすべて ok");
