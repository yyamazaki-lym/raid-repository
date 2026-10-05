/**
 * 練習ログの「日」を YYYY-MM-DD にそろえる (2026-10-05、`src/lib/session-date.ts`)
 * の検証。
 * 実行: `node scripts/check-session-date.mjs`
 *
 * 日程の Logs から付いたレポートは rawDate (`2026/10/04(日) 21:30~0:00`) が
 * `session_date` に入っていた。出席の自動突合の保存が CHECK (20 文字以内) で丸ごと
 * 失敗し、取り直しの判定が日付を読めず、練習ログの日が割れていた。ここでは
 *   - rawDate (書式のゆれを含む) を YYYY-MM-DD にし、読めないものは null
 *   - 書き込み (日程の Logs から / 台帳から読む値) と読み取り (`fightDate`) でそろえる
 *   - schema の書き換え (4 表、読めない行は飛ばす、冪等) がある
 * を固定する。実際の書き換えは PGlite で流して確かめた (PR 本文)。
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

const outDir = mkdtempSync(join(tmpdir(), "session-date-check-"));
try {
  execFileSync(
    process.execPath,
    [
      "node_modules/typescript/bin/tsc", "src/lib/session-date.ts", "src/lib/fflogs-progress.ts",
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
  const sd = await import(pathToFileURL(join(outDir, "session-date.js")).href);
  const prog = await import(pathToFileURL(join(outDir, "fflogs-progress.js")).href);

  console.log("そろえ方");
  const n = sd.normalizeSessionDate;
  check("同期式の rawDate", n("2026/10/04(日) 21:30~0:00"), "2026-10-04");
  check("月日 1 桁", n("2026/3/5(木) 21:00~23:00"), "2026-03-05");
  check("括弧の前に空白 (demo の形)", n("2026/03/10 (火)"), "2026-03-10");
  check("YYYY-MM-DD はそのまま", n("2026-10-01"), "2026-10-01");
  check("前後の空白は無視", n("  2026/10/04(日)  "), "2026-10-04");
  check("存在しない日は null", n("2026/02/30(月) 21:00~23:00"), null);
  check("読めないものは null", [n("不明"), n(""), n(null), n(undefined), n("20261004")], [null, null, null, null, null]);
  check("年の後ろに数字が続くものは読まない", n("2026/10/045"), null);

  console.log("\n読み取り (fightDate)");
  const fight = (sessionDate, startMs = Date.parse("2026-10-04T12:30:00Z")) => ({ sessionDate, startMs });
  check("rawDate の session_date を日に直す", prog.fightDate(fight("2026/10/04(日) 21:30~0:00")), "2026-10-04");
  check("22:00 と 21:30 の rawDate は同じ日", prog.fightDate(fight("2026/10/04(日) 22:00~0:00")), prog.fightDate(fight("2026/10/04(日) 21:30~0:00")));
  check("読めなければ開始時刻の JST 暦日", prog.fightDate(fight("不明", Date.parse("2026-10-04T16:00:00Z"))), "2026-10-05");
  check("空なら開始時刻の JST 暦日", prog.fightDate(fight(null)), "2026-10-04");
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

console.log("\n配線");
const sync = read("src/lib/server/fflogs-fights.ts");
check("書き込み: 日程の Logs の rawDate をそろえる", /normalizeSessionDate\(\(r as \{ raw_date: string \| null \}\)\.raw_date\)/.test(sync), true);
check("書き込み: 自前作成式の日程の rawDate もそろえる", /put\(\(r as \{ url: string \| null \}\)\.url, null, normalizeSessionDate\(rawDate\)\);/.test(sync), true);
check("台帳から読む日付もそろえる (取り直しの判定)", /sessionDate: normalizeSessionDate\(row\.session_date as string \| null\),/.test(sync), true);
const progSrc = read("src/lib/fflogs-progress.ts");
check("読み取り: fightDate がそろえる", /return normalizeSessionDate\(f\.sessionDate\) \?\? jstYmdString\(new Date\(f\.startMs\)\);/.test(progSrc), true);
const schema = read("supabase/schema.sql");
const block = schema.slice(schema.indexOf("-- ---- 6b-12."), schema.indexOf("-- ---- 7. RLS"));
check("schema: 書き換えの節がある", block.length > 0 && block.includes("DO $$"), true);
check(
  "schema: 4 表の日付の列を書き換える",
  ["('fflogs_fights', 'session_date')", "('fflogs_report_syncs', 'session_date')", "('fflogs_attendance_actuals', 'session_date')", "('fflogs_attendance_unresolved', 'last_session_date')"].every((s) => block.includes(s)),
  true,
);
check("schema: rawDate の形の行だけ (冪等)", block.includes("'^\\d{4}/\\d{1,2}/\\d{1,2}'"), true);
check("schema: 読めない行は止めずに飛ばす", /EXCEPTION WHEN others THEN\s*RAISE NOTICE/.test(block), true);
check("schema: 書き換え先は YYYY-MM-DD", /'YYYY-MM-DD'/.test(block), true);

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
