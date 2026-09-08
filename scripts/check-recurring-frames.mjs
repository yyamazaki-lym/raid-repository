/**
 * 定期枠 (src/lib/schedule/recurring-frames.ts) の検証 (2026-09-08、W-15)。
 * 実行: `node scripts/check-recurring-frames.mjs`
 *
 * 重点は「既存デプロイの挙動を壊さないこと」:
 *   - 枠が未設定 / 空のとき **全日が対象**に倒れること
 *     (空 = 「候補日を 1 つも作らない」にすると、曜日を全部外した瞬間に
 *      予定表が空になって戻せなくなる)
 *   - 期間の展開が閲覧者のタイムゾーンに依存しないこと
 *   - 存在しない日付 (2 月 30 日など) を弾くこと
 *   - 上限で打ち切ったことが呼び出し側に分かること
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const SRC = "src/lib/schedule/recurring-frames.ts";

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

const outDir = mkdtempSync(join(tmpdir(), "recurring-frames-check-"));
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
  const {
    parseRecurringDows,
    serializeRecurringDows,
    isRecurringDow,
    describeRecurringDows,
    expandRecurringDates,
    frameDeviation,
    dowLabel,
    dowIndexFromLabel,
    RECURRING_MAX_DATES,
  } = await import(pathToFileURL(join(outDir, "recurring-frames.js")).href);

  console.log("保存値の読み書き");
  check("CSV を昇順・重複なしで読む", parseRecurringDows("6,2,4,2"), [2, 4, 6]);
  check("空白区切りも受ける", parseRecurringDows("2 4 6"), [2, 4, 6]);
  check("未設定は空", parseRecurringDows(null), []);
  check("空文字は空", parseRecurringDows(""), []);
  check("範囲外は捨てる", parseRecurringDows("7,-1,3"), [3]);
  check("数字でない値は捨てる", parseRecurringDows("mon,tue"), []);
  check("往復して同じ", serializeRecurringDows([6, 2, 4, 2]), "2,4,6");
  check("空配列は空文字", serializeRecurringDows([]), "");

  console.log("\n曜日ラベル");
  check("日本語は 1 文字", [0, 2, 6].map((d) => dowLabel(d)), ["日", "火", "土"]);
  check("英語は 3 文字", dowLabel(2, "en"), "Tue");
  check("範囲外も丸めて返す", dowLabel(9), dowLabel(2));

  console.log("\nラベル → 曜日 index");
  // 予定表の行は raw_date の `(火)` から曜日を出す。parsed_date の
  // getDay() だと閲覧者のタイムゾーンで曜日が動く。
  check("日本語ラベル", ["日", "火", "土"].map(dowIndexFromLabel), [0, 2, 6]);
  check("英語ラベル", dowIndexFromLabel("Tue"), 2);
  check("前後の空白を落とす", dowIndexFromLabel(" 火 "), 2);
  check("未知の文字は null", dowIndexFromLabel("X"), null);
  check("空 / 未指定は null", [dowIndexFromLabel(""), dowIndexFromLabel(null)], [null, null]);

  console.log("\n枠が空なら全日 (既存デプロイの挙動)");
  // ここが肝。空を「0 件の枠」と解釈すると設定をいじった瞬間に予定表が
  // 空になり、候補日が 1 件も無いので戻す導線も消える。
  check(
    "枠が空ならどの曜日も対象",
    [0, 1, 2, 3, 4, 5, 6].map((d) => isRecurringDow([], d)),
    [true, true, true, true, true, true, true],
  );
  check(
    "枠があればその曜日だけ",
    [0, 1, 2, 3, 4, 5, 6].map((d) => isRecurringDow([2, 4, 6], d)),
    [false, false, true, false, true, false, true],
  );
  check("説明文", describeRecurringDows([2, 4, 6]), "火・木・土");
  check("説明文 (en)", describeRecurringDows([2, 4, 6], "en"), "Tue, Thu, Sat");
  check("枠が空なら説明文は null", describeRecurringDows([]), null);

  console.log("\n期間 × 曜日の展開");
  // 2026-09-01 は火曜。火・木で 2 週間 → 9/1,9/3,9/8,9/10,9/15
  const r1 = expandRecurringDates("2026-09-01", "2026-09-15", [2, 4]);
  check(
    "両端を含む / 昇順",
    r1.dates.map((d) => `${d.y}-${d.m}-${d.d}`),
    ["2026-9-1", "2026-9-3", "2026-9-8", "2026-9-10", "2026-9-15"],
  );
  check("曜日も返す", r1.dates.map((d) => d.dow), [2, 4, 2, 4, 2]);
  check("打ち切っていない", r1.truncated, false);
  check(
    "1 日だけの期間",
    expandRecurringDates("2026-09-01", "2026-09-01", [2]).dates.length,
    1,
  );
  check(
    "その曜日が無い期間は空",
    expandRecurringDates("2026-09-01", "2026-09-01", [0]).dates.length,
    0,
  );
  check(
    "月をまたぐ",
    expandRecurringDates("2026-09-28", "2026-10-02", [1, 5]).dates.map(
      (d) => `${d.y}-${d.m}-${d.d}`,
    ),
    ["2026-9-28", "2026-10-2"],
  );
  check(
    "うるう日を落とさない",
    expandRecurringDates("2028-02-28", "2028-02-29", [1, 2]).dates.map(
      (d) => `${d.m}-${d.d}`,
    ),
    ["2-28", "2-29"],
  );

  console.log("\n不正な入力");
  check("逆順の期間は空", expandRecurringDates("2026-09-15", "2026-09-01", [2]).dates, []);
  check("形式違いは空", expandRecurringDates("2026/09/01", "2026-09-15", [2]).dates, []);
  check(
    "存在しない日付は空",
    expandRecurringDates("2026-02-30", "2026-03-05", [1]).dates,
    [],
  );
  check("曜日が空なら空", expandRecurringDates("2026-09-01", "2026-09-30", []).dates, []);

  console.log("\n上限");
  // 毎日 (全曜日) × 1 年 → 上限で打ち切る。
  const big = expandRecurringDates("2026-01-01", "2026-12-31", [0, 1, 2, 3, 4, 5, 6]);
  check("上限まで", big.dates.length, RECURRING_MAX_DATES);
  check("打ち切りが伝わる", big.truncated, true);

  console.log("\n例外の判定");
  check(
    "枠どおりなら none",
    frameDeviation({ dows: [2, 4, 6], dow: 2, hasTimeOverride: false }),
    "none",
  );
  check(
    "枠の曜日で時刻を変えていれば time",
    frameDeviation({ dows: [2, 4, 6], dow: 2, hasTimeOverride: true }),
    "time",
  );
  check(
    "枠に無い曜日は extra",
    frameDeviation({ dows: [2, 4, 6], dow: 0, hasTimeOverride: false }),
    "extra",
  );
  check(
    "枠に無い曜日は時刻を変えていても extra (臨時が主たる情報)",
    frameDeviation({ dows: [2, 4, 6], dow: 0, hasTimeOverride: true }),
    "extra",
  );
  // 枠が未設定のときは「定期枠から外れている」という概念が無い。
  check(
    "枠が未設定なら常に none",
    [
      frameDeviation({ dows: [], dow: 0, hasTimeOverride: false }),
      frameDeviation({ dows: [], dow: 3, hasTimeOverride: true }),
    ],
    ["none", "none"],
  );
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
