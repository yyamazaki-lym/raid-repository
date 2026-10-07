/**
 * 出席サマリーの pull 数から別のログと同じ pull を除く (2026-10-07、C-3 の続き) の検証。
 * 実行: `node scripts/check-attendance-counted-pulls.mjs`
 *
 *   1. 割り戻し (`src/lib/schedule/attendance-counted-pulls.ts`): 丸ごと同じ 2 本目は
 *      0、一部だけ重なる 2 本目は割合で、日の pull 数を超えない、重複なしは従来通り
 *   2. 配線: 出席サマリーが重複の数を読み、読めなくても止めずに従来の数に戻る
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
  if (a === e) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${name}\n       expected: ${e}\n       actual:   ${a}`);
  }
}
const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

const outDir = mkdtempSync(join(tmpdir(), "attendance-counted-pulls-check-"));
try {
  execFileSync(
    process.execPath,
    [
      "node_modules/typescript/bin/tsc", "src/lib/schedule/attendance-counted-pulls.ts",
      "--outDir", outDir, "--rootDir", "src/lib/schedule",
      "--target", "es2022", "--module", "es2022", "--moduleResolution", "bundler", "--strict",
    ],
    { stdio: "inherit" },
  );
  for (const f of readdirSync(outDir)) {
    if (!f.endsWith(".js")) continue;
    const fp = join(outDir, f);
    writeFileSync(fp.replace(/\.js$/, ".mjs"), readFileSync(fp, "utf8"));
  }
  const { countedAttendancePulls } = await import(pathToFileURL(join(outDir, "attendance-counted-pulls.mjs")).href);
  const asObj = (r) => ({ dayPulls: Object.fromEntries(r.dayPulls), pullsByDay: Object.fromEntries(r.pullsByDay) });

  console.log("1. 割り戻し");
  const report = (reportCode, day, pulls) => ({ reportCode, day, pulls });
  const dup = (reportCode, countedReportCode, duplicatePulls) => ({ reportCode, countedReportCode, duplicatePulls });
  const actual = (reportCode, discordUserId, pulls) => ({ reportCode, discordUserId, pulls });
  check(
    "重複なしは従来通り (レポートの合計)",
    asObj(countedAttendancePulls(
      [report("A", "d1", 20), report("X", "d2", 5)],
      [],
      [actual("A", "u1", 20), actual("A", "u2", 4), actual("X", "u1", 5)],
    )),
    { dayPulls: { d1: 20, d2: 5 }, pullsByDay: { d1: { u1: 20, u2: 4 }, d2: { u1: 5 } } },
  );
  check(
    "2 本目が丸ごと同じ pull なら 1 本分 (以前は 40 / 40・8)",
    asObj(countedAttendancePulls(
      [report("A", "d1", 20), report("B", "d1", 20)],
      [dup("B", "A", 20)],
      [actual("A", "u1", 20), actual("A", "u2", 4), actual("B", "u1", 20), actual("B", "u2", 4)],
    )),
    { dayPulls: { d1: 20 }, pullsByDay: { d1: { u1: 20, u2: 4 } } },
  );
  // 2 本目は録り始めが遅く 15 本中 10 本が 1 本目と同じ (5 本は 1 本目に無い)。
  // u3 は 1 本目の出席の行で名前が取れなかった (2 本目にだけ居る)。
  const partial = asObj(countedAttendancePulls(
    [report("A", "d1", 20), report("B", "d1", 15)],
    [dup("B", "A", 10)],
    [actual("A", "u1", 20), actual("B", "u1", 15), actual("B", "u3", 15)],
  ));
  check("一部だけ重なる: 日の pull 数は数える分だけ (20 + 5)", partial.dayPulls, { d1: 25 });
  check("一部だけ重なる: 割り戻した合計 (20 + 15×5/15) と、1 本のレポートでの数 (15) の大きい方", partial.pullsByDay, { d1: { u1: 25, u3: 15 } });

  // レビューで検出: 出席の行は詳細が取れたレポートにしか無い。数える側に行が無くても消さない。
  check(
    "数える側に出席の行が無い: 2 本目の行の数で数える (割り戻すと 0 になっていた)",
    asObj(countedAttendancePulls(
      [report("A", "d1", 21), report("B", "d1", 20)],
      [dup("B", "A", 20)],
      [actual("B", "u1", 20), actual("B", "u2", 20)],
    )),
    { dayPulls: { d1: 21 }, pullsByDay: { d1: { u1: 20, u2: 20 } } },
  );
  check(
    "数える側に出席の行が無い・一部だけ重なる: 居た数を下回らない",
    asObj(countedAttendancePulls(
      [report("A", "d1", 21), report("B", "d1", 20)],
      [dup("B", "A", 16)],
      [actual("B", "u1", 20), actual("B", "u2", 2)],
    )),
    { dayPulls: { d1: 25 }, pullsByDay: { d1: { u1: 20, u2: 2 } } },
  );
  check(
    "居たのに四捨五入で 0 にしない (1 × 5/15 = 0.33 → 1)",
    asObj(countedAttendancePulls(
      [report("A", "d1", 20), report("B", "d1", 15)],
      [dup("B", "A", 10)],
      [actual("A", "u1", 20), actual("B", "x", 1)],
    )).pullsByDay,
    { d1: { u1: 20, x: 1 } },
  );
  // レビューで検出: 2 夜ぶんを 1 本に入れたレポート (最初の pull の日 = d0) が相手。
  check(
    "相手が別の日に数えられている重複は割り引かない (その日の pull を消さない)",
    asObj(countedAttendancePulls(
      [report("B", "d0", 40), report("A", "d1", 20)],
      [dup("A", "B", 20)],
      [actual("A", "u1", 20), actual("B", "u1", 40)],
    )),
    { dayPulls: { d0: 40, d1: 20 }, pullsByDay: { d1: { u1: 20 }, d0: { u1: 40 } } },
  );
  check(
    "相手が期間の外 (レポートの一覧に無い) なら割り引かない",
    asObj(countedAttendancePulls([report("A", "d1", 10)], [dup("A", "OLD", 10)], [actual("A", "u1", 10)])),
    { dayPulls: { d1: 10 }, pullsByDay: { d1: { u1: 10 } } },
  );
  const r = countedAttendancePulls(
    [report("A", "d1", 7), report("B", "d1", 9), report("C", "d1", 3)],
    [dup("B", "A", 4), dup("C", "A", 3)],
    [actual("A", "u1", 7), actual("B", "u1", 9), actual("C", "u1", 3)],
  );
  check("メンバーの数は日の pull 数を超えない", r.pullsByDay.get("d1").u1 <= r.dayPulls.get("d1"), true);
  check(
    "重複の数がレポートの pull 数を超えても負にしない",
    asObj(countedAttendancePulls([report("A", "d1", 3), report("B", "d1", 5)], [dup("A", "B", 9)], [actual("A", "u1", 3)])),
    { dayPulls: { d1: 5 }, pullsByDay: { d1: { u1: 3 } } },
  );
  check("日の無いレポートの実績は数えない", asObj(countedAttendancePulls([report("A", "d1", 3)], [], [actual("Z", "u1", 3)])), { dayPulls: { d1: 3 }, pullsByDay: {} });
  check("pull 0 のレポートは割合 1 (割り算しない)", asObj(countedAttendancePulls([report("A", "d1", 0)], [], [actual("A", "u1", 0)])), { dayPulls: { d1: 0 }, pullsByDay: { d1: { u1: 0 } } });
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

console.log("\n2. 配線");
const actions = read("src/lib/server/attendance-summary-actions.ts");
check("重複の数を読む (13c-4)", /db\.rpc\("fflogs_report_duplicate_pulls", \{ p_from_ms: cutoffMs \}\)/.test(actions), true);
check("読めなくても止めない (firstError に入れない)", /const firstError =\s*sessionsRes\.error \?\? membersRes\.error \?\? fightsRes\.error;/.test(actions) && !/duplicateRes\.error \?\?/.test(actions), true);
check("読めないときは警告して重複なしとして扱う", /if \(duplicateRes\.error\) \{\s*console\.warn\(/.test(actions), true);
check("日の pull 数とメンバーの pull 数は割り戻した値", /const \{ dayPulls: pullsPerDay, pullsByDay \} = countedAttendancePulls\(/.test(actions), true);
check("レポート単位の生の合計を残していない", /pullsPerDay\.set\(/.test(actions), false);

const schema = read("supabase/schema.sql");
const fnAt = schema.indexOf("CREATE OR REPLACE FUNCTION public.fflogs_report_duplicate_pulls(");
const fnBody = fnAt < 0 ? "" : schema.slice(fnAt, schema.indexOf("\n$$;", fnAt));
check("schema: 重複の数は 13c-2b の関数から、相手のレポートごとに数える", /FROM public\.fflogs_duplicate_pulls\(p_from_ms\) d\s*GROUP BY d\.report_code, d\.counted_report_code/.test(fnBody), true);
check("相手のレポートを読んで渡す (同じ日の相手だけ割り引く)", /countedReportCode: d\.counted_report_code/.test(actions) && /countedAttendancePulls\(\s*reportDays,\s*duplicates,/.test(actions), true);
check("schema: anon には配らない", /REVOKE EXECUTE ON FUNCTION public\.fflogs_report_duplicate_pulls\(bigint\) FROM PUBLIC, anon;/.test(schema), true);
check("schema: service role (出席サマリー) に配る", /GRANT EXECUTE ON FUNCTION public\.fflogs_report_duplicate_pulls\(bigint\)\s*TO authenticated, service_role;/.test(schema), true);

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
