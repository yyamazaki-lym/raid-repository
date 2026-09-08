/**
 * 練習ログのイベント検出 (src/lib/logs-notify.ts) の検証
 * (2026-09-07、W-35)。
 * 実行: `node scripts/check-logs-notify.mjs`
 *
 * 通知は一度飛ぶと取り消せないので、**誤検出しないこと**を重点的に固定する:
 *   - 初回同期で全ログが「ベスト更新」として一斉に飛ばないこと
 *   - フェーズが進んだときに残 HP% を比較しないこと (新フェーズの削りは
 *     100% から始まるので、比較すると必ず「後退」に見える)
 *   - 調子の悪い日 (フェーズが下がった) を更新扱いしないこと
 *   - 通知が既定 OFF であること
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const SRC = "src/lib/logs-notify.ts";

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

const snap = (bestPhase, bestPercentage, hasClear = false) => ({
  bestPhase,
  bestPercentage,
  hasClear,
});

const outDir = mkdtempSync(join(tmpdir(), "logs-notify-check-"));
try {
  execFileSync(
    process.execPath,
    [
      "node_modules/typescript/bin/tsc", SRC,
      "--outDir", outDir,
      "--target", "es2022",
      "--module", "es2022",
      "--moduleResolution", "bundler",
      "--strict",
    ],
    { stdio: "inherit" },
  );
  const {
    LOGS_NOTIFY_KINDS,
    isLogsNotifyKind,
    logsNotifyKey,
    parseLogsNotifyEnabled,
    detectLogsEvents,
    formatLogsNotifyMessage,
  } = await import(pathToFileURL(join(outDir, "logs-notify.js")).href);

  console.log("種類と設定キー");
  check("種類は 3 つ", LOGS_NOTIFY_KINDS.length, 3);
  check("newReport は有効", isLogsNotifyKind("newReport"), true);
  check("未知の種類は無効", isLogsNotifyKind("macroUpdate"), false);
  check("設定キー (newReport)", logsNotifyKey("newReport"), "logs_notify_new_report");
  check("設定キー (bestUpdate)", logsNotifyKey("bestUpdate"), "logs_notify_best_update");
  check("設定キー (firstClear)", logsNotifyKey("firstClear"), "logs_notify_first_clear");

  console.log("\n通知は既定 OFF");
  check("未設定は OFF", parseLogsNotifyEnabled(null), false);
  check("空文字は OFF", parseLogsNotifyEnabled(""), false);
  check('"false" は OFF', parseLogsNotifyEnabled("false"), false);
  check("不正値は OFF", parseLogsNotifyEnabled("1"), false);
  check('"true" だけ ON', parseLogsNotifyEnabled("true"), true);
  check("前後の空白は無視して ON", parseLogsNotifyEnabled(" true "), true);

  console.log("\n初回同期 (prev = null)");
  // ここが肝: 初めて取り込んだ全ログが「ベスト更新」として飛ばない。
  check(
    "ベスト更新は出さない",
    detectLogsEvents(null, snap(3, 25), 4).map((e) => e.kind),
    ["newReport"],
  );
  check(
    "初回でも討伐があれば初討伐は出す",
    detectLogsEvents(null, snap(5, 0, true), 2).map((e) => e.kind),
    ["firstClear", "newReport"],
  );
  check(
    "新レポート 0 件なら何も出さない",
    detectLogsEvents(null, snap(3, 25), 0),
    [],
  );

  console.log("\nベスト更新の判定");
  check(
    "フェーズが進んだ",
    detectLogsEvents(snap(3, 25), snap(4, 90), 1).map((e) => e.kind),
    ["bestUpdate", "newReport"],
  );
  // フェーズが進んだときは残 HP% を比較しない。新フェーズの削りは 100% から
  // 始まるので、比較すると必ず「後退」に見えてしまう (25% → 90%)。
  check(
    "フェーズが進めば残 HP% が悪化していても更新",
    detectLogsEvents(snap(3, 5), snap(4, 99), 0).map((e) => e.kind),
    ["bestUpdate"],
  );
  check(
    "phaseAdvanced フラグが立つ",
    detectLogsEvents(snap(3, 25), snap(4, 90), 0)[0].phaseAdvanced,
    true,
  );
  check(
    "同じフェーズで残 HP% が下がった",
    detectLogsEvents(snap(4, 30), snap(4, 12), 0).map((e) => e.kind),
    ["bestUpdate"],
  );
  check(
    "残 HP% だけの更新は phaseAdvanced が false",
    detectLogsEvents(snap(4, 30), snap(4, 12), 0)[0].phaseAdvanced,
    false,
  );
  check(
    "同じフェーズで残 HP% が同じなら更新なし",
    detectLogsEvents(snap(4, 30), snap(4, 30), 0),
    [],
  );
  check(
    "同じフェーズで残 HP% が悪化なら更新なし",
    detectLogsEvents(snap(4, 12), snap(4, 40), 0),
    [],
  );
  // 調子の悪い日 (最深まで行けなかった) を「更新」にしない。
  check(
    "フェーズが下がったら更新なし",
    detectLogsEvents(snap(5, 40), snap(3, 10), 0),
    [],
  );
  check(
    "到達フェーズ未取得なら更新なし",
    detectLogsEvents(snap(4, 30), snap(null, 10), 0),
    [],
  );
  check(
    "前回の残 HP% が未取得なら今回の値で更新",
    detectLogsEvents(snap(4, null), snap(4, 30), 0).map((e) => e.kind),
    ["bestUpdate"],
  );

  console.log("\n初討伐の判定");
  check(
    "討伐が付いた",
    detectLogsEvents(snap(5, 3), snap(5, 0, true), 1).map((e) => e.kind),
    ["firstClear", "bestUpdate", "newReport"],
  );
  check(
    "既に討伐済みなら出さない",
    detectLogsEvents(snap(5, 0, true), snap(5, 0, true), 1).map((e) => e.kind),
    ["newReport"],
  );

  console.log("\n通知本文");
  check(
    "初討伐",
    formatLogsNotifyMessage({
      categoryName: "絶竜詩戦争",
      events: [{ kind: "firstClear" }],
    }),
    "🏆 **絶竜詩戦争** を初討伐しました!",
  );
  check(
    "フェーズ更新",
    formatLogsNotifyMessage({
      categoryName: "絶オメガ",
      events: [
        { kind: "bestUpdate", phase: 5, percentage: 88.5, phaseAdvanced: true },
      ],
    }),
    "📈 **絶オメガ** の到達フェーズが更新されました (P5 / 残り 88.5%)",
  );
  check(
    "残 HP% 更新",
    formatLogsNotifyMessage({
      categoryName: "絶オメガ",
      events: [
        { kind: "bestUpdate", phase: 5, percentage: 12.3, phaseAdvanced: false },
      ],
    }),
    "📈 **絶オメガ** のベスト到達が更新されました (P5 / 残り 12.3%)",
  );
  check(
    "新レポート + URL",
    formatLogsNotifyMessage({
      categoryName: "天獄編零式",
      events: [{ kind: "newReport", reports: 3 }],
      url: "https://example.com/category/tengoku/logs",
    }),
    "🆕 **天獄編零式** の練習ログに新しいレポートを 3 件取り込みました\nhttps://example.com/category/tengoku/logs",
  );
  check(
    "複数イベントは改行で並べる",
    formatLogsNotifyMessage({
      categoryName: "X",
      events: [{ kind: "firstClear" }, { kind: "newReport", reports: 1 }],
    }).split("\n").length,
    2,
  );
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
