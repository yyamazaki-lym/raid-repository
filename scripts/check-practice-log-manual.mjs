/**
 * 練習ログの手動の記録とログが欠けている日 (2026-11-08) の検査。
 * 実行: `node scripts/check-practice-log-manual.mjs`
 *
 *   1. 入力の検証 (`validateManualDayInput`): client の値なので型から疑う
 *   2. 集計への足し込み: `summarize` (日数・pull・討伐・到達・初クリアの日)、
 *      `pullBreakdown` (層・フェーズの内訳と「不明」)、`progressTimeline` の印、
 *      絞り込み (`filterManualToSegment`)、週のまとめ (`summarizeWeek`)
 *   3. 節目への日単位の重ね合わせ (`practice-log-manual-merge.ts`)
 *   4. 欠けている日 (`missingPracticeDays`): 範囲・どこにも無い日だけ・今日を除く
 *   5. 配線: Action は admin を確かめてから書く / 表は RLS の汎用ループに載る /
 *      GRANT の明示 / スパークラインの SQL に足してある / ページが読む
 *
 * ⚠ スパークラインの SQL (`category_progress_by_day`) が TS の `summarize` と
 * 同じ値を返すことは、PR のレビューで PGlite に流して突き合わせた (CI には
 * PGlite が無い)。ここでは足し込みの形だけ見る。
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

const outDir = mkdtempSync(join(tmpdir(), "practice-log-manual-check-"));
try {
  execFileSync(
    process.execPath,
    [
      "node_modules/typescript/bin/tsc",
      "src/lib/practice-log-manual-merge.ts",
      "src/lib/logs-weekly-summary.ts",
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
  const load = (name) => import(pathToFileURL(join(outDir, `${name}.js`)).href);
  const man = await load("practice-log-manual");
  const prog = await load("fflogs-progress");
  const merge = await load("practice-log-manual-merge");
  const ws = await load("logs-weekly-summary");

  // ---- 1. 入力の検証 --------------------------------------------------------
  console.log("1. 入力の検証");
  {
    const today = "2026-11-08";
    const ok = { date: "2026-11-05", segments: [{ encounterId: 101, phase: null, pulls: 10, kills: 1, bestPercentage: null }], logMinutes: 150, note: " ACT が落ちた " };
    const v = man.validateManualDayInput(ok, today);
    check("正しい入力は通り、メモは前後の空白を落とす", v.ok && v.value.note, "ACT が落ちた");
    const err = (patch) => {
      const r = man.validateManualDayInput({ ...ok, ...patch }, today);
      return r.ok ? "ok" : r.error;
    };
    const seg = (s) => ({ segments: [{ ...ok.segments[0], ...s }] });
    check("日付の形", err({ date: "2026/11/05" }), "date");
    check("暦に無い日", err({ date: "2026-02-30" }), "date");
    check("今日より後", err({ date: "2026-11-09" }), "future");
    check("今日は記録できる", err({ date: "2026-11-08" }), "ok");
    check("区間が 0 個", err({ segments: [] }), "segments");
    check("区間が 13 個", err({ segments: Array.from({ length: 13 }, (_, i) => ({ encounterId: 100 + i, phase: null, pulls: 1, kills: 0, bestPercentage: null })) }), "segments");
    check("区間が配列でない", err({ segments: "x" }), "segments");
    check("pull 0", err(seg({ pulls: 0 })), "pulls");
    check("pull 501", err(seg({ pulls: 501 })), "pulls");
    check("pull が小数", err(seg({ pulls: 1.5 })), "pulls");
    check("pull が文字列", err(seg({ pulls: "3" })), "pulls");
    check("討伐が pull を超える", err(seg({ kills: 11 })), "kills");
    check("討伐が負", err(seg({ kills: -1 })), "kills");
    check("残% が 100 超", err(seg({ bestPercentage: 101 })), "percentage");
    check("残% が NaN", err(seg({ bestPercentage: Number.NaN })), "percentage");
    check("層とフェーズの両方", err(seg({ encounterId: 101, phase: 2 })), "segmentKey");
    check("フェーズが 21", err(seg({ encounterId: null, phase: 21 })), "segmentKey");
    check("同じ層が 2 行", err({ segments: [ok.segments[0], ok.segments[0]] }), "duplicateSegment");
    check("「不明」も 2 行は不可", err({ segments: [{ encounterId: null, phase: null, pulls: 1, kills: 0, bestPercentage: null }, { encounterId: null, phase: null, pulls: 2, kills: 0, bestPercentage: null }] }), "duplicateSegment");
    check("練習時間 1441", err({ logMinutes: 1441 }), "minutes");
    check("練習時間が文字列", err({ logMinutes: "90" }), "minutes");
    check("練習時間 0 は null", man.validateManualDayInput({ ...ok, logMinutes: 0 }, today).value.logMinutes, null);
    check("メモ 201 文字", err({ note: "あ".repeat(201) }), "note");
    check("メモに改行", err({ note: "a\nb" }), "note");
    check("空のメモは null", man.validateManualDayInput({ ...ok, note: "  " }, today).value.note, null);
    check("残% は小数第 2 位まで", man.validateManualDayInput(seg({ bestPercentage: 12.345 }) && { ...ok, ...seg({ bestPercentage: 12.345 }) }, today).value.segments[0].bestPercentage, 12.35);
    // DB の形 ↔ 型
    const stored = man.toStoredSegments(v.value.segments);
    check("DB の形へ", stored, [{ encounter: 101, phase: null, pulls: 10, kills: 1, best: null }]);
    check("DB の形から戻す", man.parseManualSegments(stored), v.value.segments);
    check(
      "壊れた要素は読まない",
      man.parseManualSegments([{ pulls: "x" }, "s", null, { pulls: 2, kills: 3 }, { pulls: 2, best: 150 }]),
      [{ encounterId: null, phase: null, pulls: 2, kills: 0, bestPercentage: null }],
    );
    check("配列でなければ空", man.parseManualSegments({}), []);
  }

  // ---- 2. 集計への足し込み --------------------------------------------------
  console.log("2. 集計への足し込み");
  const fight = (o) => ({
    reportCode: o.code ?? "R1", fightId: o.id, sessionDate: o.date, name: null,
    kill: o.kill ?? false, fightPercentage: o.pct ?? null, lastPhase: o.phase ?? null,
    encounterId: o.enc ?? null, difficulty: null, partyDps: null, deaths: o.deaths ?? null,
    wipe: null, phases: null, startMs: Date.parse(`${o.date}T${o.at ?? "21:00"}:00+09:00`) + o.id * 1000,
    endMs: Date.parse(`${o.date}T${o.at ?? "21:00"}:00+09:00`) + o.id * 1000 + (o.sec ?? 300) * 1000,
    reportStartMs: null,
  });
  const md = (id, date, segments, logMinutes = null) => ({
    id, date, logMinutes, note: null,
    segments: segments.map(([encounterId, phase, pulls, kills, bestPercentage]) => ({ encounterId, phase, pulls, kills, bestPercentage })),
  });
  {
    // 零式: 101..104 (4 層)。
    const savage = [
      fight({ id: 1, date: "2026-10-01", enc: 101, kill: true }),
      fight({ id: 2, date: "2026-10-01", enc: 102, pct: 40 }),
      fight({ id: 3, date: "2026-10-02", enc: 103, pct: 30 }),
      fight({ id: 4, date: "2026-10-02", enc: 104, pct: 80 }),
    ];
    const floors = prog.buildFloorMap(savage, 4);
    const manual = [
      md("m1", "2026-10-03", [[104, null, 6, 0, 20], [103, null, 2, 2, null]], 120), // 手動だけの日
      md("m2", "2026-10-02", [[104, null, 3, 0, 55], [null, null, 4, 0, null]]), // ログのある日に足す
      md("m3", "2026-10-05", [[104, null, 5, 1, 9]]), // 手動の日に最終層の初討伐
    ];
    const s = prog.summarize(savage, floors, false, undefined, manual);
    const day = (d) => s.days.find((x) => x.date === d);
    check("総 pull = ログ 4 + 手動 20", s.totalPulls, 24);
    check("クリアは最終層の討伐だけ (手動の 1)", s.totalClears, 1);
    check("練習日 4 日 (手動だけの日を含む)", s.days.map((d) => d.date), ["2026-10-05", "2026-10-03", "2026-10-02", "2026-10-01"]);
    check("ログのある日: pull はログ 2 + 手動 7", day("2026-10-02").pulls, 9);
    check("ログのある日: 戦闘時間はログだけ", day("2026-10-02").fightSeconds, 600);
    check("ログのある日: 残% は最深層の中の最小 (手動 55 とログ 80)", day("2026-10-02").bestPercentage, 55);
    check("ログのある日: 手動の pull 数", day("2026-10-02").manualPulls, 7);
    check("手動だけの日: 層 3 の討伐 2 は kills に入りクリアではない", [day("2026-10-03").kills, day("2026-10-03").clears], [2, 0]);
    check("手動だけの日: 最深層 4 の残 20%", [day("2026-10-03").bestFloor, day("2026-10-03").bestPercentage], [4, 20]);
    check("手動だけの日: fights は空・manual を持つ", [day("2026-10-03").fights.length, day("2026-10-03").manual?.id], [0, "m1"]);
    check("初クリアの日は手動の記録の日", s.firstClearDate, "2026-10-05");
    check("firstKill はログの pull だけ (無い)", s.firstKill, null);
    const s0 = prog.summarize(savage, floors, false);
    check("手動の記録が無ければ従来どおり", [s0.totalPulls, s0.days.length, s0.firstClearDate], [4, 2, null]);
    const tl = prog.progressTimeline(s.days, floors, null);
    check("推移: 手動の日に印", tl.map((p) => `${p.date}:${p.manual}`), ["2026-10-01:false", "2026-10-02:true", "2026-10-03:true", "2026-10-05:true"]);
    check("推移: 手動の日の初討伐が記録 (旗)", tl.find((p) => p.date === "2026-10-05").isFirstClear, true);
    const bd = prog.pullBreakdown(savage, floors, false, "ja", manual);
    check("内訳: 層ごとに手動を足し、層の分からない分は「不明」", bd.map((b) => `${b.label}:${b.count}`), ["1層:1", "2層:1", "3層:3", "4層:15", "不明:4"]);
    // 絞り込み
    const only4 = prog.filterManualToSegment(manual, floors, false, 4);
    check("絞り込み: 4 層の区間だけ残る", only4.map((d) => `${d.date}:${d.segments.length}`), ["2026-10-03:1", "2026-10-02:1", "2026-10-05:1"]);
    check("絞り込み: 区間が残らない日は落ちる", prog.filterManualToSegment(manual, floors, false, 1).length, 0);
    // 絶
    const ult = [
      fight({ id: 1, date: "2026-10-01", enc: 1000, phase: 2, pct: 40 }),
      fight({ id: 2, date: "2026-10-01", enc: 1000, phase: 3, pct: 70 }),
    ];
    const um = [md("u1", "2026-10-02", [[null, 4, 5, 0, 33], [null, 3, 2, 0, 10], [null, null, 1, 0, null]])];
    const us = prog.summarize(ult, null, true, undefined, um);
    check("絶: 最深フェーズは手動の P4、残% は P4 の中", [us.bestPhase, us.bestPercentage], [4, 33]);
    check("絶: 内訳は P ごと、フェーズ不明は「不明」", prog.pullBreakdown(ult, null, true, "ja", um).map((b) => `${b.label}:${b.count}`), ["P2:1", "P3:3", "P4:5", "不明:1"]);
    const uk = [md("u2", "2026-10-03", [[null, 5, 4, 1, null]])];
    check("絶: 手動の討伐は「討伐」の内訳とクリア", [prog.pullBreakdown(ult, null, true, "ja", uk).map((b) => `${b.label}:${b.count}`), prog.summarize(ult, null, true, undefined, uk).totalClears], [["P2:1", "P3:1", "P5:3", "討伐:1"], 1]);

    // 週のまとめ
    const W = { start: "2026-09-29", end: "2026-10-05" };
    const w = ws.summarizeWeek(savage, W, floors, false, "ja", manual);
    check("週: 日数・pull に手動を足す", [w.days, w.pulls], [4, 24]);
    check("週: ログ合計に練習時間を足す (120 分)", w.logMs - ws.summarizeWeek(savage, W, floors, false, "ja").logMs, 120 * 60000);
    check("週: 討伐数と初討伐の日", [w.clears, w.firstClearDate], [1, "2026-10-05"]);
    check("週: 最高到達は 4 層の討伐", w.best, { segment: 4, percentage: 0, cleared: true });
    check("週: 初突破に手動の日の 3 層", w.milestones, [{ label: "1層", date: "2026-10-01" }, { label: "3層", date: "2026-10-03" }]);
    const onlyManualWeek = ws.summarizeWeek([], { start: "2026-10-06", end: "2026-10-12" }, floors, false, "ja", [md("x", "2026-10-07", [[104, null, 3, 0, 5]], 60)]);
    check("週: 手動の記録だけの週も送る", onlyManualWeek && [onlyManualWeek.days, onlyManualWeek.pulls, onlyManualWeek.logMs], [1, 3, 3600000]);
    check("週: 週より後の手動の記録は見ない", ws.summarizeWeek(savage, W, floors, false, "ja", [md("z", "2026-10-07", [[104, null, 3, 0, 5]])]).pulls, 4);
    const uw = ws.summarizeWeek(ult, W, null, true, "ja", um);
    check("週 (絶): 手動の日に着いた P4 を初到達に", uw.milestones, [{ label: "P2", date: "2026-10-01" }, { label: "P3", date: "2026-10-01" }, { label: "P4", date: "2026-10-02" }]);

    // ---- 3. 節目への重ね合わせ -------------------------------------------
    console.log("3. 節目への重ね合わせ");
    const loggedBadges = [{ kind: "firstClear", value: null, date: "2026-10-10" }, { kind: "fastestClear", value: 600, date: "2026-10-10" }];
    check(
      "バッジ: 手動の討伐が先なら初討伐はその日、回数は合計",
      merge.mergeManualBadges(loggedBadges, manual, floors),
      [{ kind: "firstClear", value: null, date: "2026-10-05" }, { kind: "fastestClear", value: 600, date: "2026-10-10" }, { kind: "clears", value: 2, date: "2026-10-10" }],
    );
    check("バッジ: 手動の討伐が無ければそのまま", merge.mergeManualBadges(loggedBadges, [manual[1]], floors), loggedBadges);
    check("バッジ: ログに討伐が無くても手動の討伐で初討伐", merge.mergeManualBadges([], manual, floors), [{ kind: "firstClear", value: null, date: "2026-10-05" }]);
    // 2026-11-09 (レビューで検出): バッジの日 (session_date そのもの) が null の古い
    // ログでも、ログの練習日で比べる (以前は null を「手動が早い」としていた)。
    const nullDated = [{ kind: "firstClear", value: null, date: null }];
    check(
      "バッジ: ログの日が null でもログの練習日で比べる (ログが先ならログの日)",
      merge.mergeManualBadges(nullDated, manual, floors, { first: "2026-09-01", last: "2026-09-01" }),
      [{ kind: "firstClear", value: null, date: "2026-09-01" }, { kind: "clears", value: 2, date: "2026-10-05" }],
    );
    check(
      "バッジ: 手動の日が先なら手動の日 (ログの練習日と比べて)",
      merge.mergeManualBadges(nullDated, manual, floors, { first: "2026-11-01", last: "2026-11-02" }),
      [{ kind: "firstClear", value: null, date: "2026-10-05" }, { kind: "clears", value: 2, date: "2026-11-02" }],
    );
    const fcIn = savage.map((f) => ({ startMs: f.startMs, endMs: f.endMs, kill: f.kill, floorIndex: floors.byEncounter.get(f.encounterId), sessionDate: f.sessionDate }));
    const fc = merge.floorFirstClearsWithManual(fcIn, manual, floors);
    check("初討伐: 1 層はログのまま (手動の pull は前に無い)", fc.find((c) => c.index === 1).manual, null);
    const f3 = fc.find((c) => c.index === 3);
    check("初討伐: 3 層は手動の日 (pull = 前のログ 1 + その日の手動 2、通算 = 前のログ 4 + 手動 15、時間はログだけ)", [f3.date, f3.pulls, f3.overallPulls, f3.ms, f3.manual], ["2026-10-03", 3, 4 + 7 + 8, 300000, "first"]);
    const f4 = fc.find((c) => c.index === 4);
    check("初討伐: 4 層は手動の日 10/05", [f4.date, f4.pulls, f4.manual], ["2026-10-05", 1 + 3 + 6 + 5, "first"]);
    check("初討伐: 手動の記録が無ければ印なし", merge.floorFirstClearsWithManual(fcIn, [], floors).every((c) => c.manual === null), true);
    // ログの初討伐が先で、それより前の手動の pull を足す
    const later = [fight({ id: 9, date: "2026-10-20", enc: 104, kill: true })];
    const fcIn2 = [...fcIn, ...later.map((f) => ({ startMs: f.startMs, endMs: f.endMs, kill: f.kill, floorIndex: 4, sessionDate: f.sessionDate }))];
    const f4b = merge.floorFirstClearsWithManual(fcIn2, [manual[0], manual[1]], floors).find((c) => c.index === 4);
    check("初討伐: ログが先なら日はそのまま、前の手動の pull を足して partial", [f4b.date, f4b.pulls, f4b.manual], ["2026-10-20", 2 + 6 + 3, "partial"]);
    const reaches = [{ id: 2, ms: 300000, pulls: 1, date: "2026-10-01" }, { id: 3, ms: 600000, pulls: 2, date: "2026-10-01" }];
    const pr = merge.phaseFirstReachesWithManual(reaches, ult.map((f) => ({ durationMs: f.endMs - f.startMs, date: f.sessionDate })), um);
    check("初到達: ログの P2・P3 はそのまま、手動の P4 を足す", pr.map((r) => `P${r.id}:${r.date}:${r.pulls}:${r.manual}`), ["P2:2026-10-01:1:null", "P3:2026-10-01:2:null", "P4:2026-10-02:10:first"]);
  }

  // ---- 4. 欠けている日 ------------------------------------------------------
  console.log("4. 欠けている日");
  {
    const held = (date, label = date) => ({ date, label });
    const heldDays = [
      held("2026-09-30"), // このコンテンツの最初の練習日より前
      held("2026-10-01"), held("2026-10-02"), held("2026-10-03"), held("2026-10-04"),
      held("2026-10-05", "A"), held("2026-10-05", "B"), // 同じ日に 2 つの開催
      held("2026-10-08"), // 今日
    ];
    const practice = [
      { categoryId: "c1", date: "2026-10-01" },
      { categoryId: "c2", date: "2026-10-02" }, // 別のコンテンツの日
      { categoryId: null, date: "2026-10-03" }, // カテゴリの無いログ
      { categoryId: "c1", date: "2026-10-04" },
    ];
    const r = man.missingPracticeDays({ categoryId: "c1", heldDays, practiceDays: practice, today: "2026-10-08" });
    check("範囲は最初の練習日から今日の前日まで (後に別のコンテンツが無い)", [r.from, r.to], ["2026-10-01", "2026-10-08"]);
    check("どこにもログの無い開催日だけ・同じ日は 1 行・今日は除く", r.days, [{ date: "2026-10-05", label: "A / B" }]);
    const moved = man.missingPracticeDays({ categoryId: "c1", heldDays, practiceDays: [...practice, { categoryId: "c2", date: "2026-10-06" }], today: "2026-10-08" });
    check("別のコンテンツに移ったら最後の練習日まで", [moved.to, moved.days], ["2026-10-04", []]);
    check("このコンテンツに練習が無ければ何も出さない", man.missingPracticeDays({ categoryId: "c9", heldDays, practiceDays: practice, today: "2026-10-08" }), { from: null, to: null, days: [] });
    // 2026-11-08: 「中止だった」が日程を引く JST の 1 日 (UTC で前日 15:00 から)。
    check("JST の 1 日の範囲", man.jstDayRangeIso("2026-09-10"), { from: "2026-09-09T15:00:00.000Z", to: "2026-09-10T15:00:00.000Z" });
    check("月末の次の日は翌月に繰り上げる", man.jstDayRangeIso("2026-09-30").to, "2026-09-30T15:00:00.000Z");
    check("年末", man.jstDayRangeIso("2026-12-31"), { from: "2026-12-30T15:00:00.000Z", to: "2026-12-31T15:00:00.000Z" });
    check("暦に無い日は null", man.jstDayRangeIso("2026-02-30"), null);
    check("形の違う日付は null (.or() に入れる前の検査)", man.jstDayRangeIso("2026-09-10,id.gt.0"), null);
    // 2026-11-09: ページで読み切る (1000 行の上限)。
    const pager = (total) => {
      const calls = [];
      const fetchPage = async (from, to) => {
        calls.push([from, to]);
        const n = Math.max(0, Math.min(to, total - 1) - from + 1);
        return { rows: Array.from({ length: n }, (_, i) => from + i), error: null };
      };
      return { calls, fetchPage };
    };
    {
      const p = pager(2500);
      const r = await man.readAllPages(p.fetchPage);
      check("ページ: 2500 行を 3 回で読み切る", [r.rows.length, r.rows[2499], p.calls, r.truncated], [2500, 2499, [[0, 999], [1000, 1999], [2000, 2999]], false]);
      const p2 = pager(1000);
      const r2 = await man.readAllPages(p2.fetchPage);
      check("ページ: ちょうど 1000 行なら空のページを確かめて終える", [r2.rows.length, p2.calls.length, r2.truncated], [1000, 2, false]);
      const p3 = pager(5000);
      const r3 = await man.readAllPages(p3.fetchPage, 3);
      check("ページ: 上限のページ数で終わらなければ truncated", [r3.rows.length, r3.truncated], [3000, true]);
      const r4 = await man.readAllPages(async (from) => (from === 0 ? { rows: Array(1000).fill(0), error: null } : { rows: null, error: "boom" }));
      check("ページ: 途中の失敗は error で返す", [r4.error, r4.truncated], ["boom", false]);
    }
  }

  // ---- 5. 配線 --------------------------------------------------------------
  console.log("5. 配線");
  {
    const action = read("src/lib/server/practice-log-manual-actions.ts");
    const fnBody = (name) => {
      const s = action.indexOf(`export async function ${name}(`);
      const e = action.indexOf("\n}\n", s);
      return s < 0 ? "" : action.slice(s, e);
    };
    for (const name of ["saveManualPracticeDayAction", "deleteManualPracticeDayAction"]) {
      const body = fnBody(name);
      const gate = body.indexOf("assertAdminResult()");
      const write = body.search(/\.from\("practice_log_manual_days"\)/);
      check(`${name}: admin を確かめてから書く`, gate >= 0 && write > gate, true);
    }
    check("保存は検証を通す", /validateManualDayInput\(/.test(fnBody("saveManualPracticeDayAction")), true);
    check("更新・削除は同じコンテンツの行だけ", (action.match(/\.eq\("category_id", categoryId\)/g) ?? []).length, 2);
    check("削除の 0 行を成功にしない", /\(data \?\? \[\]\)\.length === 0/.test(fnBody("deleteManualPracticeDayAction")), true);
    // 2026-11-08: 欠けている日を「中止だった」にする。
    {
      const body = fnBody("cancelMissingPracticeDayAction");
      const gate = body.indexOf("assertAdminResult()");
      const practiced = body.indexOf("if (practiced)");
      const writes = [...body.matchAll(/\.update\(/g)].map((x) => x.index);
      check("中止: admin を確かめ、練習した日でないことを確かめてから書く", gate >= 0 && practiced > gate && writes.length === 2 && writes.every((i) => i > practiced), true);
      // 2026-11-09 (レビューで検出): ログはその日だけを直接引く。practice_log_days
      // (その日以降の全部) を読むと 1000 行の上限で対象の日が抜けた。
      check(
        "中止: ログはその日だけを引く (session_date、無ければ開始の JST 暦日)",
        /\.from\("fflogs_fights"\)[\s\S]{0,60}\.or\(\s*`session_date\.eq\.\$\{date\},and\(session_date\.is\.null,start_ms\.gte\.\$\{fromMs\},start_ms\.lt\.\$\{toMs\}\)`,?\s*\)\s*\.limit\(1\)/.test(body) &&
          !/rpc\("practice_log_days"/.test(body),
        true,
      );
      check("中止: 手動の記録もその日を見る", /\.from\("practice_log_manual_days"\)[\s\S]{0,80}\.eq\("session_date", date\)/.test(body), true);
      // 読んだ結果が両方とも「練習した日」の判定に入っていること (変異テストで検出)。
      check(
        "中止: 練習した日の判定 = その日のログ OR 手動の記録",
        /const practiced = \(logRes\.data \?\? \[\]\)\.length > 0 \|\| \(manualRes\.data \?\? \[\]\)\.length > 0;/.test(body),
        true,
      );
      check("中止: 今日以降は中止にしない", /if \(date >= jstYmdString\(new Date\(\)\)\)/.test(body), true);
      check("中止 (自前作成式): 確定・有志練習でない日程だけを、その日の範囲で", /\.update\(\{ status: "CANCELLED" \}\)\s*\.eq\("status", "DECISION"\)\s*\.eq\("is_optional", false\)\s*\.gte\("parsed_date", range\.from\)\s*\.lt\("parsed_date", range\.to\)/.test(body), true);
      check("中止 (同期式): 除外していない過去の日程だけに印を付ける (行は消さない)", /\.update\(\{ excluded_at: [^}]+\}\)\s*\.is\("excluded_at", null\)\s*\.gte\("parsed_date", range\.from\)\s*\.lt\("parsed_date", range\.to\)/.test(body) && !/\.delete\(/.test(body), true);
      check("中止: 0 件を成功にしない", (body.match(/if \(n === 0\)/g) ?? []).length, 2);
      const card = read("src/components/portal/logs/missing-days-card.tsx");
      check("カード: 「中止だった」は onCancel を渡したとき (admin) だけ", /\{onCancel && \(/.test(card), true);
      const viewSrc = read("src/app/(portal)/category/[slug]/logs/logs-view.tsx");
      check("画面: 中止は確認してから・admin だけに渡す", /const ok = await confirm\(\{\s*title: m\.logsMissing\.cancelConfirmTitle/.test(viewSrc) && /onCancel=\{canEdit \?/.test(viewSrc), true);
    }

    const schema = read("supabase/schema.sql");
    const loopAt = schema.indexOf("FOR t IN SELECT unnest(ARRAY[");
    const loop = schema.slice(loopAt, schema.indexOf("]) LOOP", loopAt));
    // ⚠ 直前の要素との間にカンマが要る。抜けると Postgres は隣り合う文字列を 1 つに
    // つなげ (`'a' 'b'` → 'ab')、この表にはポリシーが付かない (変異テストで検出)。
    check(
      "表は 7 章の汎用ループ (読みはメンバー・書きは admin) に載る",
      /'[a-z0-9_]+',\s*(?:--[^\n]*\n\s*)*'practice_log_manual_days'/.test(loop),
      true,
    );
    check("RLS を有効にする", /ALTER TABLE public\.practice_log_manual_days\s+ENABLE ROW LEVEL SECURITY;/.test(schema), true);
    check("本番の anon には権限を配らない", /REVOKE ALL ON public\.practice_log_manual_days FROM anon, authenticated;/.test(schema), true);
    check("anon の読み取りは公開デモの分岐の中だけ", /IF coalesce\(current_setting\('app\.public_demo', true\), ''\) = 'true' THEN\s+GRANT SELECT ON public\.practice_log_manual_days TO anon;/.test(schema), true);
    const spark = schema.slice(schema.indexOf("CREATE OR REPLACE FUNCTION public.category_progress_by_day"), schema.indexOf("REVOKE EXECUTE ON FUNCTION public.category_progress_by_day"));
    check("スパークライン: 手動の記録を読む", spark.includes("FROM public.practice_log_manual_days m"), true);
    check("スパークライン: pull 数は行数ではなく n の和", /SUM\(r\.n\)::integer AS pulls/.test(spark) && !/COUNT\(\*\)::integer AS pulls/.test(spark), true);
    const g15 = schema.slice(schema.indexOf("-- ---- 15."), schema.indexOf("-- ---- 16."));
    check("practice_log_days は重い集計と同じ配り方 (デモは service_role だけ)", g15.includes("'public.practice_log_days(text)'"), true);

    const page = read("src/app/(portal)/category/[slug]/logs/page.tsx");
    check("ページが手動の記録と欠けている日を読む", /fetchCategoryManualDays\(category\.id\)/.test(page) && /fetchMissingPracticeDays\(category\.id\)/.test(page), true);
    const view = read("src/app/(portal)/category/[slug]/logs/logs-view.tsx");
    check("画面: 総 pull・クリア数のタイルに手動を足す", /manualTotals\.pulls;/.test(view) && /\+ manualTotals\.clears/.test(view), true);
    check("画面: 内訳に手動の記録を渡す", /pullBreakdown\(countedFights, floors, showPhase, locale, manualDays\)/.test(view), true);
    // 2026-11-09 (レビューで検出) の直し 3 点。
    check(
      "画面: バッジはログの練習日 (fightDate) と比べる",
      /const loggedClearDates =[\s\S]{0,160}first: fightDate\(clears\[0\]!\), last: fightDate\(clears\[clears\.length - 1\]!\)[\s\S]{0,200}mergeManualBadges\([\s\S]{0,120}loggedClearDates,?\s*\)/.test(view),
      true,
    );
    check(
      "画面: フェーズの絞り込みに手動の記録のフェーズも出す",
      /const phaseChoices = useMemo\([\s\S]{0,500}for \(const d of manualDays\)[\s\S]{0,120}set\.add\(s\.phase\)[\s\S]{0,120}\[showPhase, tierFights, manualDays\]/.test(view),
      true,
    );
    {
      const dialog = read("src/components/portal/logs/manual-day-dialog.tsx");
      check(
        "ダイアログ: 討伐数か残% があって pull が空の行は止める (黙って捨てない)",
        /if \(pulls === null \|\| pulls === 0\) \{\s*if \(\(kills !== null && kills > 0\) \|\| best !== null\) \{\s*toast\.error\(m\.logsManual\.errNoPullsInRow\(labelOf\(r\.key\)\)\);\s*return;\s*\}\s*continue;\s*\}/.test(dialog),
        true,
      );
    }
    check("画面: 手動の記録だけのコンテンツも空の表示にしない", /fights\.length === 0 && manualDays\.length === 0/.test(view), true);
    const weekly = read("src/lib/server/logs-weekly-summary.ts");
    check("週のまとめ: 手動の記録を読んで渡す", /fetchManualDaysWith\(db, category\.id\)/.test(weekly) && /summarizeWeek\([^)]*, manual\)/.test(weekly), true);
    check("週のまとめ: 手動の記録だけの週のコンテンツも探す", /\.from\("practice_log_manual_days"\)[\s\S]{0,120}\.gte\("session_date", week\.start\)/.test(weekly), true);
    const missing = read("src/lib/server/practice-log-missing-days.ts");
    check(
      "欠けている日: 読めない・読み切れないときは null (全部欠けて見せない)",
      /daysRes\.error \|\|\s*daysRes\.truncated \|\|\s*manualRes\.error \|\|\s*manualRes\.truncated \|\|\s*held === null\s*\)[\s\S]{0,300}return null;/.test(missing),
      true,
    );
    // 2026-11-09 (レビューで検出): 1000 行の上限で古い日が抜けないようページで読み切る。
    check(
      "欠けている日: ログのある日と手動の記録はページで読み切る (並び順つき)",
      /readAllPages[^(]*\(\(lo, hi\) =>\s*db\s*\.rpc\("practice_log_days", \{ p_from: from \}\)\s*\.range\(lo, hi\)/.test(missing) &&
        /readAllPages[^(]*\(\(lo, hi\) =>\s*db\s*\.from\("practice_log_manual_days"\)[\s\S]{0,260}\.order\("session_date", \{ ascending: false \}\)\s*\.order\("category_id", \{ ascending: true \}\)\s*\.range\(lo, hi\)/.test(missing),
      true,
    );
    // 関数の並び順がページの境目の前提 (day DESC, category_id で 1 行に決まる)。
    {
      const schemaSrc = read("supabase/schema.sql");
      const fn = schemaSrc.slice(schemaSrc.indexOf("CREATE OR REPLACE FUNCTION public.practice_log_days"));
      check("practice_log_days は (day, category_id) で並べる", /GROUP BY d\.category_id, d\.day\s*ORDER BY d\.day DESC, d\.category_id/.test(fn.slice(0, 1500)), true);
    }
    check("欠けている日: 自前作成式は確定・有志練習でない日", /\.eq\("status", "DECISION"\)/.test(missing) && /is_optional !== true/.test(missing), true);
  }
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
