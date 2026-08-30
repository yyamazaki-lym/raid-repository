/**
 * ウェイマークプリセット検品の検証 (2026-08-30、Tier2-7)。
 * 実行: `node scripts/check-waymark-preset.mjs`
 *
 * 誤警告 (正常なプリセットに「要確認」を出す) は信頼を失うので、
 * 正常系が静かであることを重点的に確認する。
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const SRC = "src/lib/waymark-preset.ts";

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

const outDir = mkdtempSync(join(tmpdir(), "waymark-check-"));
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
  const mod = await import(
    pathToFileURL(join(outDir, "waymark-preset.js")).href
  );

  /** 実在形式に近い正常プリセット (アリーナ中心付近、高さほぼ一定)。 */
  const normal = JSON.stringify({
    Name: "M12S P2",
    MapID: 1007,
    A: { X: 100, Y: 0, Z: 80, ID: 0, Active: true },
    B: { X: 120, Y: 0, Z: 100, ID: 1, Active: true },
    C: { X: 100, Y: 0, Z: 120, ID: 2, Active: true },
    D: { X: 80, Y: 0, Z: 100, ID: 3, Active: true },
    One: { X: 90, Y: 0, Z: 90, ID: 4, Active: true },
    Two: { X: 110, Y: 0, Z: 90, ID: 5, Active: true },
    Three: { X: 110, Y: 0, Z: 110, ID: 6, Active: true },
    Four: { X: 90, Y: 0, Z: 110, ID: 7, Active: true },
  });

  console.log("\n[正常系は静かであること]");
  const okCheck = mod.checkWaymarkPreset(normal);
  check("正常なプリセットは valid", okCheck.kind, "valid");
  check("Active 8 点", okCheck.info.activeCount, 8);
  check("名前を拾う", okCheck.info.name, "M12S P2");
  check("MapID を拾う", okCheck.info.mapId, 1007);
  check("警告は出ない", okCheck.info.warnings, []);

  // 負の絶対座標を持つマップ (Z=-693 のような実例) でも警告しない。
  const negative = JSON.stringify({
    A: { X: 24.7, Y: -24, Z: -693.3, Active: true },
    B: { X: 34.7, Y: -24, Z: -683.3, Active: true },
    C: { X: 24.7, Y: -24, Z: -673.3, Active: true },
    D: { X: 14.7, Y: -24, Z: -683.3, Active: true },
  });
  const negCheck = mod.checkWaymarkPreset(negative);
  check("負の絶対座標でも valid", negCheck.kind, "valid");
  check("負の絶対座標でも警告なし", negCheck.info.warnings, []);

  console.log("\n[異常系を拾えること]");
  const spread = mod.checkWaymarkPreset(
    JSON.stringify({
      A: { X: 0, Y: 0, Z: 0, Active: true },
      B: { X: 900, Y: 0, Z: 0, Active: true },
    }),
  );
  check("極端に広がった配置は警告", spread.info.warnings.length, 1);
  const airborne = mod.checkWaymarkPreset(
    JSON.stringify({
      A: { X: 0, Y: 0, Z: 0, Active: true },
      B: { X: 10, Y: 500, Z: 10, Active: true },
    }),
  );
  check("空中設置は警告", airborne.info.warnings.length, 1);

  console.log("\n[判定不能なものは黙る]");
  check(
    "ただのメモは not-json",
    mod.checkWaymarkPreset("北を D1 に合わせる").kind,
    "not-json",
  );
  check(
    "共有 URL は not-json (別扱い)",
    mod.checkWaymarkPreset("https://sourpuh.github.io/waymarkstudio?preset=wms1.abc")
      .kind,
    "not-json",
  );
  check(
    "壊れた JSON は not-json",
    mod.checkWaymarkPreset('{"A":{"X":1,').kind,
    "not-json",
  );
  check(
    "マーカーの無い JSON は unknown-json",
    mod.checkWaymarkPreset('{"foo":1}').kind,
    "unknown-json",
  );
  check(
    "非アクティブのみでも形式は valid",
    mod.checkWaymarkPreset(
      JSON.stringify({ A: { X: 0, Y: 0, Z: 0, Active: false } }),
    ).info.activeCount,
    0,
  );

  console.log("\n[簡易プレビューのレイアウト]");
  // 正方形に 4 点 (A 北西 / B 北東 / C 南東 / D 南西)。X 横・Z 縦、北が上。
  const square = mod.checkWaymarkPreset(
    JSON.stringify({
      A: { X: 90, Y: 0, Z: 90, Active: true },
      B: { X: 110, Y: 0, Z: 90, Active: true },
      C: { X: 110, Y: 0, Z: 110, Active: true },
      D: { X: 90, Y: 0, Z: 110, Active: true },
    }),
  );
  const layout = mod.buildWaymarkLayout(square.info.points);
  const at = (k) => layout.find((p) => p.key === k);
  check("Active な点だけ返す", layout.length, 4);
  check("A は左上", [at("A").nx, at("A").ny], [0, 0]);
  check("B は右上", [at("B").nx, at("B").ny], [1, 0]);
  check("C は右下", [at("C").nx, at("C").ny], [1, 1]);
  check("D は左下", [at("D").nx, at("D").ny], [0, 1]);
  check("ラベルは 1-4 に変換", at("A").label, "A");

  // 数字マーカーのラベル変換 (One → 1)。
  const numbered = mod.checkWaymarkPreset(
    JSON.stringify({
      One: { X: 0, Y: 0, Z: 0, Active: true },
      Four: { X: 10, Y: 0, Z: 0, Active: true },
    }),
  );
  const nlayout = mod.buildWaymarkLayout(numbered.info.points);
  check(
    "One / Four は 1 / 4 と表示",
    nlayout.map((p) => p.label),
    ["1", "4"],
  );

  // 縦横比を保つ: 横長の配置で縦が潰れきらないこと。
  const wide = mod.buildWaymarkLayout({
    A: { x: 0, y: 0, z: 0, active: true },
    B: { x: 100, y: 0, z: 10, active: true },
  });
  check("広い辺を基準に正規化 (横は 0→1)", [wide[0].nx, wide[1].nx], [0, 1]);
  check(
    "縦は潰さず縮尺を共有 (0.45 / 0.55)",
    [Number(wide[0].ny.toFixed(2)), Number(wide[1].ny.toFixed(2))],
    [0.45, 0.55],
  );

  // 退化ケース: 全点同一座標でも 0 除算しない。
  const same = mod.buildWaymarkLayout({
    A: { x: 5, y: 0, z: 5, active: true },
    B: { x: 5, y: 0, z: 5, active: true },
  });
  check("同一座標は中央に寄せる", [same[0].nx, same[0].ny], [0.5, 0.5]);
  check(
    "非アクティブは描画対象外",
    mod.buildWaymarkLayout({ A: { x: 0, y: 0, z: 0, active: false } }).length,
    0,
  );

  console.log("\n[Waymark Studio URL の判定]");
  check(
    "共有 URL を認識",
    mod.isWaymarkStudioUrl(
      "https://sourpuh.github.io/waymarkstudio?preset=wms1.abcdef",
    ),
    true,
  );
  check(
    "別ホストは false",
    mod.isWaymarkStudioUrl("https://example.com/waymarkstudio?preset=x"),
    false,
  );
  check("JSON は false", mod.isWaymarkStudioUrl(normal), false);
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

console.log("");
if (failures > 0) {
  console.error(`${failures} 件失敗`);
  process.exit(1);
}
console.log("すべて成功");
