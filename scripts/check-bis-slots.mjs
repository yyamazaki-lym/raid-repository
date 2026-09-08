/**
 * BiS の部位別進捗 (src/lib/bis-slots.ts) の検証 (2026-09-07、W-23)。
 * 実行: `node scripts/check-bis-slots.mjs`
 *
 * 分母 (数える部位数) がジョブで変わるところが唯一のややこしさ。
 * 「11/12 で完成しない」「12/11 になる」の両方を固定する。
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
  if (a === e) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${name}\n       expected: ${e}\n       actual:   ${a}`);
  }
}

const outDir = mkdtempSync(join(tmpdir(), "bis-slots-check-"));
try {
  execFileSync(
    process.execPath,
    ["node_modules/typescript/bin/tsc", "src/lib/bis-slots.ts", "src/lib/xivgear-set.ts",
     "--outDir", outDir, "--target", "es2022", "--module", "es2022",
     "--moduleResolution", "bundler", "--strict"],
    { stdio: "inherit" },
  );
  for (const f of readdirSync(outDir)) {
    if (!f.endsWith(".js")) continue;
    const fp = join(outDir, f);
    writeFileSync(
      fp,
      readFileSync(fp, "utf8").replace(
        /(from\s+["'])(\.\.?\/[^"']+?)(?<!\.js)(["'])/g,
        "$1$2.js$3",
      ),
    );
  }
  const { bisSlotsForJob, bisSlotLabel, bisProgress, bisProgressToneClass } =
    await import(pathToFileURL(join(outDir, "bis-slots.js")).href);

  console.log("数える部位");
  check("ナイトは 12 部位 (盾を含む)", bisSlotsForJob("PLD").length, 12);
  check("ナイトに OffHand が入る", bisSlotsForJob("PLD").includes("OffHand"), true);
  check("小文字でも判定する", bisSlotsForJob("pld").length, 12);
  check("他ジョブは 11 部位", bisSlotsForJob("WHM").length, 11);
  check("他ジョブに OffHand は無い", bisSlotsForJob("WHM").includes("OffHand"), false);
  // ジョブ不明は 11 に倒す (分母を大きく見せて「埋まっていない」と誤認させない)。
  check("ジョブ不明は 11 部位", bisSlotsForJob(null).length, 11);
  check("undefined も 11 部位", bisSlotsForJob(undefined).length, 11);
  check("空文字も 11 部位", bisSlotsForJob("").length, 11);

  console.log("\n部位ラベル");
  check("日本語", bisSlotLabel("Body"), "胴");
  check("指輪", bisSlotLabel("RingLeft"), "指輪(左)");
  check("英語は略称のまま", bisSlotLabel("Body", "en"), "Body");

  console.log("\n進捗");
  const none = bisProgress("WHM", []);
  check("何も取っていない", [none.obtained, none.total, none.percent], [0, 11, 0]);
  check("残りは全部位", none.remaining.length, 11);

  const some = bisProgress("WHM", ["Weapon", "Head", "Body"]);
  check("3 部位", [some.obtained, some.total], [3, 11]);
  check("百分率は四捨五入", some.percent, 27);
  check("残りは 8 部位", some.remaining.length, 8);
  check("残りに取得済みは含まない", some.remaining.includes("Weapon"), false);

  const full = bisProgress("WHM", [
    "Weapon", "Head", "Body", "Hand", "Legs", "Feet",
    "Ears", "Neck", "Wrist", "RingLeft", "RingRight",
  ]);
  check("11 部位で完成", [full.obtained, full.total, full.percent], [11, 11, 100]);
  check("完成なら残りは空", full.remaining, []);

  // ここが肝: 他ジョブで OffHand を取得済みにしても分母・分子に入らない
  // (ジョブを後から変えたときに「12/11 取得」にならない)。
  const bogus = bisProgress("WHM", ["OffHand", "Weapon"]);
  check("数えない部位は無視する", [bogus.obtained, bogus.total], [1, 11]);
  // 逆に、ナイトは 11 部位そろっても盾が無ければ完成ではない。
  const pldNoShield = bisProgress("PLD", [
    "Weapon", "Head", "Body", "Hand", "Legs", "Feet",
    "Ears", "Neck", "Wrist", "RingLeft", "RingRight",
  ]);
  check(
    "ナイトは盾が無いと完成しない",
    [pldNoShield.obtained, pldNoShield.total],
    [11, 12],
  );
  check("残りは盾だけ", pldNoShield.remaining, ["OffHand"]);
  // 未知の部位名 (DB を手で触った等) も分子に混ぜない。
  check("未知の部位名は無視", bisProgress("WHM", ["Nope"]).obtained, 0);

  console.log("\n進捗バッジの色 (3 段階)");
  check(
    "完成は emerald",
    bisProgressToneClass(full),
    "border-emerald-400/45 bg-emerald-400/10 text-emerald-200",
  );
  check(
    "半分以上は amber",
    bisProgressToneClass(bisProgress("WHM", ["Weapon","Head","Body","Hand","Legs","Feet"])),
    "border-amber-400/45 bg-amber-400/10 text-amber-200",
  );
  check(
    "半分未満は無彩色",
    bisProgressToneClass(some),
    "border-border/50 bg-secondary/30 text-muted-foreground",
  );
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
