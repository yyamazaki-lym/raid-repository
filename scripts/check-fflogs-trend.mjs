/**
 * 進行トレンド (src/lib/fflogs-trend.ts) の検証 (2026-09-07、W-4)。
 * 実行: `node scripts/check-fflogs-trend.mjs`
 *
 * 重点は「ペースの目安」を**出さない条件**。外挿は伸び率が正のときしか
 * 意味を持たないので、停滞・後退・クリア済み・セッション不足では null を
 * 返すことを固定する (ここが崩れると「あと 0 pull」や巨大な数字が出る)。
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const SRC = "src/lib/fflogs-trend.ts";

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

/** 日 (date は連番で作る)。 */
function day(n, pulls, progress, hasClear = false) {
  return {
    date: `2026-09-${String(n).padStart(2, "0")}`,
    pulls,
    progress,
    hasClear,
  };
}

const outDir = mkdtempSync(join(tmpdir(), "fflogs-trend-check-"));
try {
  execFileSync(
    "npx",
    [
      "tsc", SRC,
      "--outDir", outDir,
      "--target", "es2022",
      "--module", "es2022",
      "--moduleResolution", "bundler",
      "--strict",
    ],
    { stdio: "inherit" },
  );
  const { trendSeries, clearPace, sparklinePath, PACE_MIN_SESSIONS } =
    await import(pathToFileURL(join(outDir, "fflogs-trend.js")).href);

  console.log("時系列トレンド");
  check("空は空", trendSeries([]), []);

  const series = trendSeries([day(1, 20, 30), day(2, 25, 50), day(3, 15, 40)]);
  check(
    "累積 pull",
    series.map((p) => p.cumulativePulls),
    [20, 45, 60],
  );
  check(
    "その日の到達度はそのまま",
    series.map((p) => p.progress),
    [30, 50, 40],
  );
  // 3 日目は調子が悪くて 40 だが、最高到達は 50 のまま下がらない。
  check(
    "最高到達は単調非減少",
    series.map((p) => p.bestProgress),
    [30, 50, 50],
  );

  const unsorted = trendSeries([day(3, 15, 40), day(1, 20, 30), day(2, 25, 50)]);
  check("入力の並び順に依存しない", unsorted, series);

  const clamped = trendSeries([day(1, 5, 120), day(2, 5, -10)]);
  check(
    "到達度は 0-100 に丸める",
    clamped.map((p) => p.progress),
    [100, 0],
  );
  const negPulls = trendSeries([day(1, -5, 10)]);
  check("負の pull は 0 扱い", negPulls[0].cumulativePulls, 0);

  console.log("\nペースの目安 — 出す条件");
  // 4 セッションで 20 → 80 (1 区間あたり +20)、pull は毎日 30 本。
  const rising = trendSeries([
    day(1, 30, 20),
    day(2, 30, 40),
    day(3, 30, 60),
    day(4, 30, 80),
  ]);
  const pace = clearPace(rising);
  check("セッション数", pace.sessions, 4);
  check("1 セッションあたりの pull", pace.pullsPerSession, 30);
  check("1 セッションあたりの伸び", pace.progressPerSession, 20);
  // 残り 20 ポイント / 1 セッション +20 → あと 1 セッション = 30 pull。
  check("残りセッション数", pace.sessionsToClear, 1);
  check("残り pull 数", pace.pullsToClear, 30);

  console.log("\nペースの目安 — 出さない条件");
  check(
    `セッションが ${PACE_MIN_SESSIONS} 未満なら null`,
    clearPace(trendSeries([day(1, 30, 20), day(2, 30, 40)])),
    null,
  );
  // 停滞: 最高到達が伸びていない。
  check(
    "停滞は null",
    clearPace(trendSeries([day(1, 30, 50), day(2, 30, 50), day(3, 30, 50)])),
    null,
  );
  // 後退: その日の到達度は下がるが最高到達は下がらない → 伸び 0 → null。
  check(
    "後退 (最高が伸びない) は null",
    clearPace(trendSeries([day(1, 30, 60), day(2, 30, 40), day(3, 30, 30)])),
    null,
  );
  check(
    "クリア済みは null",
    clearPace(
      trendSeries([day(1, 30, 40), day(2, 30, 70), day(3, 30, 100, true)]),
    ),
    null,
  );

  // 直近ウィンドウ (5 セッション) だけを見る: 古い急成長を混ぜない。
  const oldFastNewSlow = trendSeries([
    day(1, 30, 5),
    day(2, 30, 60), // 昔の急成長 (ウィンドウ外)
    day(3, 30, 62),
    day(4, 30, 64),
    day(5, 30, 66),
    day(6, 30, 68),
    day(7, 30, 70),
  ]);
  const slowPace = clearPace(oldFastNewSlow);
  check("直近 5 セッションを母数にする", slowPace.sessions, 5);
  check("直近の伸びで計算 (+2/回)", slowPace.progressPerSession, 2);
  check("残り 30 ポイント / 2 = 15 セッション", slowPace.sessionsToClear, 15);

  console.log("\nスパークラインの座標");
  check("空は空文字", sparklinePath([], 100, 20), "");
  check("幅 0 は空文字", sparklinePath([50], 0, 20), "");
  check("高さ 0 は空文字", sparklinePath([50], 100, 0), "");
  // 1 点だけなら水平線 (polyline は 1 点だと何も描画されない)。
  check("1 点は水平線", sparklinePath([50], 100, 20), "0,10 100,10");
  // 0 は下端 (y = height)、100 は上端 (y = 0) — SVG は y が下向き。
  check("0 は下端 / 100 は上端", sparklinePath([0, 100], 100, 20), "0,20 100,0");
  check(
    "等間隔に並ぶ",
    sparklinePath([0, 50, 100], 100, 20),
    "0,20 50,10 100,0",
  );
  check(
    "範囲外は丸める",
    sparklinePath([-20, 150], 100, 20),
    "0,20 100,0",
  );
  // 座標は小数 2 桁 (SSR とクライアントで文字列が一致し hydration が壊れない)。
  check(
    "座標は小数 2 桁に丸める",
    sparklinePath([0, 33, 66], 10, 3),
    "0,3 5,2.01 10,1.02",
  );
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
