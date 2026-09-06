/**
 * 死亡イベント / フェーズ遷移の正規化と要約 (src/lib/fflogs-fight-detail.ts)
 * の検証 (2026-09-06、調査ノート第 4 回 W-1 / W-2)。
 * 実行: `node scripts/check-fflogs-fight-detail.mjs`
 *
 * FFLogs 実 API には本環境から到達できないため、Summary table の
 * `deathEvents` と fights の `phaseTransitions` の形 (v2 スキーマ / 実装例
 * から確認したフィールド名) に対する契約検証という位置づけ。
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const SRC = "src/lib/fflogs-fight-detail.ts";

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

const outDir = mkdtempSync(join(tmpdir(), "fight-detail-check-"));
try {
  execFileSync(
    "npx",
    [
      "tsc",
      SRC,
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
  const m = await import(
    pathToFileURL(join(outDir, "fflogs-fight-detail.js")).href
  );

  // fight はレポート開始から 1,000,000ms に始まり 8 分 (480,000ms) 続いた。
  const START = 1_000_000;
  const END = 1_480_000;

  console.log("\n[時刻の正規化]");
  check("レポート相対 → pull 相対", m.toFightRelativeMs(1_120_000, START, END), 120_000);
  check("既に pull 相対ならそのまま", m.toFightRelativeMs(120_000, START, END), 120_000);
  check("終了直後 (余白内) は許容", m.toFightRelativeMs(END + 3_000, START, END), 483_000);
  check("範囲外は捨てる", m.toFightRelativeMs(5_000_000, START, END), null);
  check("開始直前 (余白内) は 0 に丸める", m.toFightRelativeMs(START - 2_000, START, END), 0);

  console.log("\n[死亡イベントの抽出]");
  const deaths = m.extractDeathEvents(
    [
      { name: "Alice", icon: "WhiteMage", type: "WhiteMage", deathTime: START + 200_000, ability: { name: "アク・モーン", guid: 1 } },
      { name: "Bob", icon: "Paladin", deathTime: START + 195_000, ability: { name: "アク・モーン" } },
      { name: "Carol", type: "Dragoon", deathTime: START + 260_000, ability: { name: "エクサフレア" } },
      { name: "junk" },
      { deathTime: 99_999_999, icon: "Bard" },
    ],
    START,
    END,
  );
  check(
    "時刻順 / 名前は保存しない / 形が違う要素は捨てる",
    deaths,
    [
      { t: 195_000, job: "Paladin", ability: "アク・モーン" },
      { t: 200_000, job: "WhiteMage", ability: "アク・モーン", id: 1 },
      { t: 260_000, job: "Dragoon", ability: "エクサフレア" },
    ],
  );
  check("配列以外は空", m.extractDeathEvents(null, START, END), []);
  check(
    "guid 0 / 文字列の guid",
    m.extractDeathEvents(
      [
        { deathTime: START + 1_000, icon: "Bard", ability: { name: "Unknown", guid: 0 } },
        { deathTime: START + 2_000, icon: "Bard", ability: { name: "Akh Morn", guid: "26814" } },
      ],
      START,
      END,
    ),
    [
      { t: 1_000, job: "Bard", ability: "Unknown" },
      { t: 2_000, job: "Bard", ability: "Akh Morn", id: 26814 },
    ],
  );
  check(
    "表示名は日本語優先",
    [
      m.deathAbilityLabel({ ability: "Akh Morn", ja: "アク・モーン" }),
      m.deathAbilityLabel({ ability: "Akh Morn" }),
      m.deathAbilityLabel({ ability: null }),
    ],
    ["アク・モーン", "Akh Morn", null],
  );
  check(
    "ワイプ要約の技名も日本語優先",
    m.summarizeWipe(
      [{ t: 5_000, job: "Paladin", ability: "Akh Morn", id: 26814, ja: "アク・モーン" }],
      null,
      false,
    ).ability,
    "アク・モーン",
  );

  console.log("\n[フェーズ遷移の正規化]");
  const transitions = m.normalizePhaseTransitions(
    [
      { id: 2, startTime: START + 130_000 },
      { id: 1, startTime: START },
      { id: 2, startTime: START + 130_000 },
      { id: 3, startTime: START + 300_000 },
    ],
    START,
    END,
  );
  check("昇順 + 同 ID 連続は畳む", transitions, [
    { id: 1, t: 0 },
    { id: 2, t: 130_000 },
    { id: 3, t: 300_000 },
  ]);
  check(
    "先頭が 0 でなければ前フェーズを補う",
    m.normalizePhaseTransitions([{ id: 2, startTime: START + 90_000 }], START, END),
    [
      { id: 1, t: 0 },
      { id: 2, t: 90_000 },
    ],
  );
  check(
    "先頭 ID が 1 で 0 から始まらないなら 0 に寄せる",
    m.normalizePhaseTransitions([{ id: 1, startTime: START + 500 }], START, END),
    [{ id: 1, t: 0 }],
  );
  check("空 / 非配列は null", m.normalizePhaseTransitions([], START, END), null);
  check("非配列は null", m.normalizePhaseTransitions(undefined, START, END), null);

  console.log("\n[滞在区間]");
  check("区間の長さ", m.phaseSpans(transitions, END - START), [
    { id: 1, start: 0, dur: 130_000 },
    { id: 2, start: 130_000, dur: 170_000 },
    { id: 3, start: 300_000, dur: 180_000 },
  ]);
  check(
    "戦闘時間を超える遷移は切り詰める",
    m.phaseSpans([{ id: 1, t: 0 }, { id: 2, t: 600_000 }], 480_000),
    [{ id: 1, start: 0, dur: 480_000 }],
  );
  check("null は null", m.phaseSpans(null, 100), null);
  check("時刻 → フェーズ", m.phaseAt(transitions, 200_000), 2);
  check("時刻 → フェーズ (境界)", m.phaseAt(transitions, 300_000), 3);
  check("遷移なし → null", m.phaseAt(null, 10), null);

  console.log("\n[ワイプ要約]");
  const wipe = m.summarizeWipe(deaths, transitions, false);
  check("最初の死亡 + 10 秒以内クラスタ + フェーズ", wipe, {
    t: 195_000,
    job: "Paladin",
    ability: "アク・モーン",
    cluster: 2,
    total: 3,
    phase: 2,
  });
  check("kill は null", m.summarizeWipe(deaths, transitions, true), null);
  check("死亡 0 は null", m.summarizeWipe([], null, false), null);
  check("未取得は null", m.summarizeWipe(null, null, false), null);
  check("表示ラベル", m.formatWipeLabel(wipe), "PLD ← アク・モーン +1");
  check(
    "技名不明のラベル",
    m.formatWipeLabel({ t: 0, job: "Unknown Job", ability: null, cluster: 1, total: 1, phase: null }),
    "UNK ← 不明",
  );
  check(
    "技名不明のラベル (en)",
    m.formatWipeLabel(
      { t: 0, job: "Unknown Job", ability: null, cluster: 2, total: 3, phase: null },
      "en",
    ),
    "UNK ← Unknown +1",
  );
  check("locale 省略時は日本語", m.formatWipeLabel(wipe, "ja"), "PLD ← アク・モーン +1");

  console.log("\n[ジョブ略称]");
  check("既知", m.jobAbbr("Pictomancer"), "PCT");
  check("スペース入り", m.jobAbbr("Dark Knight"), "DRK");
  check("null", m.jobAbbr(null), "—");

  console.log("\n[集計]");
  const w = (ability, phase = null) => ({ t: 0, job: null, ability, cluster: 1, total: 1, phase });
  check(
    "技名で数え多い順 (同数は名前順)",
    m.wipeCauseCounts([w("B"), w("A"), null, w("B"), w(null), undefined]),
    [
      { ability: "B", count: 2 },
      { ability: "A", count: 1 },
      { ability: "不明", count: 1 },
    ],
  );
  check("上限", m.wipeCauseCounts([w("A"), w("B"), w("C")], 2).length, 2);
  check(
    "技名不明は locale で「Unknown」",
    m.wipeCauseCounts([w(null), w(null), w("A")], 5, "en"),
    [
      { ability: "Unknown", count: 2 },
      { ability: "A", count: 1 },
    ],
  );
  const totals = m.phaseTimeTotals([
    [{ id: 1, start: 0, dur: 100 }, { id: 2, start: 100, dur: 300 }],
    null,
    [{ id: 1, start: 0, dur: 100 }],
  ]);
  check("フェーズ合計と割合", totals, [
    { id: 1, ms: 200, share: 0.4 },
    { id: 2, ms: 300, share: 0.6 },
  ]);
  check("区間なしは空", m.phaseTimeTotals([null, undefined]), []);

  console.log("\n[書式]");
  check("m:ss", m.formatMs(125_400), "2:05");
  check("h:mm:ss", m.formatMs(3_725_000), "1:02:05");
  check("負値は 0", m.formatMs(-5), "0:00");
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
