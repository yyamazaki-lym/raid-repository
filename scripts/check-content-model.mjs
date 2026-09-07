/**
 * コンテンツの難易度 / 進行モデル (src/lib/content-model.ts) の検証
 * (2026-09-07、W-33 ①)。
 * 実行: `node scripts/check-content-model.mjs`
 *
 * 8.0「白銀のワンダラー」(2027-01) の新難易度は 2026-09 時点で正式名称が
 * 未発表なので、「名前が辞書に無いコンテンツ」が来ても表示が崩れないことを
 * 固定するのが主目的。既知の名前 (零式 / 絶) が従来どおり判定されることも
 * 同時に守る (回帰ガード)。
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const SRC = "src/lib/content-model.ts";

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

const outDir = mkdtempSync(join(tmpdir(), "content-model-check-"));
try {
  // content-model.ts は content-groups.ts を import するので両方コンパイルする。
  execFileSync(
    "npx",
    [
      "tsc", SRC, "src/lib/content-groups.ts",
      "--outDir", outDir,
      "--target", "es2022",
      "--module", "es2022",
      "--moduleResolution", "bundler",
      "--strict",
    ],
    { stdio: "inherit" },
  );
  // tsc は拡張子なしの相対 import を出すので Node ESM 向けに .js を付ける
  // (check-fflogs-category.mjs と同じ処理)。
  const { readdirSync, readFileSync, writeFileSync } = await import("node:fs");
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
  const mod = await import(pathToFileURL(join(outDir, "content-model.js")).href);
  const {
    isProgressModel,
    resolveProgressModel,
    resolveFloorCount,
    resolveDifficultyLabel,
    difficultyToneClass,
  } = mod;

  console.log("progress model の値域");
  check("auto は有効", isProgressModel("auto"), true);
  check("floors は有効", isProgressModel("floors"), true);
  check("phases は有効", isProgressModel("phases"), true);
  check("未知の値は無効", isProgressModel("ultimate"), false);
  check("null は無効", isProgressModel(null), false);

  console.log("\nauto = 名前から推測 (従来挙動の回帰ガード)");
  check("絶 → phases", resolveProgressModel("auto", "絶竜詩戦争"), "phases");
  check("絶オメガ → phases", resolveProgressModel("auto", "絶オメガ検証戦"), "phases");
  check("零式 → floors", resolveProgressModel("auto", "天獄編零式"), "floors");
  check("辺獄編 → floors", resolveProgressModel("auto", "万魔殿パンデモニウム辺獄編零式"), "floors");
  check("未指定 (null) も推測", resolveProgressModel(null, "絶竜詩戦争"), "phases");
  check("undefined も推測", resolveProgressModel(undefined, "天獄編零式"), "floors");

  console.log("\n名前が分からないものは floors に倒す (8.0 新難易度)");
  // 8.0 の新難易度は名称未発表。辞書に無い名前で登録されても、層表示に
  // 倒れて画面が成立することを保証する (「不明」状態を UI に持ち込まない)。
  check("未知の名前 → floors", resolveProgressModel("auto", "白銀のワンダラー新難易度"), "floors");
  check("空文字 → floors", resolveProgressModel("auto", ""), "floors");

  console.log("\n明示指定は名前より優先");
  check("絶でも floors 指定が勝つ", resolveProgressModel("floors", "絶竜詩戦争"), "floors");
  check("零式でも phases 指定が勝つ", resolveProgressModel("phases", "天獄編零式"), "phases");
  // これが W-33 の肝: 名前が辞書に無い新難易度でも、admin が phases を
  // 選べばフェーズ管理として表示できる。
  check(
    "未知の名前 + phases 指定",
    resolveProgressModel("phases", "8.0 新難易度 (仮)"),
    "phases",
  );

  console.log("\n層数の仮定");
  check("零式は 4 層を仮定", resolveFloorCount("auto", "天獄編零式"), 4);
  check("絶は層を仮定しない", resolveFloorCount("auto", "絶竜詩戦争"), null);
  check(
    "未知の名前は層数を決め打ちしない",
    resolveFloorCount("auto", "8.0 新難易度 (仮)"),
    null,
  );
  // floors を明示しても、零式と分からない名前なら層数は実データ任せ。
  // 4 を決め打ちすると 1 ボスのコンテンツで最終層判定 (= クリア数) が壊れる。
  check(
    "floors 明示 + 未知の名前 → null",
    resolveFloorCount("floors", "8.0 新難易度 (仮)"),
    null,
  );
  check("floors 明示 + 零式 → 4", resolveFloorCount("floors", "天獄編零式"), 4);
  check("phases 明示 → null", resolveFloorCount("phases", "天獄編零式"), null);

  console.log("\n難易度ラベル");
  check("明示があればそれ", resolveDifficultyLabel("新難易度 (仮)", "何か"), "新難易度 (仮)");
  check("前後の空白は落とす", resolveDifficultyLabel("  零式  ", "何か"), "零式");
  check("空なら名前から推測 (絶)", resolveDifficultyLabel("", "絶竜詩戦争"), "絶");
  check("空なら名前から推測 (零式)", resolveDifficultyLabel(null, "天獄編零式"), "零式");
  check("英語ロケール (絶)", resolveDifficultyLabel(null, "絶竜詩戦争", "en"), "Ultimate");
  check("英語ロケール (零式)", resolveDifficultyLabel(null, "天獄編零式", "en"), "Savage");
  check("推測できなければ null", resolveDifficultyLabel(null, "8.0 新難易度"), null);
  // 明示ラベルはロケールに関係なくそのまま出す (人が入れた文字列なので
  // 翻訳しようがない)。
  check(
    "明示ラベルは英語でもそのまま",
    resolveDifficultyLabel("新難易度 (仮)", "何か", "en"),
    "新難易度 (仮)",
  );

  console.log("\n難易度バッジの色");
  check(
    "絶は amber",
    difficultyToneClass("絶"),
    "border-amber-400/45 bg-amber-400/10 text-amber-200",
  );
  check("Ultimate も amber", difficultyToneClass("Ultimate"), difficultyToneClass("絶"));
  check(
    "零式は rose",
    difficultyToneClass("零式"),
    "border-rose-400/45 bg-rose-400/10 text-rose-200",
  );
  check("Savage も rose", difficultyToneClass("Savage"), difficultyToneClass("零式"));
  check("同じラベルは同じ色", difficultyToneClass("新難易度"), difficultyToneClass("新難易度"));
  check("null は無彩色", difficultyToneClass(null), "border-border/50 text-muted-foreground");
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
