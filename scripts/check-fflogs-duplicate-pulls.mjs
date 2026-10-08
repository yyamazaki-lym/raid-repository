/**
 * 別のログと同じ pull (2026-10-07、C-3) の検証。
 * 実行: `node scripts/check-fflogs-duplicate-pulls.mjs`
 *
 * ユーザーの選択は「集計だけ 1 本に」— 同じ夜を 2 人が上げたログの同じ pull は
 * 集計で 1 回だけ数え、日の振り返りには両方の行を出して数えない側に印を付ける。
 * ここでは次を固定する:
 *
 *   1. 判定 (`src/lib/fflogs-duplicate-pulls.ts`): 同じ pull とみなす条件 (別の
 *      レポート・同じ encounter・開始と終了が 10 秒以内) と、どちらを数えるか
 *   2. `summarize`: 数・クリア・戦闘時間は 1 回だけ、日の `fights` には両方残す
 *   3. 配線: 画面の集計・日の行・フェーズ滞在時間 (server)・週のまとめ
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

const outDir = mkdtempSync(join(tmpdir(), "duplicate-pulls-check-"));
try {
  execFileSync(
    process.execPath,
    [
      "node_modules/typescript/bin/tsc", "src/lib/fflogs-progress.ts", "src/lib/fflogs-duplicate-pulls.ts",
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
  const dup = await import(pathToFileURL(join(outDir, "fflogs-duplicate-pulls.js")).href);
  const prog = await import(pathToFileURL(join(outDir, "fflogs-progress.js")).href);
  const { duplicatePulls, countedPulls, pullKey, DUPLICATE_PULL_TOLERANCE_MS } = dup;

  // pull を作る (JST の時刻で書く)。
  const base = Date.parse("2026-10-06T22:00:00+09:00");
  const pull = (code, id, minute, sec, o = {}) => ({
    reportCode: code, fightId: id, sessionDate: "2026-10-06", name: null, kill: false,
    fightPercentage: 50, lastPhase: null, encounterId: 104, difficulty: null,
    partyDps: null, deaths: 1, wipe: null, phases: null,
    startMs: base + minute * 60000, endMs: base + minute * 60000 + sec * 1000, reportStartMs: null,
    ...o,
  });
  // 同じ夜を A (4 pull) と B (3 pull、録り始めが遅い) が上げた。B の時計は 3 秒遅れ。
  const A = [pull("A", 1, 0, 200), pull("A", 2, 6, 240), pull("A", 3, 12, 300, { kill: true, deaths: 0, fightPercentage: 0 }), pull("A", 4, 20, 180)];
  const B = A.slice(1).map((f, i) => ({ ...f, reportCode: "B", fightId: 10 + i, startMs: f.startMs + 3000, endMs: f.endMs + 3000 }));
  const both = [...B, ...A];

  console.log("1. 判定");
  check("許容差は 10 秒", DUPLICATE_PULL_TOLERANCE_MS, 10000);
  check("レポートが 1 本なら無い", duplicatePulls(A).size, 0);
  const d = duplicatePulls(both);
  check(
    "pull の多いレポートを数え、もう一方の同じ pull を重ねる",
    [...d.entries()].sort(),
    [["B:10", "A:2"], ["B:11", "A:3"], ["B:12", "A:4"]],
  );
  check("片方にしか無い pull は数える", d.has("A:1"), false);
  check("pull 数が同じならレポートコードの若い方を数える", [...duplicatePulls([...A.slice(1), ...B]).values()].every((k) => k.startsWith("A:")), true);
  const tie = [pull("Z", 1, 0, 200), { ...pull("Y", 1, 0, 200) }];
  check("同数・コード昇順 (Y を数える)", [...duplicatePulls(tie).entries()], [["Z:1", "Y:1"]]);
  const shift = (ms) => [pull("A", 1, 0, 200), { ...pull("B", 1, 0, 200), startMs: base + ms, endMs: base + 200000 + ms }];
  check("時計のずれ 10 秒までは同じ pull", duplicatePulls(shift(10000)).size, 1);
  check("10 秒を超えたら別の pull (二重に数える。これまで通り)", duplicatePulls(shift(10001)).size, 0);
  check("終わりが 10 秒を超えて違えば別の pull", duplicatePulls([pull("A", 1, 0, 200), pull("B", 1, 0, 215)]).size, 0);
  check("encounter が違えば別の pull", duplicatePulls([pull("A", 1, 0, 200), pull("B", 1, 0, 200, { encounterId: 103 })]).size, 0);
  check("encounter が分からない pull は比べない", duplicatePulls([pull("A", 1, 0, 200, { encounterId: null }), pull("B", 1, 0, 200, { encounterId: null })]).size, 0);
  check(
    "同じレポートの中の pull どうしは重ねない",
    duplicatePulls([pull("A", 1, 0, 200), pull("A", 2, 0, 200), pull("B", 1, 30, 100)]).size,
    0,
  );
  // 3 人が上げた: どちらも同じ 1 本を指す。
  const C = B.map((f) => ({ ...f, reportCode: "C", fightId: f.fightId + 100 }));
  const d3 = duplicatePulls([...A, ...B, ...C]);
  check("3 本目のログも同じ 1 本に重ねる", [d3.size, d3.get("C:110"), d3.get("B:10")], [6, "A:2", "A:2"]);
  // レビューで検出: 時計が 0 / +7 / +14 秒とずれた 3 本。C は A と 14 秒離れるが B と 7 秒。
  const at = (code, ms) => ({ ...pull(code, 1, 0, 200), startMs: base + ms, endMs: base + 200000 + ms });
  check("時計のずれが連なっても、重ねた pull を通して同じ 1 本に寄せる", [...duplicatePulls([at("A", 0), at("B", 7000), at("C", 14000)]).entries()].sort(), [["B:1", "A:1"], ["C:1", "A:1"]]);
  check("どの隣とも 10 秒を超えれば別の pull", duplicatePulls([at("A", 0), at("B", 7000), at("C", 18000)]).get("C:1"), undefined);
  // A に無い pull を B と C が持つ → B を数えて C を重ねる。
  const extraB = pull("B", 99, 40, 120);
  const extraC = { ...extraB, reportCode: "C", fightId: 199 };
  const dx = duplicatePulls([...A, ...B, extraB, ...C, extraC]);
  check("数える側に無い pull は次の順位のレポートで数える", [dx.has("B:99"), dx.get("C:199")], [false, "B:99"]);
  check("最も近い pull に重ねる", [...duplicatePulls([pull("A", 1, 0, 200), { ...pull("A", 2, 0, 200), startMs: base + 9000, endMs: base + 209000 }, { ...pull("B", 1, 0, 200), startMs: base + 8000, endMs: base + 208000 }]).entries()], [["B:1", "A:2"]]);
  check("countedPulls は並びを保って数えない側を除く", countedPulls(both).map(pullKey), ["A:1", "A:2", "A:3", "A:4"]);
  check("pullKey", pullKey({ reportCode: "R", fightId: 7 }), "R:7");

  console.log("\n2. summarize");
  const floors = prog.buildFloorMap([101, 102, 103, 104].map((e) => pull("F", e, 0, 1, { encounterId: e })), 4, "ja");
  const s = prog.summarize(both, floors, false);
  const day = s.days[0];
  check("pull 数・クリア数は 1 回だけ", [s.totalPulls, s.totalClears, day.pulls, day.clears], [4, 1, 4, 1]);
  check("日の戦闘時間も 1 回だけ", day.fightSeconds, 200 + 240 + 300 + 180);
  check("日の fights には両方の行を残す (時刻順)", day.fights.map(pullKey), ["A:1", "A:2", "B:10", "A:3", "B:11", "A:4", "B:12"]);
  check("countedFights は数える pull だけ", day.countedFights.map(pullKey), ["A:1", "A:2", "A:3", "A:4"]);
  check("日に印の表を渡す", day.duplicateOf.get("B:11"), "A:3");
  check("最速クリアも 1 本で見る", s.fastestClearSeconds, 300);
  check("表を渡せばそれを使う (絞った pull でも絞る前の印)", prog.summarize(B, floors, false, d).totalPulls, 0);
  // 数える側が別の日 (2 本のレポートで練習日の付き方が違った) → その日は数える pull が 0。
  const otherDay = B.map((f) => ({ ...f, sessionDate: "2026-10-07" }));
  const s2 = prog.summarize([...A, ...otherDay], floors, false);
  check("数える pull が 0 の日も行は出す", s2.days.map((x) => [x.date, x.pulls, x.fights.length]), [["2026-10-07", 0, 3], ["2026-10-06", 4, 4]]);
  check("到達度の推移には数える pull が 0 の日を出さない", prog.progressTimeline(s2.days, floors, null).map((p) => p.date), ["2026-10-06"]);
  check("重複が無ければ従来通り", prog.summarize(A, floors, false).days[0].countedFights.length, 4);

  // 2026-10-07 (C-3 の続き): DB 側 (スパークライン・出席サマリー) も同じ条件で数えない。
  // 実行して TS と同じ結果になることは PGlite で確かめた (PR 本文)。ここでは条件の
  // 書き方がずれていないことを固定する。
  console.log("\n4. DB 側 (schema.sql 13c-2b)");
  const schema = read("supabase/schema.sql");
  const fnAt = schema.indexOf("CREATE OR REPLACE FUNCTION public.fflogs_duplicate_pulls(");
  const fn = fnAt < 0 ? "" : schema.slice(fnAt, schema.indexOf("\n$$;", fnAt));
  const tol = String(DUPLICATE_PULL_TOLERANCE_MS);
  check("関数がある", fnAt >= 0, true);
  check(
    "開始と終了の許容差が TS の定数と同じ",
    [
      fn.includes(`abs(g.start_ms - f.start_ms) <= ${tol}`),
      fn.includes(`abs(g.end_ms - f.end_ms) <= ${tol}`),
      // 桶の幅と、期間の始まりより前に比べる相手を探す幅も同じ値
      fn.includes(`r.start_ms / ${tol} AS bucket`),
      fn.includes(`f.start_ms >= p_from_ms - ${tol}`),
    ],
    [true, true, true, true],
  );
  check(
    "相手のレポートは順位がいちばん上のもの (TS の数える側と同じ順)",
    /SELECT DISTINCT ON \(f\.report_code, f\.fight_id\)/.test(fn) && /ORDER BY f\.report_code, f\.fight_id, g\.n DESC, g\.report_code COLLATE "C"/.test(fn),
    true,
  );
  check(
    "速さ: 桶 (自分と両隣) を列にして結合のキーに入れる (総当たりにしない)",
    /probe AS MATERIALIZED \(/.test(fn) && /AND g\.bucket = f\.probe_bucket/.test(fn),
    true,
  );
  check(
    "同じカテゴリ・同じ encounter・別のレポート",
    // カテゴリは「無いもの同士を同じ組」にした文字列の鍵 (cat) で比べる (出席サマリー用)
    [/ON g\.cat = f\.cat/.test(fn) && /COALESCE\(f\.category_id::text, ''\) AS cat/.test(fn), /g\.encounter_id = f\.encounter_id/.test(fn), /g\.report_code <> f\.report_code/.test(fn), /r\.encounter_id IS NOT NULL/.test(fn)],
    [true, true, true, true],
  );
  check(
    "順位: pull の多いレポート → コードのバイト順 (JS の比較と同じ)",
    /g\.n > f\.n\s*OR \(g\.n = f\.n AND g\.report_code COLLATE "C" < f\.report_code COLLATE "C"\)/.test(fn),
    true,
  );
  const spark = schema.slice(schema.indexOf("CREATE OR REPLACE FUNCTION public.category_progress_by_day("), schema.indexOf("\n$$;", schema.indexOf("CREATE OR REPLACE FUNCTION public.category_progress_by_day(")));
  check("スパークライン: 直近ぶんから数えない pull を除く", /CROSS JOIN LATERAL public\.fflogs_duplicate_pulls\(b\.from_ms\) d/.test(spark) && /AND dp\.report_code IS NULL/.test(spark), true);
  check(
    "関数は 13c-3 より前に定義する (SQL 関数の本文は作るときに検査される)",
    fnAt >= 0 && fnAt < schema.indexOf("CREATE OR REPLACE FUNCTION public.category_progress_by_day("),
    true,
  );
  const grants = schema.slice(schema.indexOf("-- ---- 15. RPC の anon EXECUTE"));
  // 2026-10-08: 重い集計はデモでも anon に配らない (15 章の 2 つ目のループ)。
  // デモの匿名ゲストのスパークラインは service role で計算する (category-progress.ts)。
  const loops = [...grants.matchAll(/FOREACH fn IN ARRAY ARRAY\[([\s\S]*?)\] LOOP([\s\S]*?)END LOOP;/g)].map((m) => ({ fns: m[1], body: m[2] }));
  const heavy = loops.find((l) => l.fns.includes("'public.fflogs_duplicate_pulls(bigint)'"));
  check(
    "権限: スパークラインと同じループで、本番は authenticated と service_role、デモは service_role だけ",
    !!heavy &&
      heavy.fns.includes("'public.category_progress_by_day(integer)'") &&
      /GRANT EXECUTE ON FUNCTION %s TO %s', fn, heavy_roles\);/.test(heavy.body) &&
      !/exec_roles/.test(heavy.body) &&
      /heavy_roles text := CASE\s*WHEN coalesce\(current_setting\('app\.public_demo', true\), ''\) = 'true'\s*THEN 'service_role'\s*ELSE 'authenticated, service_role'\s*END;/.test(grants),
    true,
  );
  check(
    "権限: 並び順の RPC のループ (デモで anon に戻す方) に重い集計が無い",
    loops.filter((l) => /exec_roles/.test(l.body)).every((l) => !/fflogs_duplicate_pulls|category_progress_by_day|practice_seconds_by_category/.test(l.fns)),
    true,
  );
  check("権限: 出席サマリーの service role に配る", /GRANT EXECUTE ON FUNCTION public\.fflogs_duplicate_pulls\(bigint\) TO service_role;/.test(schema), true);
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

console.log("\n3. 配線");
const view = read("src/app/(portal)/category/[slug]/logs/logs-view.tsx");
check("画面: 印の表は tierFights から 1 回作る", /const duplicateOf = useMemo\(\(\) => duplicatePulls\(tierFights\), \[tierFights\]\);/.test(view), true);
check("画面: summarize に印の表を渡す", /summarize\(tierFights, floors, showPhase, duplicateOf\)/.test(view), true);
check("画面: 絞り込みの summarize にも同じ表", /summarize\(kept, floors, showPhase, duplicateOf\)\.days/.test(view), true);
for (const [name, re] of [
  ["バッジ", /teamBadges\(countedFights,/],
  ["内訳", /pullBreakdown\(countedFights,/],
  ["ワイプ原因", /wipeCauseCounts\(countedFights\.map/],
  ["フェーズ滞在 (表示中の分)", /phaseTimeTotals\(countedFights\.map/],
  ["層ごとの初討伐", /floorFirstClears\(\s*countedFights\.flatMap/],
  ["注釈の通し番号", /numberedFights=\{truncated \? null : countedFights\}/],
]) {
  check(`画面: ${name}は数える pull から`, re.test(view), true);
}
check("画面: ログ合計は全 pull (和集合なので重ならない)", /totalLogMs\(tierFights\)/.test(view), true);
// レビューで検出: 別のログと同じ pull だけの日は行は出すが、練習日数には数えない。
check("画面: 練習日数は数える pull がある日だけ", /daysValue\(summary\.days\.filter\(\(d\) => d\.pulls > 0\)\.length\)/.test(view), true);
check("画面: 注釈の番号は数えない側を数える側に読み替える", /duplicateOf=\{duplicateOf\}/.test(view), true);
check("画面: 総 pull から数えない側を引く", /totalPulls - \(fights\.length - tierFights\.length\) - duplicateOf\.size/.test(view), true);
check("画面: クリア数から数えない側のクリアを引く", /duplicateOf\.has\(pullKey\(f\)\) && isClearFight\(f, floors\)/.test(view), true);
check("画面: クリアのタイルは引いた後の数", (view.match(/shownTotalClears > 0/g) ?? []).length >= 4 && !/[^n]totalClears > 0/.test(view), true);

const dayRow = read("src/components/portal/logs/day-row.tsx");
check("日の行: サマリーは数える pull", /sessionSummary\(counted\)/.test(dayRow), true);
check("日の行: ワイプ原因は数える pull", /wipeCauseCounts\(counted\.map/.test(dayRow), true);
check("日の行: プル箱は数える pull", /<PullBoxRow\s+fights=\{counted\}/.test(dayRow), true);
check("日の行: pull 一覧は全部の行に印を渡す", /day\.fights\.map\(\(f\) => \(\s*<PullRow[\s\S]*?duplicate=\{day\.duplicateOf\.has\(pullKey\(f\)\)\}/.test(dayRow), true);
check("日の行: 番号は数える側と同じ", /index=\{numberOf\(f\)\}/.test(dayRow) && /chapterPullLabel\(f, numberOf\(f\),/.test(dayRow), true);
check("日の行: 層・フェーズの範囲のチップも数える pull", /const dayFloors = counted\b/.test(dayRow) && /const dayPhases = counted\b/.test(dayRow), true);
const noteCard = read("src/components/portal/logs/pull-notes-card.tsx");
check("注釈カード: 表を番号の数え方に渡す", /pullNoteDetailsByTag\(\s*[\s\S]*?numberedFights,\s*duplicateOf,\s*\)/.test(noteCard), true);
const pullRow = read("src/components/portal/logs/pull-row.tsx");
check("pull 行: 数えない側に印", /\{duplicate && \([\s\S]*?m\.logs\.duplicatePull\}/.test(pullRow), true);

const server = read("src/lib/supabase/fflogs-fights.ts");
check("server: フェーズ滞在時間 (全件) も数えない側を除く", /phaseTotalsFromRows\(withoutDuplicateRows\(data, fights\)\)/.test(server), true);
const weekly = read("src/lib/logs-weekly-summary.ts");
check("週のまとめ: 数える pull で集計", /const counted = countedPulls\(fights, duplicateOf\);/.test(weekly), true);
check("週のまとめ: ログ合計と戦闘時間は全 pull", /totalLogMs\(inWeekAll\)/.test(weekly) && /unionLengthMs\(inWeekAll\.map/.test(weekly), true);
check("週のまとめ: 数えない側は数える側がその週にあるものだけ", /inWeekKeys\.has\(duplicateOf\.get\(pullKey\(f\)\) \?\? pullKey\(f\)\)/.test(weekly), true);

const dict = read("src/lib/i18n/dict/logs.ts");
check("辞書: ja / en に印の文言", (dict.match(/duplicatePull: "/g) ?? []).length, 2);

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
