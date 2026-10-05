/**
 * 動画のチャプター (2026-10-05、F-6 の C-2) の検証。
 * 実行: `node scripts/check-video-chapters.mjs`
 *
 * 練習ログの pull と動画のオフセットから、YouTube の説明欄に貼るとチャプター
 * になる文字を作る (`src/lib/video-chapters.ts`)。YouTube の決まり (最初は 0:00 /
 * 3 つ以上 / それぞれ 10 秒以上) を満たすこと、時刻が pull 行のリンクと同じ式で
 * 出ること、名前が日の行の番号と合うことを固定する。
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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
const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

const outDir = mkdtempSync(join(tmpdir(), "video-chapters-check-"));
try {
  execFileSync(
    process.execPath,
    [
      "node_modules/typescript/bin/tsc", "src/lib/video-chapters.ts",
      "--outDir", outDir, "--rootDir", "src/lib",
      "--target", "es2022", "--module", "es2022", "--moduleResolution", "bundler", "--strict",
    ],
    { stdio: "inherit" },
  );
  for (const f of readdirSync(outDir)) {
    if (!f.endsWith(".js")) continue;
    const fp = join(outDir, f);
    writeFileSync(fp, readFileSync(fp, "utf8").replace(/(from\s+["'])(\.\.?\/[^"']+?)(?<!\.js)(["'])/g, "$1$2.js$3"));
  }
  const vc = await import(pathToFileURL(join(outDir, "video-chapters.js")).href);
  const prog = await import(pathToFileURL(join(outDir, "fflogs-progress.js")).href);
  const { chapterPullLabel, buildYoutubeChapters, YOUTUBE_CHAPTER_MIN_SECONDS, YOUTUBE_CHAPTER_MIN_COUNT } = vc;

  console.log("pull の名前");
  const fight = (o) => ({
    reportCode: "R", fightId: 1, sessionDate: null, name: null, kill: false,
    fightPercentage: 42.04, lastPhase: null, encounterId: 101, difficulty: null,
    partyDps: null, deaths: null, wipe: null, phases: null, startMs: 0, endMs: 0, reportStartMs: null, ...o,
  });
  const tierFights = [101, 102, 103, 104].map((e) => fight({ encounterId: e }));
  const floors = prog.buildFloorMap(tierFights, 4, "ja");
  check("零式: #回数 層 残%", chapterPullLabel(fight({}), 3, floors, false, "ja"), "#3 1層 残42.0%");
  check("最終層の討伐は CLEAR", chapterPullLabel(fight({ encounterId: 104, kill: true, fightPercentage: 0 }), 9, floors, false, "ja"), "#9 4層 CLEAR");
  // pull 行の結果チップと同じく、討伐は層を問わず CLEAR (残0% にしない)
  check("下の層の討伐も CLEAR", chapterPullLabel(fight({ encounterId: 102, kill: true, fightPercentage: 0 }), 2, floors, false, "ja"), "#2 2層 CLEAR");
  // 層の名前は FloorMap を作った時の言語 (画面は表示言語で作る)
  const floorsEn = prog.buildFloorMap(tierFights, 4, "en");
  check("英語", chapterPullLabel(fight({}), 3, floorsEn, false, "en"), `#3 ${prog.floorLabel(floorsEn, 1, "en")} 42.0% left`);
  check("絶: フェーズ", chapterPullLabel(fight({ lastPhase: 5, encounterId: 9001 }), 7, null, true, "ja"), "#7 P5 残42.0%");
  check("絶の討伐", chapterPullLabel(fight({ lastPhase: 5, kill: true, fightPercentage: 0 }), 8, null, true, "ja"), "#8 P5 CLEAR");
  check("残% が無ければ省く", chapterPullLabel(fight({ fightPercentage: null }), 2, floors, false, "ja"), "#2 1層");

  console.log("\nYouTube の決まり");
  check("最低 10 秒 / 3 つ", [YOUTUBE_CHAPTER_MIN_SECONDS, YOUTUBE_CHAPTER_MIN_COUNT], [10, 3]);
  const T0 = Date.parse("2026-10-05T12:00:00Z");
  const p = (sec, label) => ({ startMs: T0 + sec * 1000, label });
  // 録画開始が pull #1 の 120 秒前 (オフセット 120)
  check(
    "0:00 に開始前、以降は pull ごと (並びは時刻順に直す)",
    buildYoutubeChapters([p(300, "#2"), p(0, "#1"), p(900, "#3")], 120, T0, "開始前"),
    ["0:00 開始前", "2:00 #1", "7:00 #2", "17:00 #3"],
  );
  check(
    "10 秒未満で次の pull が始まったら前にまとめる",
    buildYoutubeChapters([p(0, "#1"), p(5, "#2"), p(300, "#3"), p(600, "#4")], 120, T0, "開始前"),
    ["0:00 開始前", "2:00 #1", "7:00 #3", "12:00 #4"],
  );
  check(
    "最初の pull が 10 秒未満なら 0:00 にずらす (開始前を置かない)",
    buildYoutubeChapters([p(0, "#1"), p(300, "#2"), p(600, "#3")], 4, T0, "開始前"),
    ["0:00 #1", "5:04 #2", "10:04 #3"],
  );
  check(
    "録画開始より前の pull は外す (オフセットが負)",
    buildYoutubeChapters([p(0, "#1"), p(100, "#2"), p(400, "#3"), p(700, "#4")], -150, T0, "開始前"),
    ["0:00 開始前", "4:10 #3", "9:10 #4"],
  );
  check(
    "秒は切り捨て (pull 行のリンク buildVideoTimestampUrl と同じ)",
    buildYoutubeChapters([p(0, "#1"), p(300.9, "#2"), p(600.5, "#3")], 120, T0, "開始前"),
    ["0:00 開始前", "2:00 #1", "7:00 #2", "12:00 #3"],
  );
  check("3 つに満たなければ作らない", buildYoutubeChapters([p(0, "#1"), p(300, "#2")], 4, T0, "開始前"), null);
  check("映っている pull が無ければ作らない", buildYoutubeChapters([p(0, "#1")], -9999, T0, "開始前"), null);
  check("pull が無ければ作らない", buildYoutubeChapters([], 0, T0, "開始前"), null);
  check(
    "1 時間を超えたら H:MM:SS",
    buildYoutubeChapters([p(0, "#1"), p(1800, "#2"), p(3600, "#3")], 120, T0, "開始前")?.at(-1),
    "1:02:00 #3",
  );
  const lines = buildYoutubeChapters([p(0, "#1"), p(12, "#2"), p(30, "#3"), p(45, "#4")], 0, T0, "開始前");
  const secs = lines.map((l) => l.split(" ")[0].split(":").reduce((a, b) => a * 60 + Number(b), 0));
  check("隣り合うチャプターはどれも 10 秒以上離れる", secs.slice(1).every((s, i) => s - secs[i] >= 10), true);
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

console.log("\n配線");
const mod = read("src/lib/video-chapters.ts");
check("時刻は pull 行のリンクと同じ式 (videoSecondsForPull)", /videoSecondsForPull\(offsetSeconds, p\.startMs, firstPullStartMs\)/.test(mod), true);
check("映っていない判定も同じ関数 (isBeforeVideoStart)", /!isBeforeVideoStart\(p\.seconds\)/.test(mod), true);
const day = read("src/components/portal/logs/day-row.tsx");
check("日の行: 番号は日の行と同じ (day.fights の並び + 1)", /day\.fights\s*\.map\(\(f, i\) => \(\{ f, index: i \+ 1 \}\)\)\s*\.filter\(\(x\) => x\.f\.reportCode === code\)/.test(day), true);
check("日の行: pull #1 は画面と同じ (firstPullStartByReport)", /const first = firstPullStartByReport\.get\(code\);/.test(day), true);
check("日の行: その動画のオフセットで作る", /buildYoutubeChapters\(pulls, video\.offsetSeconds, first, m\.logs\.chaptersIntro\)/.test(day), true);
// ボタンは動画チップと同じ map の中 (チップのすぐ右) に置き、名前も同じ変数を使う
const chipLoop = day.match(/\{links\.map\(\(v, i\) => \{\n\s*const name = videoName\(v, m\.logs\.videoNth\(i \+ 1\)\);[\s\S]*?\n\s*\}\)\}/)?.[0] ?? "";
check("日の行: 動画チップの名前は 1 か所で決める", chipLoop.length > 0, true);
check("日の行: チップと同じ名前を出す", /\{name\}/.test(chipLoop), true);
check("日の行: ボタンはチップのすぐ右 (同じ map の中)", /copyChapters\(code, v\)/.test(chipLoop), true);
check("日の行: ボタンの説明にもチップと同じ名前", /title=\{m\.logs\.chaptersTitle\(name\)\}/.test(chipLoop), true);
check("日の行: ボタンは YouTube の動画だけ", /\{v\.videoUrl && parseYouTubeId\(v\.videoUrl\) && \(/.test(chipLoop), true);

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
