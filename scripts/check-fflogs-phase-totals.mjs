/**
 * フェーズ滞在時間の集計 (src/lib/fflogs-phase-totals.ts) の検証 (2026-09-09)。
 * 実行: `node scripts/check-fflogs-phase-totals.mjs`
 *
 * ## なぜ要るのか
 *
 * 2026-09-09 まで、練習ログ (絶) のページは `fflogs_fights` を **2 回
 * フルスキャン**していた — 明細 (`fetchCategoryFights`) と全件のフェーズ集計
 * (`fetchCategoryPhaseTotals`) が、同じ category_id / 同じ並び / 同じ
 * ページングで読んでいた (集計が使う 5 列は明細側の列に完全に含まれる)。
 * 実機の絶竜詩 1047 pull で 4 クエリ / 約 2,100 行の転送。
 *
 * 明細の行から集計する形に寄せたので、**母数の定義が変わっていないこと**を
 * ここで固定する。ずれても画面はエラーを出さず、数字だけ静かに変わる:
 *
 *   - `pulls` は「フェーズ区間が取れた pull 数」で、遷移が保存されていない
 *     pull (古い同期分) は数えない
 *   - `firstReach` は遷移が無くても `last_phase` があれば数えるので、
 *     `pulls` とは一致しない (ここを揃えてしまうと初到達が過少になる)
 *   - 開始 / 終了が数値でない行は捨てる
 *
 * ⚠ tsc は `npx` 経由にしない (Windows で ENOENT / EINVAL になり、CI の
 * ubuntu では通るので壊れていることに気付けない)。
 */
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
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

const outDir = mkdtempSync(join(tmpdir(), "phase-totals-check-"));
try {
  execFileSync(
    process.execPath,
    [
      "node_modules/typescript/bin/tsc",
      "src/lib/fflogs-phase-totals.ts",
      "--outDir",
      outDir,
      "--target",
      "es2022",
      "--module",
      "es2022",
      "--moduleResolution",
      "bundler",
      "--strict",
    ],
    { stdio: "inherit" },
  );
  const fix = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        fix(p);
        continue;
      }
      if (!name.endsWith(".js")) continue;
      const src = readFileSync(p, "utf8").replace(
        /from "(\.\.?\/[^"]+)"/g,
        (mm, spec) => (spec.endsWith(".js") ? mm : `from "${spec}.js"`),
      );
      writeFileSync(p, src);
    }
  };
  fix(outDir);

  const m = await import(
    pathToFileURL(join(outDir, "fflogs-phase-totals.js")).href
  );

  const S = 1_700_000_000_000;
  /** 遷移あり (P1 -> P2)、8 分の pull。 */
  const withTransitions = {
    start_ms: S,
    end_ms: S + 480_000,
    phase_transitions: [
      { id: 1, t: 0 },
      { id: 2, t: 300_000 },
    ],
    last_phase: 2,
    session_date: "2026-09-01",
  };
  /** 遷移なし・last_phase だけ (古い同期分)。 */
  const noTransitions = {
    start_ms: S + 600_000,
    end_ms: S + 900_000,
    phase_transitions: null,
    last_phase: 3,
    session_date: "2026-09-01",
  };

  console.log("\n[母数の定義]");
  const r1 = m.phaseTotalsFromRows([withTransitions, noTransitions]);
  check("pulls は区間が取れた pull だけ", r1.pulls, 1);
  check(
    "firstReach は遷移なしの pull も数える (P3 到達が出る)",
    r1.firstReach.map((f) => f.id).includes(3),
    true,
  );
  check("totals は空でない", r1.totals.length > 0, true);
  check(
    "totals の share は合計 1 (端数は許容)",
    Math.abs(r1.totals.reduce((a, t) => a + t.share, 0) - 1) < 1e-6,
    true,
  );

  console.log("\n[壊れた行の扱い]");
  check(
    "開始 / 終了が数値でない行は捨てる",
    m.phaseTotalsFromRows([
      { start_ms: null, end_ms: null, phase_transitions: null, last_phase: 2 },
      { start_ms: "x", end_ms: "y", phase_transitions: null, last_phase: 2 },
      withTransitions,
    ]).pulls,
    1,
  );
  check(
    "区間が 1 つも取れなければ null (カードを出さない)",
    m.phaseTotalsFromRows([noTransitions]),
    null,
  );
  check("空入力は null", m.phaseTotalsFromRows([]), null);

  console.log("\n[明細の列で集計できるか]");
  // ⚠ 明細 (`fetchCategoryFights`) の行は列が多い。余分な列があっても
  //    集計結果が変わらないことを見る (= 2 回読む必要が無い根拠)。
  const detailRow = {
    ...withTransitions,
    report_code: "aBcD1234",
    fight_id: 12,
    name: "Boss",
    kill: false,
    fight_percentage: 12.3,
    difficulty: 100,
    encounter_id: 1234,
    party_dps: 98765,
    deaths: 3,
    death_events: null,
    report_start_ms: S - 1000,
  };
  check(
    "余分な列があっても同じ結果",
    m.phaseTotalsFromRows([detailRow, noTransitions]),
    r1,
  );
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
