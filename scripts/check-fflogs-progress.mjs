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
  const { progressValue, pullProgress, buildFloorMap, isClearFight } = mod;

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
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
