/**
 * セッションサマリー / チーム実績バッジ (src/lib/fflogs-session.ts) の検証
 * (2026-09-07、W-3 / W-31)。
 * 実行: `node scripts/check-fflogs-session.mjs`
 *
 * 層ごとの初討伐 (L-1) は 2026-09-08 に追加。
 *
 * どれも既存の列 (start_ms / end_ms / kill / deaths / encounter_id) の集計
 * だけなので、検証も合成データで完結する。重点は
 *   - 拘束時間が pull の並び順に依存しないこと
 *   - 戦闘外時間が負にならないこと (pull が重なって記録された場合)
 *   - deaths 未取得 (null) を「ノーデス」と誤判定しないこと
 *   - 層ごとの初討伐で「その層の pull 数」と「通算 pull 数」が食い違うこと
 *     (零式は層を行き来するので、ここが同じ値になったら数え方が壊れている)
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const SRC = "src/lib/fflogs-session.ts";

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

const MIN = 60_000;

/** pull を作る。`at` は開始からの分、`len` は戦闘時間の分。 */
function pull(at, len, opts = {}) {
  const base = Date.UTC(2026, 8, 7, 13, 0, 0); // 22:00 JST
  return {
    startMs: base + at * MIN,
    endMs: base + at * MIN + len * MIN,
    kill: opts.kill ?? false,
    deaths: opts.deaths ?? null,
    sessionDate: opts.date ?? "2026-09-07",
  };
}

const outDir = mkdtempSync(join(tmpdir(), "fflogs-session-check-"));
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
  const { sessionSummary, teamBadges, teamBadgeToneClass, floorFirstClears } =
    await import(pathToFileURL(join(outDir, "fflogs-session.js")).href);

  console.log("セッションサマリー (W-3)");
  const empty = sessionSummary([]);
  check("pull 0 件は全部 0", empty, {
    spanMs: 0,
    fightMs: 0,
    downtimeMs: 0,
    downtimeRatio: 0,
    pulls: 0,
    kills: 0,
    wipes: 0,
    avgPullMs: 0,
  });

  // 22:00 開始 / 5 分の pull を 10 分間隔で 3 本 → 拘束 25 分、戦闘 15 分。
  const three = [pull(0, 5), pull(10, 5), pull(20, 5)];
  const s3 = sessionSummary(three);
  check("拘束時間 = 最初の開始〜最後の終了", s3.spanMs, 25 * MIN);
  check("実戦闘時間 = 各 pull の合計", s3.fightMs, 15 * MIN);
  check("戦闘外 = 拘束 − 実戦闘", s3.downtimeMs, 10 * MIN);
  check("戦闘外比", Math.round(s3.downtimeRatio * 100) / 100, 0.4);
  check("pull 数", s3.pulls, 3);
  check("平均プル長", s3.avgPullMs, 5 * MIN);
  check("kill 0 / wipe 3", [s3.kills, s3.wipes], [0, 3]);

  // 並び順に依存しないこと (DB からは start_ms 降順で来る)。
  const reversed = [...three].reverse();
  check("並び順を変えても同じ", sessionSummary(reversed), s3);

  const withKill = sessionSummary([pull(0, 5), pull(10, 8, { kill: true })]);
  check("kill / wipe の数え分け", [withKill.kills, withKill.wipes], [1, 1]);

  // pull が 1 本だけなら拘束 = 戦闘時間 → 戦闘外 0。
  const one = sessionSummary([pull(0, 7)]);
  check("1 本なら戦闘外 0", [one.spanMs, one.fightMs, one.downtimeMs], [7 * MIN, 7 * MIN, 0]);
  check("1 本の戦闘外比は 0", one.downtimeRatio, 0);

  // 重なった pull (別 PT のログが混ざった等) で戦闘外が負にならないこと。
  const overlap = sessionSummary([pull(0, 10), pull(2, 10)]);
  check("重なっても戦闘外は 0 以上", overlap.downtimeMs, 0);
  check("重なりでも比は 0 以上", overlap.downtimeRatio, 0);

  // 不正な値の pull は無視する (start/end が NaN の行が混ざり得る)。
  const withBogus = sessionSummary([
    pull(0, 5),
    { startMs: NaN, endMs: NaN, kill: false, deaths: null },
  ]);
  check("NaN の pull は数えない", withBogus.pulls, 1);

  console.log("\nチーム実績バッジ (W-31)");
  check("討伐が無ければ空", teamBadges([pull(0, 5), pull(10, 5)]), []);

  const oneClear = teamBadges([
    pull(0, 5),
    pull(10, 8, { kill: true, deaths: 3, date: "2026-09-07" }),
  ]);
  check(
    "初討伐 + 最速討伐 (1 回なので回数バッジは出さない)",
    oneClear.map((b) => b.kind),
    ["firstClear", "fastestClear"],
  );
  check("初討伐の日付", oneClear[0].date, "2026-09-07");
  check("最速討伐の秒数", oneClear[1].value, 8 * 60);

  const twoClears = teamBadges([
    pull(0, 10, { kill: true, deaths: 5, date: "2026-09-01" }),
    pull(20, 6, { kill: true, deaths: 2, date: "2026-09-07" }),
  ]);
  check(
    "2 回なら回数バッジも出る",
    twoClears.map((b) => b.kind),
    ["firstClear", "fastestClear", "clears"],
  );
  check("初討伐は時系列で最初", twoClears[0].date, "2026-09-01");
  check("最速は短い方 (6 分)", twoClears[1].value, 6 * 60);
  check("回数は 2", twoClears[2].value, 2);
  check("回数バッジの日付は最新の討伐", twoClears[2].date, "2026-09-07");

  const flawless = teamBadges([
    pull(0, 10, { kill: true, deaths: 4, date: "2026-09-01" }),
    pull(20, 9, { kill: true, deaths: 0, date: "2026-09-07" }),
  ]);
  check(
    "ノーデス討伐 (deaths=0) を検出",
    flawless.map((b) => b.kind),
    ["firstClear", "flawless", "fastestClear", "clears"],
  );
  check("ノーデスの日付", flawless[1].date, "2026-09-07");

  // ここが肝: deaths 未取得 (null) を 0 と見なすと、古い pull が全部
  // 「ノーデス討伐」になってしまう。
  const unknownDeaths = teamBadges([
    pull(0, 10, { kill: true, deaths: null, date: "2022-04-30" }),
  ]);
  check(
    "deaths 未取得はノーデス扱いしない",
    unknownDeaths.map((b) => b.kind),
    ["firstClear", "fastestClear"],
  );

  console.log("\nバッジの色");
  check(
    "初討伐は emerald",
    teamBadgeToneClass("firstClear"),
    "border-emerald-400/45 bg-emerald-400/10 text-emerald-200",
  );
  check(
    "種類ごとに違う色",
    new Set(
      ["firstClear", "flawless", "fastestClear", "clears"].map(teamBadgeToneClass),
    ).size,
    4,
  );

  console.log("\n層ごとの初討伐 (L-1)");

  /** 層つきの pull。`at` / `len` は分。 */
  const fpull = (at, len, floorIndex, opts = {}) => ({
    ...pull(at, len, opts),
    floorIndex,
  });

  check("討伐が無ければ空", floorFirstClears([fpull(0, 5, 1), fpull(10, 5, 2)]), []);
  check("pull が無ければ空", floorFirstClears([]), []);

  // 零式の実態: 1〜3 層を消化で回しながら 4 層を練習する。
  //   1 層: 3 本目 (通算 3) で討伐 / 2 層: その層の 2 本目 (通算 5) で討伐
  //   4 層: その層の 3 本目 (通算 8) で討伐
  const tier = [
    fpull(0, 5, 1, { date: "2026-08-01" }),
    fpull(10, 5, 1, { date: "2026-08-01" }),
    fpull(20, 4, 1, { kill: true, date: "2026-08-01" }),
    fpull(30, 6, 2, { date: "2026-08-01" }),
    fpull(40, 7, 2, { kill: true, date: "2026-08-01" }),
    fpull(50, 9, 4, { date: "2026-08-08" }),
    fpull(70, 9, 4, { date: "2026-08-08" }),
    fpull(90, 8, 4, { kill: true, date: "2026-08-15" }),
  ];
  const clears = floorFirstClears(tier);
  check("討伐した層だけ / 層 index の昇順", clears.map((c) => c.index), [1, 2, 4]);
  check(
    "その層の pull 数 (討伐した pull を含む)",
    clears.map((c) => c.pulls),
    [3, 2, 3],
  );
  check(
    "通算 pull 数はティア開始からの通し番号",
    clears.map((c) => c.overallPulls),
    [3, 5, 8],
  );
  check(
    "所要時間はその層だけの累計戦闘時間",
    clears.map((c) => c.ms),
    [(5 + 5 + 4) * MIN, (6 + 7) * MIN, (9 + 9 + 8) * MIN],
  );
  check("初討伐の日付", clears.map((c) => c.date), [
    "2026-08-01",
    "2026-08-01",
    "2026-08-15",
  ]);
  check("初討伐 pull の開始時刻", clears[2].startMs, tier[7].startMs);

  // 並び順に依存しないこと (DB からは start_ms 降順で来る)。
  check("並び順を変えても同じ", floorFirstClears([...tier].reverse()), clears);

  // 2 回目以降の討伐 (毎週の消化) で初討伐が上書きされないこと。
  const repeat = floorFirstClears([
    fpull(0, 5, 1, { kill: true, date: "2026-08-01" }),
    fpull(10, 4, 1, { kill: true, date: "2026-08-08" }),
    fpull(20, 4, 1, { kill: true, date: "2026-08-15" }),
  ]);
  check("初討伐は最初の 1 回だけ", repeat.length, 1);
  check("上書きされない (日付)", repeat[0].date, "2026-08-01");
  check("上書きされない (pull 数)", [repeat[0].pulls, repeat[0].overallPulls], [1, 1]);

  // 4 層前半 / 後半は別 index。後半の pull 数に前半の分を混ぜない。
  const halves = floorFirstClears([
    fpull(0, 6, 4, { date: "2026-08-20" }),
    fpull(10, 6, 4, { kill: true, date: "2026-08-20" }),
    fpull(20, 8, 5, { date: "2026-08-20" }),
    fpull(40, 8, 5, { date: "2026-08-27" }),
    fpull(60, 7, 5, { kill: true, date: "2026-08-27" }),
  ]);
  check(
    "前半 / 後半は別の層として数える",
    halves.map((c) => [c.index, c.pulls, c.overallPulls]),
    [
      [4, 2, 2],
      [5, 3, 5],
    ],
  );

  // 不正な値の pull は無視する (NaN の行が混ざり得る)。
  const bogus = floorFirstClears([
    { startMs: NaN, endMs: NaN, kill: true, floorIndex: 1, sessionDate: null },
    fpull(0, 5, 1, { kill: true, date: "2026-08-01" }),
  ]);
  check("NaN の pull は数えない", [bogus.length, bogus[0].overallPulls], [1, 1]);
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
