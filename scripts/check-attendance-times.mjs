/**
 * 遅刻 / 早退の予定時刻と Discord タイムスタンプ (src/lib/schedule/attendance-times.ts)
 * の検証 (2026-09-06、調査ノート第 4 回 W-13 / W-14)。
 * 実行: `node scripts/check-attendance-times.mjs`
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const SRC = "src/lib/schedule/attendance-times.ts";

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

const outDir = mkdtempSync(join(tmpdir(), "att-times-check-"));
try {
  execFileSync(
    "npx",
    ["tsc", SRC, "--outDir", outDir, "--target", "es2022", "--module", "es2022", "--moduleResolution", "bundler", "--strict"],
    { stdio: "inherit" },
  );
  const m = await import(pathToFileURL(join(outDir, "attendance-times.js")).href);

  console.log("\n[時刻の正規化]");
  check("HH:MM", m.normalizeAttendanceTime("21:30"), "21:30");
  check("先頭ゼロ補完", m.normalizeAttendanceTime("9:05"), "09:05");
  check("秒付き (time input) は秒を落とす", m.normalizeAttendanceTime("21:30:00"), "21:30");
  check("空は null", m.normalizeAttendanceTime("  "), null);
  check("null は null", m.normalizeAttendanceTime(null), null);
  check("24:00 は不正", m.normalizeAttendanceTime("24:00"), null);
  check("文字は不正", m.normalizeAttendanceTime("21時"), null);

  console.log("\n[表示ヒント]");
  check("到着のみ", m.formatAttendanceTimesHint({ arriveAt: "21:30", leaveAt: null }), "21:30〜");
  check("早退のみ", m.formatAttendanceTimesHint({ arriveAt: null, leaveAt: "23:00" }), "〜23:00");
  check("両方", m.formatAttendanceTimesHint({ arriveAt: "21:30", leaveAt: "23:00" }), "21:30〜23:00");
  check("無し", m.formatAttendanceTimesHint({ arriveAt: null, leaveAt: null }), null);
  check("undefined", m.formatAttendanceTimesHint(undefined), null);
  check("説明文", m.describeAttendanceTimes({ arriveAt: "21:30", leaveAt: "23:00" }), "到着予定 21:30 / 早退 23:00");

  console.log("\n[記号と予定時刻]");
  check("○ は可", m.symbolAllowsTimes("○"), true);
  check("⏰ は可", m.symbolAllowsTimes("⏰"), true);
  check("× は不可", m.symbolAllowsTimes("×"), false);
  check("未回答 (空) は不可", m.symbolAllowsTimes(""), false);
  check("null は不可", m.symbolAllowsTimes(null), false);

  console.log("\n[開始時刻 → UNIX 秒 (JST)]");
  // 2026-09-08 21:00 JST = 2026-09-08 12:00 UTC
  check(
    "YYYY/MM/DD(曜) HH:MM~HH:MM",
    m.sessionStartUnixSeconds("2026/09/08(火) 21:00~23:00", "21:00"),
    Math.floor(Date.UTC(2026, 8, 8, 12, 0, 0) / 1000),
  );
  check(
    "YYYY-MM-DD も可",
    m.sessionStartUnixSeconds("2026-09-08", "9:30"),
    Math.floor(Date.UTC(2026, 8, 8, 0, 30, 0) / 1000),
  );
  check("日付が読めない", m.sessionStartUnixSeconds("次の火曜", "21:00"), null);
  check("時刻が読めない", m.sessionStartUnixSeconds("2026/09/08", null), null);
  check("月が範囲外", m.sessionStartUnixSeconds("2026/13/08", "21:00"), null);

  console.log("\n[Discord タイムスタンプ]");
  check("F", m.discordTimestamp(1789000000, "F"), "<t:1789000000:F>");
  check("R (既定 F)", m.discordTimestamp(1789000000.7), "<t:1789000000:F>");
  check("null は空", m.discordTimestamp(null, "R"), "");

  console.log("\n[カウントダウン]");
  const t0 = Date.UTC(2026, 8, 8, 12, 0, 0);
  check("1 時間 32 分前", m.formatCountdown(t0, t0 - (92 * 60_000)), "開始まで 1 時間 32 分");
  check("ちょうど 2 時間", m.formatCountdown(t0, t0 - (120 * 60_000)), "開始まで 2 時間");
  check("45 分", m.formatCountdown(t0, t0 - (45 * 60_000)), "開始まで 45 分");
  check("30 秒 → 1 分に切り上げ", m.formatCountdown(t0, t0 - 30_000), "開始まで 1 分");
  check("開始後は null", m.formatCountdown(t0, t0 + 1), null);
  check("24 時間より先は null", m.formatCountdown(t0, t0 - (25 * 3_600_000)), null);
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
