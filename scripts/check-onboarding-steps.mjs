/**
 * 新規メンバーの学習パス (src/lib/onboarding-steps.ts) の検証
 * (2026-09-08、B-3)。
 * 実行: `node scripts/check-onboarding-steps.mjs`
 *
 * 固定したいのは 3 点:
 *   1. 順番が固定 (動画 → 散開図 → マクロ → 軽減表)
 *   2. **中身が無い手順は分母に入れない** (動画 0 本のコンテンツで
 *      「動画を見る」を促さない / 「1/4 しか終わっていない」に見せない)
 *   3. `next` は**中身があって未済の最初の手順** — 飛ばして先を勧めない
 *
 * ⚠ tsc は `process.execPath` + `node_modules/typescript/bin/tsc` で起動する
 *   (`npx` は Windows で ENOENT / EINVAL になる)。
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
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

const outDir = mkdtempSync(join(tmpdir(), "onboarding-check-"));
try {
  execFileSync(
    process.execPath,
    [
      "node_modules/typescript/bin/tsc",
      "src/lib/onboarding-steps.ts",
      "--outDir", outDir,
      "--target", "es2022",
      "--module", "es2022",
      "--moduleResolution", "bundler",
      "--strict",
    ],
    { stdio: "inherit" },
  );
  const m = await import(pathToFileURL(join(outDir, "onboarding-steps.js")).href);

  console.log("\n[手順]");
  check("順番は固定", m.ONBOARDING_STEP_IDS, [
    "video",
    "waymark",
    "macro",
    "mitigation",
  ]);
  check(
    "既知の手順",
    [m.isOnboardingStepId("video"), m.isOnboardingStepId("nope")],
    [true, false],
  );
  check("飛び先のタブ", m.ONBOARDING_STEP_SEGMENT.mitigation, "mitigation");
  check("散開図とマクロは同じタブ", [
    m.ONBOARDING_STEP_SEGMENT.waymark,
    m.ONBOARDING_STEP_SEGMENT.macro,
  ], ["macros", "macros"]);

  console.log("\n[進捗]");
  let p = m.buildOnboardingProgress({ doneIds: [], availability: {} });
  check("何も済んでいない", [p.done, p.total, p.next], [0, 4, "video"]);

  p = m.buildOnboardingProgress({ doneIds: ["video"], availability: {} });
  check("1 つ済んだら次は散開図", [p.done, p.total, p.next], [1, 4, "waymark"]);

  p = m.buildOnboardingProgress({
    doneIds: ["video", "waymark", "macro", "mitigation"],
    availability: {},
  });
  check("全部済んだら next は null", [p.done, p.total, p.next], [4, 4, null]);

  console.log("\n[中身が無い手順]");
  p = m.buildOnboardingProgress({
    doneIds: [],
    availability: { video: false },
  });
  check(
    "中身が無い手順は分母から外し、next も飛ばす",
    [p.done, p.total, p.next],
    [0, 3, "waymark"],
  );
  check(
    "行そのものは残る (available=false で出す / 出さないは UI の判断)",
    p.steps.map((s) => [s.id, s.available]),
    [
      ["video", false],
      ["waymark", true],
      ["macro", true],
      ["mitigation", true],
    ],
  );
  p = m.buildOnboardingProgress({
    doneIds: ["waymark"],
    availability: { video: false, macro: false, mitigation: false },
  });
  check(
    "中身が 1 つだけで済なら 1/1 で next なし",
    [p.done, p.total, p.next],
    [1, 1, null],
  );
  p = m.buildOnboardingProgress({
    doneIds: [],
    availability: {
      video: false,
      waymark: false,
      macro: false,
      mitigation: false,
    },
  });
  check("中身が 1 つも無ければ 0/0", [p.done, p.total, p.next], [0, 0, null]);

  console.log("\n[知らない手順]");
  p = m.buildOnboardingProgress({
    doneIds: ["legacy-step", "video"],
    availability: {},
  });
  check("知らない済 id は数えない", [p.done, p.next], [1, "waymark"]);
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
