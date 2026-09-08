/**
 * メンバーのロール (src/lib/member-roles.ts) の検証 (2026-09-08、UI-4)。
 * 実行: `node scripts/check-member-roles.mjs`
 *
 * 固定したいのは 3 点:
 *   1. 名前の比較が催促 / 出席突合と同じ正規化 (全角英数 / 空白 / 大小文字)
 *   2. **同名が 2 人でロールが違うならどちらにも決めない** (取り違えて
 *      他人の列を「自分のロール」に混ぜない)
 *   3. **自分のロールが分からないときは絞らない** (空の表を出すより
 *      全部見せる方が害が小さい)
 *
 * ⚠ tsc は `process.execPath` + `node_modules/typescript/bin/tsc` で起動する
 *   (`npx` 経由は Windows で ENOENT / EINVAL になり、CI の ubuntu では
 *   通るので壊れていることに気付けない)。
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
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

const outDir = mkdtempSync(join(tmpdir(), "member-roles-check-"));
try {
  execFileSync(
    process.execPath,
    [
      "node_modules/typescript/bin/tsc",
      "src/lib/member-roles.ts",
      "--outDir", outDir,
      "--target", "es2022",
      "--module", "es2022",
      "--moduleResolution", "bundler",
      "--strict",
    ],
    { stdio: "inherit" },
  );
  // ⚠ 出力は入れ子になる (このモジュールが `./schedule/...` を import する
  // ため)。**再帰で** 拡張子を補う — 直下だけだと入れ子側の import が
  // ERR_MODULE_NOT_FOUND になる (実際に踏んだ)。
  const fixExtensions = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const fp = join(dir, e.name);
      if (e.isDirectory()) {
        fixExtensions(fp);
        continue;
      }
      if (!e.name.endsWith(".js")) continue;
      writeFileSync(fp, readFileSync(fp, "utf8").replace(
        /(from\s+["'])(\.\.?\/[^"']+?)(?<!\.js)(["'])/g, "$1$2.js$3"));
    }
  };
  fixExtensions(outDir);
  // 入れ子出力になるので、このモジュールは `src/lib` 相当の位置に出る。
  const m = await import(pathToFileURL(join(outDir, "member-roles.js")).href);

  console.log("\n[語彙]");
  check(
    "3 値だけ",
    [m.isMemberRole("tank"), m.isMemberRole("healer"), m.isMemberRole("dps"), m.isMemberRole("mt")],
    [true, true, true, false],
  );
  check("ロール一覧", m.MEMBER_ROLES, ["tank", "healer", "dps"]);

  console.log("\n[対応表]");
  const roleByName = m.buildRoleByName([
    { displayName: "あかね", role: "tank" },
    { displayName: "Biwa Sato", role: "healer" },
    { displayName: "ちとせ", role: null },
    { displayName: "だいご", role: "invalid" },
  ]);
  check("ロール未設定 / 不正値は載らない", Object.keys(roleByName).length, 2);
  check("引ける", m.roleOfName(roleByName, "あかね"), "tank");
  check(
    "全角英数 / 空白 / 大小文字を吸収",
    m.roleOfName(roleByName, "ｂｉｗａ　ＳＡＴＯ"),
    "healer",
  );
  check("未登録は null", m.roleOfName(roleByName, "だれか"), null);
  check("空名前は null", m.roleOfName(roleByName, "  "), null);

  console.log("\n[同名]");
  const dup = m.buildRoleByName([
    { displayName: "かぶり", role: "tank" },
    { displayName: "かぶり", role: "dps" },
  ]);
  check("同名でロールが違うならどちらにも決めない", m.roleOfName(dup, "かぶり"), null);
  const dupSame = m.buildRoleByName([
    { displayName: "かぶり", role: "tank" },
    { displayName: "かぶり", role: "tank" },
  ]);
  check("同名でロールが同じなら残す", m.roleOfName(dupSame, "かぶり"), "tank");

  console.log("\n[列の判定]");
  const same = (myName, columnName) =>
    m.isSameRoleColumn({ roleByName, myName, columnName });
  check("同じロールの列は残す", same("あかね", "あかね"), true);
  check("違うロールの列は落とす", same("あかね", "Biwa Sato"), false);
  check(
    "自分のロールが分からないなら絞らない",
    [same("ちとせ", "Biwa Sato"), same(null, "Biwa Sato"), same("だれか", "あかね")],
    [true, true, true],
  );
  check(
    "自分のロールは分かるが相手が未登録なら落とす",
    same("あかね", "ちとせ"),
    false,
  );
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
