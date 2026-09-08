/**
 * ジョブ表 (src/lib/jobs.ts) の検証 (L-8、2026-09-08)。
 * 実行: `node scripts/check-jobs.mjs`
 *
 * 見るのは 3 点:
 *   1. `JOB_ABBR` (fflogs-fight-detail.ts) との 1 対 1 対応が崩れていないか
 *      — 片方だけにジョブを足すと、ログの略称表示とジョブ選択が食い違う
 *   2. シートのジョブ名の行を当てられるか (日本語 / 英語 / 略称 / 全角)
 *   3. `アドル (赤魔道士)` 形の列ラベルからジョブを取り出せるか
 *
 * ⚠ tsc は `npx` 経由にしない (Windows で ENOENT / EINVAL になり、CI の
 * ubuntu では通るので壊れていることに気付けない)。
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
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

const outDir = mkdtempSync(join(tmpdir(), "jobs-check-"));
try {
  execFileSync(
    process.execPath,
    [
      "node_modules/typescript/bin/tsc",
      "src/lib/jobs.ts",
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
  // `@/` の相対化と拡張子付与 (他の検査スクリプトと同じ手当て)。
  const fixExtensions = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        fixExtensions(p);
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
  fixExtensions(outDir);

  const m = await import(pathToFileURL(join(outDir, "jobs.js")).href);

  console.log("\n[JOB_ABBR との対応]");
  check("不一致なし", m.jobTableMismatches(), []);
  check("22 ジョブ", m.JOBS.length, 22);
  check(
    "ロールの人数 (タンク 4 / ヒーラー 4 / DPS 14)",
    ["tank", "healer", "dps"].map(
      (r) => m.JOBS.filter((j) => j.role === r).length,
    ),
    [4, 4, 14],
  );
  check("キーの重複なし", new Set(m.JOBS.map((j) => j.key)).size, 22);
  check("略称の重複なし", new Set(m.JOBS.map((j) => j.abbr)).size, 22);
  check("日本語名の重複なし", new Set(m.JOBS.map((j) => j.ja)).size, 22);

  console.log("\n[キーの検証とロール]");
  check("既知のキー", [m.isJobKey("RedMage"), m.isJobKey("Rdm"), m.isJobKey(null)], [true, false, false]);
  check(
    "ロール導出",
    ["RedMage", "Paladin", "Sage", "Zombie"].map((k) => m.roleOfJob(k)),
    ["dps", "tank", "healer", null],
  );
  check(
    "表示名は locale で変わる",
    [m.jobLabel("RedMage", "ja"), m.jobLabel("RedMage", "en"), m.jobLabel("x")],
    ["赤魔道士", "Red Mage", null],
  );

  console.log("\n[表記からジョブを引く]");
  check("日本語名", m.jobFromText("赤魔道士")?.key ?? null, "RedMage");
  check("英語名 (大小無視)", m.jobFromText("red mage")?.key ?? null, "RedMage");
  check("略称", m.jobFromText("RDM")?.key ?? null, "RedMage");
  check("全角略称", m.jobFromText("ＲＤＭ")?.key ?? null, "RedMage");
  check("前後の空白", m.jobFromText("  忍者 ")?.key ?? null, "Ninja");
  // ⚠ 部分一致は取らない。誤爆の方が害が大きい。
  check("部分一致は当てない", m.jobFromText("戦")?.key ?? null, null);
  check("別語は当てない", m.jobFromText("歴戦")?.key ?? null, null);
  check("空 / null", [m.jobFromText(""), m.jobFromText(null)], [null, null]);

  console.log("\n[列ラベルからジョブを取り出す]");
  check("`名前 (ジョブ)`", m.jobFromColumnLabel("アドル (赤魔道士)")?.key ?? null, "RedMage");
  check("全角括弧", m.jobFromColumnLabel("牽制（忍者）")?.key ?? null, "Ninja");
  check("空白なし", m.jobFromColumnLabel("リプライザル(暗黒騎士)")?.key ?? null, "DarkKnight");
  check("括弧なし = ラベル全体", m.jobFromColumnLabel("白魔道士")?.key ?? null, "WhiteMage");
  check("ジョブが書かれていない", m.jobFromColumnLabel("牽制")?.key ?? null, null);
  check(
    "括弧が複数あれば末尾を採る",
    m.jobFromColumnLabel("鼓舞 (30%) (学者)")?.key ?? null,
    "Scholar",
  );
  check("空 / null", [m.jobFromColumnLabel(""), m.jobFromColumnLabel(null)], [null, null]);

  console.log("\n[列番号 -> ジョブ]");
  check(
    "読み取れた列だけ入る",
    m.buildColumnJobs({
      3: "アドル (赤魔道士)",
      5: "牽制",
      7: "リプライザル(暗黒騎士)",
      9: "",
    }),
    { 3: "RedMage", 7: "DarkKnight" },
  );
  check("空 / null", [m.buildColumnJobs({}), m.buildColumnJobs(null)], [{}, {}]);
} finally {
  // outDir は tmp なので残しても害は無いが、他の検査と同じく片付ける。
  const { rmSync } = await import("node:fs");
  rmSync(outDir, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
