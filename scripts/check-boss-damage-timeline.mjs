/**
 * ボスの被ダメージ時系列 (src/lib/logs/boss-damage-timeline.ts) の検証
 * (2026-09-08、W-10 + W-9 の x 軸)。
 * 実行: `node scripts/check-boss-damage-timeline.mjs`
 *
 * 固定したいのは 5 点:
 *   1. **全体攻撃の 8 ヒットが 1 行に畳まれる** (畳まないと軽減表にならない)
 *   2. 畳む判定は**丸めではなく「その行の先頭のヒットから N ms 以内か」** —
 *      丸めだと境界をまたいだ同じ攻撃が 2 行に割れ、「直前のヒットから」だと
 *      一定間隔の継続ダメージが際限なく 1 行に繋がる
 *   3. 別の技 / 十分に離れた同じ技は別行
 *   4. 吸収 (シールドで消えた分) を「飛んできた量」に含める
 *   5. TSV は**タブ区切り** (Sheets が貼るだけで表にする)
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

const outDir = mkdtempSync(join(tmpdir(), "boss-damage-check-"));
try {
  execFileSync(
    process.execPath,
    [
      "node_modules/typescript/bin/tsc",
      "src/lib/logs/boss-damage-timeline.ts",
      "--outDir", outDir,
      "--target", "es2022",
      "--module", "es2022",
      "--moduleResolution", "bundler",
      "--strict",
    ],
    { stdio: "inherit" },
  );
  const m = await import(
    pathToFileURL(join(outDir, "boss-damage-timeline.js")).href
  );

  const START = 1_000_000;
  const END = 1_480_000;
  const hit = (offsetMs, name, guid, amount, absorbed = 0) => ({
    timestamp: START + offsetMs,
    amount,
    absorbed,
    ability: { name, guid },
  });

  console.log("\n[畳み込み]");
  // 全体攻撃: 8 人ぶんが 0〜120ms に散る。
  const aoe = [0, 20, 40, 55, 70, 85, 100, 120].map((o) =>
    hit(60_000 + o, "アク・モーン", 1001, 40_000),
  );
  let rows = m.buildBossDamageTimeline({ data: aoe }, START, END);
  check("8 ヒットが 1 行", rows.length, 1);
  check(
    "対象人数 / 合計 / 最大",
    [rows[0].targets, rows[0].total, rows[0].max],
    [8, 320_000, 40_000],
  );
  check("時刻は最初のヒット", rows[0].t, 60_000);

  console.log("\n[境界]");
  // 先頭からの距離で判定する。丸め (1000ms 単位) だと 999→1001 の 2 発が
  // 別行に割れるが、この実装では 1 行になる。
  rows = m.buildBossDamageTimeline(
    {
      data: [
        hit(10_000, "連撃", 2001, 1_000),
        hit(10_000 + 699, "連撃", 2001, 1_000),
      ],
    },
    START,
    END,
  );
  check("先頭から 699ms 以内なら畳む", [rows.length, rows[0].targets], [1, 2]);
  // ⚠ 「直前のヒットから」にすると、一定間隔の継続ダメージが際限なく
  // 1 行に繋がる。先頭基準なので窓を出た 3 発目は別行になる。
  rows = m.buildBossDamageTimeline(
    {
      data: [
        hit(10_000, "継続", 2001, 1_000),
        hit(10_000 + 600, "継続", 2001, 1_000),
        hit(10_000 + 1_200, "継続", 2001, 1_000),
        hit(10_000 + 1_800, "継続", 2001, 1_000),
      ],
    },
    START,
    END,
  );
  check(
    "一定間隔の継続ダメージは際限なく繋がらない",
    rows.map((r) => r.targets),
    [2, 2],
  );
  rows = m.buildBossDamageTimeline(
    {
      data: [
        hit(10_000, "連撃", 2001, 1_000),
        hit(10_000 + 701, "連撃", 2001, 1_000),
      ],
    },
    START,
    END,
  );
  check("701ms 離れたら別行", rows.length, 2);

  console.log("\n[別の技 / 範囲外]");
  rows = m.buildBossDamageTimeline(
    {
      data: [
        hit(30_000, "A", 3001, 100),
        hit(30_010, "B", 3002, 200),
        hit(9_000_000, "別 pull", 3003, 999),
        { amount: 1 },
        null,
      ],
    },
    START,
    END,
  );
  check(
    "同時刻でも別の技は別行 / 範囲外と壊れた要素は捨てる",
    rows.map((r) => [r.ability, r.targets]),
    [
      ["A", 1],
      ["B", 1],
    ],
  );

  console.log("\n[吸収と閾値]");
  rows = m.buildBossDamageTimeline(
    { data: [hit(5_000, "シールドされた", 4001, 0, 12_345)] },
    START,
    END,
  );
  check("吸収も飛んできた量に含める", rows[0].total, 12_345);
  rows = m.buildBossDamageTimeline(
    {
      data: [
        hit(5_000, "小ダメージ", 5001, 100),
        hit(6_000, "大ダメージ", 5002, 50_000),
      ],
    },
    START,
    END,
    1_000,
  );
  check("閾値未満は捨てる", rows.map((r) => r.ability), ["大ダメージ"]);

  console.log("\n[入力の形]");
  check("素の配列", m.buildBossDamageTimeline([hit(0, "A", 1, 1)], START, END).length, 1);
  check(
    "events.data の入れ子",
    m.buildBossDamageTimeline({ events: { data: [hit(0, "A", 1, 1)] } }, START, END).length,
    1,
  );
  check("配列でなければ空", m.buildBossDamageTimeline(null, START, END), []);

  console.log("\n[書式]");
  check("m:ss", m.formatTimelineClock(125_400), "2:05");
  check("0", m.formatTimelineClock(0), "0:00");
  check("負値は 0", m.formatTimelineClock(-500), "0:00");

  console.log("\n[TSV]");
  const tsv = m.buildMitigationDraftTsv({
    rows: [
      { t: 60_000, ability: "アク・モーン", abilityId: 1, targets: 8, total: 320_000, max: 40_000 },
      { t: 90_000, ability: "改行\tと\nタブ", abilityId: 2, targets: 1, total: 10, max: 10 },
    ],
    headers: ["時刻", "技名", "対象", "合計", "最大"],
  });
  check(
    "タブ区切り / 技名の改行とタブを空白に潰す",
    tsv.split("\n"),
    [
      "時刻\t技名\t対象\t合計\t最大",
      "1:00\tアク・モーン\t8\t320000\t40000",
      "1:30\t改行 と タブ\t1\t10\t10",
    ],
  );
  check(
    "行 0 件なら見出しだけ",
    m.buildMitigationDraftTsv({ rows: [], headers: ["a", "b", "c", "d", "e"] }),
    "a\tb\tc\td\te",
  );
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
