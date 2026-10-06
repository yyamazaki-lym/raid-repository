/**
 * 到達度の計算 (src/lib/fflogs-progress.ts) の検証 (2026-09-08、UI-1)。
 * 実行: `node scripts/check-fflogs-progress.mjs`
 *
 * `progressValue` は 2026-09-08 に `progressTimeline` の中から切り出した
 * 計算式で、日ごとのバー / 進行トレンド / プル・ボックス列 / コンテンツ
 * カードのスパークラインが**すべてこれ 1 つ**を通る。式が変わると 4 箇所の
 * 見え方が同時にずれるので、境界を固定しておく。
 *
 * 重点:
 *   - 区間モデルがあるとき「突破済み区間数 + 現在区間の削り」になること
 *   - 区間が取れない pull を **最も浅い区間**に倒すこと (過大にしない)
 *   - 層モデルで **最終層以外の討伐は 100 にしない** こと
 *     (消化で 1 層を倒した pull が 100 になると箱列が緑に埋まる)
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const SRCS = [
  "src/lib/fflogs-progress.ts",
  "src/lib/jst-date.ts",
  "src/lib/fflogs-fight-detail.ts",
  "src/lib/perf-tone.ts",
];

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

const outDir = mkdtempSync(join(tmpdir(), "fflogs-progress-check-"));
try {
  execFileSync(
    process.execPath,
    [
      "node_modules/typescript/bin/tsc", ...SRCS,
      "--outDir", outDir,
      "--target", "es2022",
      "--module", "es2022",
      "--moduleResolution", "bundler",
      "--strict",
    ],
    { stdio: "inherit" },
  );
  // tsc は相対 import に拡張子を付けない (bundler 前提) が Node の ESM は必須。
  for (const f of [
    "fflogs-progress.js",
    "jst-date.js",
    "fflogs-fight-detail.js",
    "perf-tone.js",
  ]) {
    const path = join(outDir, f);
    writeFileSync(
      path,
      readFileSync(path, "utf8").replace(
        /from "(\.\/[^"]+?)"/g,
        (m, spec) => (spec.endsWith(".js") ? m : `from "${spec}.js"`),
      ),
    );
  }
  const mod = await import(
    pathToFileURL(join(outDir, "fflogs-progress.js")).href
  );
  const {
    progressValue,
    pullProgress,
    buildFloorMap,
    isClearFight,
    filterToFloorCluster,
    pullSpanByReport,
    totalLogMs,
  } = mod;

  console.log("到達度の計算式 (progressValue)");
  check(
    "クリアは無条件で 100",
    progressValue({
      hasClear: true,
      segment: 1,
      segmentCount: 4,
      remainingPercent: 90,
    }),
    100,
  );
  // 4 区間の 3 区間目で残 50% → (3-1 + 0.5) / 4 = 62.5%
  check(
    "突破済み区間 + 現在区間の削り",
    progressValue({
      hasClear: false,
      segment: 3,
      segmentCount: 4,
      remainingPercent: 50,
    }),
    62.5,
  );
  check(
    "1 区間目の手つかずは 0",
    progressValue({
      hasClear: false,
      segment: 1,
      segmentCount: 4,
      remainingPercent: 100,
    }),
    0,
  );
  check(
    "最終区間を削り切る手前は 100 未満",
    progressValue({
      hasClear: false,
      segment: 4,
      segmentCount: 4,
      remainingPercent: 0.5,
    }) < 100,
    true,
  );
  // ここが肝: 区間が取れない pull を全体の 100 − 残% で描くと、P1 で
  // 死んだ pull が「ほぼ討伐」に見える。最も浅い区間に倒す。
  check(
    "区間が取れないときは最も浅い区間に倒す",
    progressValue({
      hasClear: false,
      segment: null,
      segmentCount: 4,
      remainingPercent: 5,
    }),
    progressValue({
      hasClear: false,
      segment: 1,
      segmentCount: 4,
      remainingPercent: 5,
    }),
  );
  check(
    "その値は 1 区間ぶん (25%) を超えない",
    progressValue({
      hasClear: false,
      segment: null,
      segmentCount: 4,
      remainingPercent: 0,
    }),
    25,
  );
  check(
    "区間モデルが無ければ 100 − 残%",
    progressValue({
      hasClear: false,
      segment: null,
      segmentCount: null,
      remainingPercent: 30,
    }),
    70,
  );
  check(
    "残% も取れなければ 0",
    progressValue({
      hasClear: false,
      segment: null,
      segmentCount: null,
      remainingPercent: null,
    }),
    0,
  );
  check(
    "残% が範囲外でも 0-100 に収める",
    [
      progressValue({
        hasClear: false,
        segment: null,
        segmentCount: null,
        remainingPercent: 150,
      }),
      progressValue({
        hasClear: false,
        segment: null,
        segmentCount: null,
        remainingPercent: -10,
      }),
    ],
    [0, 100],
  );

  console.log("\npull 単位の到達度 (pullProgress)");
  // 4 層構成のティア (encounter 100..103)。
  const fight = (o) => ({
    reportCode: "abc",
    fightId: o.fightId ?? 1,
    sessionDate: "2026-09-01",
    name: null,
    kill: o.kill ?? false,
    fightPercentage: o.pct ?? null,
    lastPhase: o.phase ?? null,
    encounterId: o.enc ?? null,
    difficulty: null,
    partyDps: null,
    deaths: null,
    wipe: null,
    phases: null,
    startMs: o.startMs ?? 0,
    endMs: (o.startMs ?? 0) + 300000,
    reportStartMs: null,
  });
  const tierFights = [
    fight({ enc: 100, kill: true, fightId: 1 }),
    fight({ enc: 101, kill: true, fightId: 2 }),
    fight({ enc: 102, kill: true, fightId: 3 }),
    fight({ enc: 103, pct: 40, fightId: 4 }),
  ];
  const floors = buildFloorMap(tierFights, 4);
  check("4 層のマップができる", floors?.floorCount, 4);
  check("最終層は最大 encounter", floors?.finalEncounterId, 103);
  check(
    "下層の討伐 (消化) はクリアに数えない",
    tierFights.map((f) => isClearFight(f, floors)),
    [false, false, false, false],
  );
  check(
    "最終層の討伐だけがクリア",
    isClearFight(fight({ enc: 103, kill: true }), floors),
    true,
  );
  // 消化で 1 層を倒した pull。区間 1 を突破した扱い = 1/4 = 25%。
  check(
    "1 層の討伐は 100 ではなく 1 区間ぶん",
    pullProgress(fight({ enc: 100, kill: true }), floors, 4),
    25,
  );
  check(
    "3 層の討伐は 3 区間ぶん",
    pullProgress(fight({ enc: 102, kill: true }), floors, 4),
    75,
  );
  check(
    "最終層の討伐は 100",
    pullProgress(fight({ enc: 103, kill: true }), floors, 4),
    100,
  );
  // 4 層で残 40% → (4-1 + 0.6) / 4 = 90%
  check(
    "最終層のワイプは残% ぶんだけ進む",
    pullProgress(fight({ enc: 103, pct: 40 }), floors, 4),
    90,
  );
  check(
    "ティア外の encounter は最も浅い区間に倒す",
    pullProgress(fight({ enc: 9999, pct: 0 }), floors, 4),
    25,
  );

  console.log("\nフェーズモデル (絶)");
  // 層マップが無いコンテンツでは lastPhase が区間になる。
  check(
    "P3 で残 50% (全 7 フェーズ)",
    Math.round(
      pullProgress(fight({ enc: null, phase: 3, pct: 50 }), null, 7) * 100,
    ) / 100,
    Math.round(((3 - 1 + 0.5) / 7) * 100 * 100) / 100,
  );
  check(
    "討伐は 100",
    pullProgress(fight({ enc: null, phase: 7, kill: true }), null, 7),
    100,
  );

  console.log("\nレポートごとの最初と最後の pull (pullSpanByReport、2026-10-02)");
  // 動画オフセットの基準 (pull #1)。画面とサーバー (タイトルの録画時刻から
  // 秒数を出す) で同じ関数を使う。
  const p = (reportCode, startMs, encounterId) => ({ reportCode, startMs, encounterId });
  const spans = pullSpanByReport([p("A", 300, 1), p("A", 100, 1), p("B", 50, 1), p("A", 200, 1)]);
  check("A の最初", spans.get("A")?.firstStartMs, 100);
  check("A の最後", spans.get("A")?.lastStartMs, 300);
  check("B は 1 本なら最初 = 最後", spans.get("B"), { firstStartMs: 50, lastStartMs: 50 });
  check("無いレポート", spans.get("C"), undefined);
  check("開始が数でない行は無視", pullSpanByReport([p("A", Number.NaN, 1), p("A", 7, 1)]).get("A"), { firstStartMs: 7, lastStartMs: 7 });
  // 同じレポートの先頭に別コンテンツ (層クラスタ外) の戦闘が混ざっていても、
  // クラスタで絞った後の最初の pull が基準になる (画面と同じ)。
  const mixed = [
    p("R", 1000, 9001), // 別コンテンツ (クラスタ外) が先
    p("R", 2000, 93), p("R", 3000, 94), p("S", 500, 93), p("S", 600, 95), p("T", 700, 96),
  ];
  const tier = filterToFloorCluster(mixed, buildFloorMap(mixed));
  check("クラスタで絞ると R の最初は 2000", pullSpanByReport(tier).get("R")?.firstStartMs, 2000);
  check("絞らなければ 1000 (= 絞らないと秒数がずれる)", pullSpanByReport(mixed).get("R")?.firstStartMs, 1000);

  // 2026-10-06: 練習日数の下に出すログの合計時間。
  console.log("\nログの合計時間 (totalLogMs)");
  const lf = (reportCode, startMs, endMs, reportStartMs = null) => ({
    reportCode, startMs, endMs, reportStartMs,
  });
  check("0 件は 0", totalLogMs([]), 0);
  check(
    "ログの開始〜最後の pull の終わり (pull の間の休憩を含む)",
    totalLogMs([lf("A", 1000, 2000, 0), lf("A", 5000, 6000, 0)]),
    6000,
  );
  check(
    "別の時間帯のログは足す",
    totalLogMs([lf("A", 1000, 2000, 0), lf("B", 11000, 12000, 10000)]),
    2000 + 2000,
  );
  check(
    "重なるログは 1 回だけ数える (同じ時間帯を 2 人が上げた)",
    totalLogMs([lf("A", 1000, 5000, 0), lf("B", 2000, 8000, 1500)]),
    8000,
  );
  check(
    "片方がもう片方に含まれても 1 回",
    totalLogMs([lf("A", 1000, 9000, 0), lf("B", 3000, 4000, 2000)]),
    9000,
  );
  check(
    "ちょうど接するログはつなげる (二重にも欠けにもしない)",
    totalLogMs([lf("A", 500, 1000, 0), lf("B", 1500, 2000, 1000)]),
    2000,
  );
  check(
    "渡す順によらない",
    totalLogMs([lf("B", 11000, 12000, 10000), lf("A", 5000, 6000, 0), lf("A", 1000, 2000, 0)]),
    6000 + 2000,
  );
  check(
    "ログの開始が無ければ最初の pull の開始から",
    totalLogMs([lf("A", 1000, 2000), lf("A", 3000, 4000)]),
    3000,
  );
  check(
    "ログの開始が最初の pull より後ならその pull から (壊れた値で縮めない)",
    totalLogMs([lf("A", 1000, 2000, 1500), lf("A", 3000, 4000, 1500)]),
    3000,
  );
  check(
    "時刻が数でない行は無視",
    totalLogMs([lf("A", Number.NaN, 2000, 0), lf("A", 1000, 2000, 0)]),
    2000,
  );
  check(
    "終わりが開始より前の行で区間を逆にしない",
    totalLogMs([lf("A", 1000, 500, 0)]),
    1000,
  );
  // ⚠ 1 本のログに別コンテンツが先に入っている (ログの開始が最初の pull の
  // ずっと前) とき、その時間を入れない。準備の時間は 30 分まで入れる。
  const MIN = 60 * 1000;
  const t0 = 1_000_000_000;
  check(
    "ログの開始が最初の pull の 10 分前なら全部入れる (準備の時間)",
    totalLogMs([lf("A", t0, t0 + 60 * MIN, t0 - 10 * MIN)]),
    70 * MIN,
  );
  check(
    "ちょうど 30 分前までは全部入れる",
    totalLogMs([lf("A", t0, t0 + 60 * MIN, t0 - 30 * MIN)]),
    90 * MIN,
  );
  check(
    "2 時間前に始まったログ (先に別コンテンツ) は 30 分前から数える",
    totalLogMs([lf("A", t0, t0 + 60 * MIN, t0 - 120 * MIN), lf("A", t0 + 70 * MIN, t0 + 80 * MIN, t0 - 120 * MIN)]),
    110 * MIN,
  );
  // ⚠ 1 本のレポートに複数日の練習が入っていても、夜をまたぐ空き時間を数えない
  // (区間は「レポート × 練習日」ごと。2026-10-07)。
  const ld = (date, startMs, endMs, reportStartMs = null) => ({
    reportCode: "A", sessionDate: date, startMs, endMs, reportStartMs,
  });
  check(
    "同じレポートでも練習日が違えば別の区間 (夜を数えない)",
    totalLogMs([ld("2026-10-01", t0, t0 + 60 * MIN), ld("2026-10-02", t0 + 24 * 60 * MIN, t0 + 25 * 60 * MIN)]),
    120 * MIN,
  );
  check(
    "2 日目の区間の開始も 30 分前までしか遡らない (ログの開始は 1 日目の前)",
    totalLogMs([
      ld("2026-10-01", t0, t0 + 60 * MIN, t0 - 10 * MIN),
      ld("2026-10-02", t0 + 24 * 60 * MIN, t0 + 25 * 60 * MIN, t0 - 10 * MIN),
    ]),
    (10 + 60 + 30 + 60) * MIN,
  );
  check(
    "練習日が無い行は JST の暦日で分ける",
    totalLogMs([lf("A", t0, t0 + 60 * MIN), lf("A", t0 + 24 * 60 * MIN, t0 + 25 * 60 * MIN)]),
    120 * MIN,
  );
  check(
    "上限は最初の pull から数える (後の pull の前に遡らない)",
    totalLogMs([lf("A", t0 + 70 * MIN, t0 + 80 * MIN, t0 - 120 * MIN), lf("A", t0, t0 + 60 * MIN, t0 - 120 * MIN)]),
    110 * MIN,
  );
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

// 2026-10-06: 練習日数のタイルの配線 (ログの合計時間)。数える pull は練習日数と
// 同じ tierFights で、明細が打ち切られていれば他のカードと同じ注記を添える。
console.log("\n練習日数のタイルの配線");
{
  const view = readFileSync("src/app/(portal)/category/[slug]/logs/logs-view.tsx", "utf8").replace(/\r\n/g, "\n");
  check(
    "合計は練習日数と同じ tierFights から",
    /const logTotalMs = useMemo\(\(\) => totalLogMs\(tierFights\), \[tierFights\]\);/.test(view),
    true,
  );
  check(
    "打ち切り時は shownOnly を添える",
    /m\.logs\.statLogTotal\(formatMs\(logTotalMs\)\) \+\s*\(truncated \? m\.logs\.shownOnly : ""\)/.test(view),
    true,
  );
}

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
