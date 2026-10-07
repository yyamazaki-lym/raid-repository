/**
 * 練習ログの週のまとめ (2026-10-05、F-6 の C-4) の検証。
 * 実行: `node scripts/check-logs-weekly-summary.mjs`
 *
 * Discord への投稿は取り消せないので、次を固定する:
 *   - 週の区切り (練習日の火〜月) と送ってよい日 (火〜木)
 *   - 集計 (週より前 / 週より後の pull を混ぜない、最高到達と更新の判定、
 *     初突破 / 初到達 / 初討伐 / ノーデスの数え方)
 *   - 文面
 *   - 配線 (送る前に印を取る / 既定 OFF / 取り込みが済んだ回だけ / プレビューは
 *     送らない / 同期ごとの通知は週のまとめだけ ON でも動かない)
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
/** `export async function name(` から次の top-level の `\n}\n` まで。 */
function fnBody(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) return "";
  const end = src.indexOf("\n}\n", start);
  return end < 0 ? src.slice(start) : src.slice(start, end);
}

const outDir = mkdtempSync(join(tmpdir(), "logs-weekly-summary-check-"));
try {
  execFileSync(
    process.execPath,
    [
      "node_modules/typescript/bin/tsc", "src/lib/logs-weekly-summary.ts",
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
  const ws = await import(pathToFileURL(join(outDir, "logs-weekly-summary.js")).href);
  const prog = await import(pathToFileURL(join(outDir, "fflogs-progress.js")).href);
  const {
    WEEKLY_SUMMARY_DUE_DAYS,
    latestCompletedRaidWeek,
    isWeeklySummaryDue,
    bestReach,
    isReachAhead,
    summarizeWeek,
    formatMonthDay,
    formatHoursMinutes,
    formatWeeklySummaryMessage,
  } = ws;

  console.log("週の区切り (練習日の火〜月)");
  const W = { start: "2026-09-29", end: "2026-10-05" };
  check("火曜 → 前日の月曜で終わる週", latestCompletedRaidWeek("2026-10-06"), W);
  check("水曜 → 同じ週", latestCompletedRaidWeek("2026-10-07"), W);
  check("木曜 → 同じ週", latestCompletedRaidWeek("2026-10-08"), W);
  check("月曜 → 1 つ前の週 (その日の夜の練習がまだ)", latestCompletedRaidWeek("2026-10-05"), { start: "2026-09-22", end: "2026-09-28" });
  check("年をまたぐ", latestCompletedRaidWeek("2027-01-05"), { start: "2026-12-29", end: "2027-01-04" });
  check("送ってよいのは 3 日", WEEKLY_SUMMARY_DUE_DAYS, 3);
  check(
    "送ってよい日は火・水・木だけ",
    ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11"].map(isWeeklySummaryDue),
    [false, true, true, true, false, false, false],
  );

  console.log("\n書式");
  check("日付", [formatMonthDay("2026-09-29"), formatMonthDay("2026-10-05"), formatMonthDay("2026-10-01")], ["9/29(火)", "10/5(月)", "10/1(木)"]);
  check("時間", [formatHoursMinutes(6 * 3600000 + 12 * 60000), formatHoursMinutes(45 * 60000), formatHoursMinutes(0)], ["6時間12分", "45分", "0分"]);

  console.log("\n到達の比べ方");
  const r = (segment, percentage, cleared = false) => ({ segment, percentage, cleared });
  check("深い区間は先", isReachAhead(r(4, 50), r(3, 10)), true);
  check("浅い区間は後", isReachAhead(r(3, 10), r(4, 50)), false);
  check("同じ区間で残 HP% が低い", isReachAhead(r(5, 20), r(5, 25)), true);
  check("同じ区間で残 HP% が高い", isReachAhead(r(5, 25), r(5, 20)), false);
  check("同じ区間で討伐", isReachAhead(r(5, 0, true), r(5, 1)), true);
  check("同じなら更新ではない", isReachAhead(r(5, 20), r(5, 20)), false);
  check("区間が無いときは残 HP% だけ", isReachAhead(r(null, 10), r(null, 20)), true);
  check("pull が無ければ到達なし", bestReach([], null, false), null);

  // pull を作る (JST の時刻で書く)。
  const fight = ({ date, at, sec, enc = 101, kill = false, pct = null, deaths = null, phase = null }) => {
    const startMs = Date.parse(`${date}T${at}:00+09:00`);
    return {
      // 1 日 1 本のレポート (本番の形)。
      reportCode: `R-${date}`, fightId: startMs, sessionDate: date, name: null, kill,
      fightPercentage: pct, lastPhase: phase, encounterId: enc, difficulty: null,
      partyDps: null, deaths, wipe: null, phases: null,
      startMs, endMs: startMs + sec * 1000, reportStartMs: null,
    };
  };

  console.log("\n零式の週");
  const savage = [
    // 週より前: 1 層・2 層を突破済み
    fight({ date: "2026-09-22", at: "22:00", sec: 300, enc: 101, kill: true }),
    fight({ date: "2026-09-22", at: "22:10", sec: 200, enc: 102, pct: 50 }),
    fight({ date: "2026-09-22", at: "22:20", sec: 300, enc: 102, kill: true }),
    // 週の 1 日目: 3 層を初突破、4 層に入る
    fight({ date: "2026-09-29", at: "22:00", sec: 240, enc: 103, pct: 61.2 }),
    fight({ date: "2026-09-29", at: "22:10", sec: 300, enc: 103, kill: true, deaths: 2 }),
    fight({ date: "2026-09-29", at: "22:20", sec: 180, enc: 104, pct: 40 }),
    // 週の 2 日目: 4 層をノーデスで初討伐
    fight({ date: "2026-10-01", at: "22:00", sec: 360, enc: 104, pct: 23.4, deaths: 3 }),
    fight({ date: "2026-10-01", at: "22:30", sec: 420, enc: 104, kill: true, deaths: 0 }),
    // 週より後 (水・木に送るときの火曜の練習): 数えない
    fight({ date: "2026-10-06", at: "22:00", sec: 400, enc: 104, kill: true, deaths: 0 }),
  ];
  const floors = prog.buildFloorMap(savage, 4, "ja");
  const s1 = summarizeWeek(savage, W, floors, false, "ja");
  check("練習日と pull (週より後を数えない)", [s1.days, s1.pulls], [2, 5]);
  // ログ合計: 1 日 1 本のレポートで 23 分 + 37 分 (ログの開始が無いので最初の pull から)。
  check("戦闘とログ合計", [s1.fightMs, s1.logMs], [1500000, 3600000]);
  const withStart = savage.map((f) => ({
    ...f,
    reportStartMs: Date.parse(f.sessionDate === "2026-10-01" ? "2026-10-01T21:55:00+09:00" : "2026-09-29T21:50:00+09:00"),
  }));
  check(
    "ログの開始 (各ログの最初の pull の 10 分前・5 分前) を入れる",
    summarizeWeek(withStart, W, floors, false, "ja").logMs,
    (10 + 23 + 5 + 37) * 60000,
  );
  // 本番の形の別の例: 複数日分を 1 本のレポートで上げた (session_date はレポートに
  // つき 1 つ)。2026-10-07: pull の間の休憩は 1 回 60 分までなので、夜の分は 60 分だけ。
  const oneReport = savage.slice(3, 8).map((f) => ({ ...f, reportCode: "R", sessionDate: "2026-09-29" }));
  check(
    "複数日分が 1 本のレポートでも、夜の分は 60 分だけ",
    summarizeWeek(oneReport, W, floors, false, "ja").logMs,
    (23 + 60 + 37) * 60000,
  );
  // 同じ夜を 2 人がログに取った (同じ pull が 2 本のレポートに入る)。戦闘時間を
  // 単純に足すと「ログ合計」より「うち戦闘」が長くなって文面が矛盾する。
  const twice = [...savage, ...savage.map((f) => ({ ...f, reportCode: `${f.reportCode}-2` }))];
  const sTwice = summarizeWeek(twice, W, floors, false, "ja");
  check(
    "同じ夜のログが 2 本でも戦闘とログ合計は 1 本分 (うち戦闘 ≤ ログ合計)",
    [sTwice.fightMs, sTwice.logMs, sTwice.fightMs <= sTwice.logMs],
    [1500000, 3600000, true],
  );
  // 2026-10-07 C-3: pull・討伐・練習日も 1 回だけ数える (練習ログの画面と同じ)。
  check(
    "同じ夜のログが 2 本でも pull・討伐・練習日は 1 本分",
    [sTwice.days, sTwice.pulls, sTwice.clears, sTwice.flawlessClears, sTwice.firstClearDate],
    [s1.days, s1.pulls, s1.clears, s1.flawlessClears, s1.firstClearDate],
  );
  check("最高到達は最も深い層で見る", s1.best, r(4, 0, true));
  check("前の週まで", s1.bestBefore, r(2, 0, true));
  check("更新した", s1.improved, true);
  check("討伐は最終層だけ数える (3 層の討伐は数えない)", [s1.clears, s1.flawlessClears], [1, 1]);
  check("初討伐の日", s1.firstClearDate, "2026-10-01");
  check("初突破は最終層を除く・週の中だけ", s1.milestones, [{ label: "3層", date: "2026-09-29" }]);
  check(
    "文面",
    formatWeeklySummaryMessage({ categoryName: "天獄編零式", summary: s1, floors, phaseModel: false, url: "https://example.com/category/x/logs" }),
    [
      "📅 **週のまとめ** 9/29(火)〜10/5(月)",
      "**天獄編零式** — 練習 2 日 / 5 pull / ログ合計 1時間0分 (うち戦闘 25分)",
      "・最高到達: 4層 CLEAR (前の週までの 2層 CLEAR から更新)",
      "・初突破: 3層 (9/29(火))",
      "・🏆 初討伐 (10/1(木))",
      "・討伐 1 回 (ノーデス 1 回)",
      "https://example.com/category/x/logs",
    ].join("\n"),
  );
  check("その週に pull が無ければ送らない", summarizeWeek(savage, { start: "2026-09-08", end: "2026-09-14" }, floors, false, "ja"), null);
  // 2026-10-05: 日程の Logs から付いたレポートは session_date が rawDate の形
  // (`2026/09/29(火) 21:30~0:00`) で入っていた。fightDate がそろえるので週に入る。
  const rawShaped = savage.map((f) => ({
    ...f,
    sessionDate: f.sessionDate.replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$1/$2/$3(曜) 21:30~0:00"),
  }));
  const sRaw = summarizeWeek(rawShaped, W, floors, false, "ja");
  check("日付が rawDate の形でも週に入る (同じ集計になる)", [sRaw?.days, sRaw?.pulls, sRaw?.firstClearDate], [2, 5, "2026-10-01"]);

  console.log("\n消化の時期 (前の週までに討伐済み)");
  const farm = [
    ...savage.slice(0, 3),
    fight({ date: "2026-09-23", at: "22:00", sec: 420, enc: 104, kill: true, deaths: 1 }),
    fight({ date: "2026-09-23", at: "21:00", sec: 300, enc: 103, kill: true }),
    fight({ date: "2026-09-30", at: "22:00", sec: 400, enc: 104, kill: true, deaths: 0 }),
    fight({ date: "2026-09-30", at: "22:20", sec: 410, enc: 104, kill: true, deaths: 2 }),
    // 死亡数が取れていない討伐はノーデスに数えない
    fight({ date: "2026-10-02", at: "22:00", sec: 400, enc: 104, kill: true, deaths: null }),
  ];
  const floorsFarm = prog.buildFloorMap(farm, 4, "ja");
  const s2 = summarizeWeek(farm, W, floorsFarm, false, "ja");
  check("初討伐ではない", [s2.clearedBefore, s2.firstClearDate], [true, null]);
  const farmText = formatWeeklySummaryMessage({ categoryName: "X", summary: s2, floors: floorsFarm, phaseModel: false });
  check("到達の行を出さない", farmText.includes("最高到達"), false);
  check("討伐の回数とノーデス (死亡数が無い討伐は数えない)", farmText.split("\n").at(-1), "・討伐 3 回 (ノーデス 1 回)");

  console.log("\n絶の週");
  const ult = [
    fight({ date: "2026-09-22", at: "22:00", sec: 300, enc: 1000, phase: 2, pct: 70 }),
    fight({ date: "2026-09-22", at: "22:10", sec: 400, enc: 1000, phase: 3, pct: 40 }),
    fight({ date: "2026-09-30", at: "22:00", sec: 500, enc: 1000, phase: 4, pct: 55 }),
    fight({ date: "2026-09-30", at: "22:15", sec: 600, enc: 1000, phase: 5, pct: 23.4 }),
    fight({ date: "2026-09-30", at: "22:30", sec: 600, enc: 1000, phase: 5, pct: 30 }),
  ];
  const s3 = summarizeWeek(ult, W, null, true, "ja");
  check("最高到達は最深フェーズの中の最小", s3.best, r(5, 23.4));
  // 浅いフェーズの方が残 HP% が低くても、最深フェーズの値を採る
  check(
    "浅いフェーズの低い残 HP% を混ぜない",
    bestReach([fight({ date: "2026-09-30", at: "22:00", sec: 60, enc: 1000, phase: 4, pct: 10 }), ult[3]], null, true),
    r(5, 23.4),
  );
  check(
    "下の層の討伐を最深層の討伐と見ない",
    bestReach([savage[4], savage[5]], floors, false),
    r(4, 40),
  );
  check(
    "文面",
    formatWeeklySummaryMessage({ categoryName: "絶オメガ", summary: s3, floors: null, phaseModel: true }),
    [
      "📅 **週のまとめ** 9/29(火)〜10/5(月)",
      "**絶オメガ** — 練習 1 日 / 3 pull / ログ合計 40分 (うち戦闘 28分)",
      "・最高到達: P5 残23.4% (前の週までの P3 残40.0% から更新)",
      "・初到達: P4 (9/30(水)) / P5 (9/30(水))",
    ].join("\n"),
  );
  const ultFlat = [
    fight({ date: "2026-09-22", at: "22:00", sec: 300, enc: 1000, phase: 5, pct: 20 }),
    fight({ date: "2026-09-30", at: "22:00", sec: 300, enc: 1000, phase: 5, pct: 25 }),
  ];
  const s4 = summarizeWeek(ultFlat, W, null, true, "ja");
  check("更新していなければ「更新」と書かない", [s4.improved, formatWeeklySummaryMessage({ categoryName: "X", summary: s4, floors: null, phaseModel: true }).split("\n")[2]], [false, "・最高到達: P5 残25.0%"]);
  const s5 = summarizeWeek(ult.slice(2), W, null, true, "ja");
  check("前の週までが無ければ比べない", [s5.bestBefore, s5.improved], [null, false]);
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

console.log("\n配線");
const server = read("src/lib/server/logs-weekly-summary.ts");
const run = fnBody(server, "runWeeklyLogsSummary");
const order = (...needles) => {
  const idx = needles.map((n) => run.indexOf(n));
  return idx.every((i) => i >= 0) && idx.every((v, i) => i === 0 || idx[i - 1] < v);
};
check("既定 OFF (ON のときだけ)", /if \(!parseLogsNotifyEnabled\(settings\.get\(logsNotifyKey\("weeklySummary"\)\)\)\) \{\s*return \{ sent: false, skipped: "disabled" \};/.test(run), true);
check("送ってよい日 → 送った週か → チャンネル → 印を取る → 投稿 の順", order("isWeeklySummaryDue(today)", "=== week.start", '"no-channel"', "claimMarker(weeklyMarkerOps(db, week.start))", "postToDiscord("), true);
check("印は送った週の開始日", /WEEKLY_SUMMARY_LAST_SENT_KEY = "logs_weekly_summary_last_week"/.test(server), true);
check("メンションを飛ばさない", /allowed_mentions: \{ parse: \[\] \}/.test(server), true);
const preview = fnBody(server, "previewWeeklyLogsSummary");
check("プレビューは印も投稿も触らない", preview.length > 0 && !/claimMarker|postToDiscord|update\(|upsert\(/.test(preview), true);
check("ログ合計のためにログの開始を読む (読まないと最初の pull から数えて短くなる)", /const FIGHT_COLUMNS =\s*"[^"]*\breport_start_ms\b[^"]*";/.test(server) && /reportStartMs: numberOrNull\(r\.report_start_ms\),/.test(server), true);
check("層 / フェーズの決め方は練習ログの画面と同じ", /buildFloorMap\(fights, resolveFloorCount\(model, category\.name\), "ja"\)/.test(server) && /filterToFloorCluster\(fights, floors\)/.test(server), true);
const route = read("src/app/api/cron/fflogs-sync/route.ts");
check("cron: 取り込みが最後まで済んだ回だけ", /const syncComplete = fights\.ok && !fights\.truncated && !result\.truncated;\s*const weeklySummary = syncComplete\s*\?\s*await runWeeklyLogsSummary/.test(route), true);
check("cron: maxDuration の手前で新しい処理を止める", /routeStartMs \+ FFLOGS_SYNC_ROUTE_MAX_DURATION_SEC \* 1000 - WEEKLY_SUMMARY_TAIL_MS/.test(route), true);
const notify = read("src/lib/server/logs-notify.ts");
check("同期ごとの通知は週のまとめの ON/OFF を見ない", /LOGS_EVENT_KINDS\.map\(logsNotifyKey\)/.test(notify) && !/LOGS_NOTIFY_KINDS/.test(notify), true);
const actions = read("src/lib/server/logs-notify-actions.ts");
check("プレビューは admin だけ", /assertAdminResult\(\)/.test(fnBody(actions, "previewWeeklyLogsSummaryAction")), true);

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
