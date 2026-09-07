/**
 * セッションの出欠サマリー (src/lib/schedule/attendance-summary.ts) の
 * 検証 (2026-09-07、UI-9)。
 * 実行: `node scripts/check-attendance-summary.mjs`
 *
 * 予定表の各行に「○5 ⏰1 △1 未回答1」を出すための集計。記号は
 * character-sheets 側の凡例で自由に編集できるので、**知らない記号を
 * 勝手に「参加可」へ寄せない**ことと、未回答判定のゆらぎ (全角ハイフン /
 * 半角 / 空白) の吸収を固定する。人数を偽ると成立判断が狂う。
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
  if (a === e) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}\n       expected: ${e}\n       actual:   ${a}`);
  }
}

const outDir = mkdtempSync(join(tmpdir(), "att-summary-check-"));
try {
  execFileSync(
    "npx",
    ["tsc", "src/lib/schedule/attendance-summary.ts", "--outDir", outDir,
     "--target", "es2022", "--module", "es2022", "--moduleResolution", "bundler", "--strict"],
    { stdio: "inherit" },
  );
  for (const f of readdirSync(outDir)) {
    if (!f.endsWith(".js")) continue;
    const fp = join(outDir, f);
    writeFileSync(fp, readFileSync(fp, "utf8").replace(
      /(from\s+["'])(\.\.?\/[^"']+?)(?<!\.js)(["'])/g, "$1$2.js$3"));
  }
  const { summarizeAttendance, availableCount, attendanceStage } = await import(
    pathToFileURL(join(outDir, "attendance-summary.js")).href
  );

  const members = Array.from({ length: 8 }, (_, i) => ({
    userId: `u${i + 1}`,
    name: `メンバー${i + 1}`,
  }));
  const answers = (list) =>
    Object.fromEntries(list.map((s, i) => [`u${i + 1}`, s]));

  console.log("記号の分類");
  const full = summarizeAttendance(members, answers(["◯","◯","◯","◯","◯","◯","◯","◯"]));
  check("全員参加可", [full.ok, full.answered, full.unanswered, full.total], [8, 8, 0, 8]);
  const mixed = summarizeAttendance(members, answers(["◯","○","⏰","△","×","－","",undefined]));
  check("参加可は半角/全角の両方", mixed.ok, 2);
  check("遅刻は別に数える", mixed.late, 1);
  check("未定", mixed.undecided, 1);
  check("不可", mixed.no, 1);
  check("未回答 (－ / 空文字 / 未設定)", mixed.unanswered, 3);
  check("回答済みは 5", mixed.answered, 5);

  console.log("\n知らない記号を「参加可」に寄せない");
  const custom = summarizeAttendance(members, answers(["全","昼","夜","早","?","◯","◯","◯"]));
  check("カスタム記号は other", custom.other, 5);
  check("参加可は 3 のまま", custom.ok, 3);
  check("other も回答済みには数える", custom.answered, 8);

  console.log("\n未回答判定のゆらぎ");
  for (const [label, sym] of [
    ["全角ハイフン －", "－"],
    ["半角ハイフン -", "-"],
    ["長音 ー", "ー"],
    ["空白のみ", "  "],
    ["空文字", ""],
  ]) {
    const s = summarizeAttendance([{ userId: "u1", name: "A" }], { u1: sym });
    check(label, [s.unanswered, s.answered], [1, 0]);
  }

  console.log("\n未回答者の名前");
  const named = summarizeAttendance(members, answers(["◯","－","◯","","◯","◯","◯","◯"]));
  check("未回答の人だけ並ぶ", named.unansweredNames, ["メンバー2", "メンバー4"]);
  check("表の順を保つ", named.unansweredNames[0], "メンバー2");

  console.log("\n表に無い人は数えない");
  const extra = summarizeAttendance(
    [{ userId: "u1", name: "A" }],
    { u1: "◯", zzz: "◯" },
  );
  check("分母は表の人数", [extra.total, extra.ok], [1, 1]);

  console.log("\n参加見込みと段階");
  check(
    "参加可 + 遅刻",
    availableCount(summarizeAttendance(members, answers(["◯","◯","⏰","△","×","－","－","－"]))),
    3,
  );
  check(
    "8 人揃えば full",
    attendanceStage(summarizeAttendance(members, answers(["◯","◯","◯","◯","◯","◯","◯","⏰"])), 8),
    "full",
  );
  check(
    "未回答が残っていれば waiting (人数不足より優先)",
    attendanceStage(summarizeAttendance(members, answers(["◯","◯","◯","×","－","－","－","－"])), 8),
    "waiting",
  );
  check(
    "全員回答済みで足りなければ short",
    attendanceStage(summarizeAttendance(members, answers(["◯","◯","◯","×","×","×","×","×"])), 8),
    "short",
  );
  check(
    "未定だけ残っていても short (未定は頭数に入れない)",
    attendanceStage(summarizeAttendance(members, answers(["◯","◯","◯","◯","◯","◯","◯","△"])), 8),
    "short",
  );
  check("メンバー 0 人なら short", attendanceStage(summarizeAttendance([], {}), 8), "short");
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
