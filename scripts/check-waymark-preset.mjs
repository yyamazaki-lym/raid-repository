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
