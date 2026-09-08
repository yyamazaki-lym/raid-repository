/**
 * 死亡の直前 (src/lib/logs/death-leadup.ts) の検証 (2026-09-08、W-8)。
 * 実行: `node scripts/check-death-leadup.mjs`
 *
 * FFLogs の実 API はこの環境から叩けないため、`events(dataType: Deaths,
 * includeResources: true)` のレスポンス形 (v2 スキーマ / 実装例から確認した
 * フィールド名) に対する契約検証という位置づけ。固定したいのは:
 *
 *   1. timestamp が **レポート相対** で来るので pull 相対に直すこと
 *      (直さないと「開始 0:00 に全員死亡」になる)
 *   2. 資源が `targetResources` / `sourceResources` のどちらでも読めること
 *   3. **ダメージダウン (1002911) の判定** が効いていること
 *   4. 範囲外のイベントを捨てること (別 pull の混入)
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

const outDir = mkdtempSync(join(tmpdir(), "death-leadup-check-"));
try {
  execFileSync(
    process.execPath,
    [
      "node_modules/typescript/bin/tsc",
      "src/lib/logs/death-leadup.ts",
      "--outDir", outDir,
      "--target", "es2022",
      "--module", "es2022",
      "--moduleResolution", "bundler",
      "--strict",
    ],
    { stdio: "inherit" },
  );
  const m = await import(pathToFileURL(join(outDir, "death-leadup.js")).href);

  const START = 1_000_000;
  const END = 1_480_000;

  const parsed = m.parseDeathLeadUp(
    {
      data: [
        {
          timestamp: START + 200_000,
          icon: "WhiteMage",
          ability: { name: "アク・モーン", guid: 1 },
          targetResources: {
            hitPoints: 0,
            maxHitPoints: 120_000,
            absorb: 0,
            auras: [
              { ability: 1001203, name: "堅陣", stacks: 1 },
              { ability: 1002911, name: "ダメージダウン" },
              { ability: 1001203, name: "堅陣" },
            ],
          },
        },
        {
          // 資源が sourceResources 側に来るケース。
          timestamp: START + 100_000,
          type: "Paladin",
          ability: { name: "エクサフレア" },
          sourceResources: {
            hitPoints: 4_500,
            maxHitPoints: 150_000,
            absorb: 2_000,
            auras: [{ abilityGameID: 1001191, name: "インビンシブル" }],
          },
        },
        // 別 pull の混入 (範囲外)。
        { timestamp: 9_000_000, icon: "Bard" },
        // 形が違う要素。
        { icon: "Bard" },
        null,
      ],
    },
    START,
    END,
  );

  console.log("\n[時刻と並び]");
  check(
    "レポート相対 → pull 相対 / 時刻昇順 / 範囲外を捨てる",
    parsed.map((d) => [d.t, d.job]),
    [
      [100_000, "Paladin"],
      [200_000, "WhiteMage"],
    ],
  );

  console.log("\n[資源]");
  check(
    "targetResources から HP / シールド",
    [parsed[1].hp, parsed[1].maxHp, parsed[1].shield],
    [0, 120_000, 0],
  );
  check(
    "sourceResources でも読める",
    [parsed[0].hp, parsed[0].maxHp, parsed[0].shield],
    [4_500, 150_000, 2_000],
  );

  console.log("\n[効果]");
  check(
    "重複を畳んで名前のまま並べる",
    parsed[1].auras.map((a) => [a.id, a.name]),
    [
      [1001203, "堅陣"],
      [1002911, "ダメージダウン"],
    ],
  );
  check(
    "ダメージダウンの判定",
    [parsed[1].damageDown, parsed[0].damageDown],
    [true, false],
  );
  check("ID は定数で持つ", m.DAMAGE_DOWN_ABILITY_ID, 1002911);

  console.log("\n[入力の形]");
  check("素の配列", m.parseDeathLeadUp([{ timestamp: START, icon: "Bard" }], START, END).length, 1);
  check(
    "events.data の入れ子",
    m.parseDeathLeadUp({ events: { data: [{ timestamp: START, icon: "Bard" }] } }, START, END).length,
    1,
  );
  check("配列でなければ空", m.parseDeathLeadUp(null, START, END), []);
  check("data が無ければ空", m.parseDeathLeadUp({ foo: 1 }, START, END), []);

  console.log("\n[書式]");
  check("HP と割合", m.formatLeadUpHp(4_500, 150_000), "4500 / 150000 (3%)");
  check("max 不明なら実数だけ", m.formatLeadUpHp(4_500, null), "4500");
  check("HP 不明なら null", m.formatLeadUpHp(null, 150_000), null);
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
