/**
 * 出欠催促の二重送信防止 (src/lib/schedule/marker-claim.ts) の検証
 * (2026-10-01 監査 C-4)。
 * 実行: `node scripts/check-marker-claim.mjs`
 *
 * 催促は `app_settings` の 1 行に「送信済みの印」を持つ。以前は
 * 「印を読む → 送る → 印を書く」の順で、同じ分に 2 回起動されると両方が
 * 送っていた。ここでは次を固定する:
 *
 *   1. 2 つの実行が同時に印を取り合っても、取れるのは 1 つだけ
 *      (行が無い / 値が NULL / 古い印 / 同じ印 の 4 状態すべて)
 *   2. cron 経路は印を取ってから送り、送れなかったら自分の印だけを戻す
 *      (呼び出し側にしか書けない順序なので、ソースを読んで確かめる)
 *
 * 1 の偽の行は、条件の評価と書き換えを同じ同期ブロックで行う
 * (= Postgres の行ロックで条件付き UPDATE が直列化されるのと同じ)。
 * 各段の前に await を挟んで、2 実行が段の間で交互に進むようにしている。
 */
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
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

/** app_settings の 1 行の偽物。`row === undefined` は行が無い状態。 */
function fakeRow(initial) {
  const state = { row: initial };
  const tick = () => new Promise((r) => setImmediate(r));
  const opsFor = (marker) => ({
    replaceDifferent: async () => {
      await tick();
      if (state.row === undefined || state.row.value === null) return false;
      if (state.row.value === marker) return false;
      state.row = { value: marker };
      return true;
    },
    replaceNull: async () => {
      await tick();
      if (state.row === undefined || state.row.value !== null) return false;
      state.row = { value: marker };
      return true;
    },
    insertIfAbsent: async () => {
      await tick();
      if (state.row !== undefined) return false;
      state.row = { value: marker };
      return true;
    },
  });
  return { state, opsFor };
}

const outDir = mkdtempSync(join(tmpdir(), "marker-claim-check-"));
try {
  execFileSync(
    process.execPath,
    [
      "node_modules/typescript/bin/tsc",
      "src/lib/schedule/marker-claim.ts",
      "--outDir", outDir,
      "--target", "es2022",
      "--module", "es2022",
      "--moduleResolution", "bundler",
      "--strict",
    ],
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
  const { claimMarker } = await import(
    pathToFileURL(join(outDir, "marker-claim.js")).href
  );

  const M = "2026/10/02(金) 21:00~23:00";

  console.log("1 実行");
  for (const [label, initial, expected] of [
    ["行が無い → 取れる", undefined, true],
    ["値が NULL → 取れる", { value: null }, true],
    ["古い印 → 取れる", { value: "2026/09/30(水) 21:00~23:00" }, true],
    ["同じ印 → 取れない (送信済み)", { value: M }, false],
  ]) {
    const { state, opsFor } = fakeRow(initial);
    check(label, await claimMarker(opsFor(M)), expected);
    check(`  └ 行は印になっている`, state.row?.value ?? null, M);
  }

  console.log("2 実行が同時に取り合う");
  for (const [label, initial, expectedWinners] of [
    ["行が無い", undefined, 1],
    ["値が NULL", { value: null }, 1],
    ["古い印", { value: "old" }, 1],
    ["同じ印", { value: M }, 0],
  ]) {
    const { opsFor } = fakeRow(initial);
    const results = await Promise.all([
      claimMarker(opsFor(M)),
      claimMarker(opsFor(M)),
    ]);
    check(`${label}: 送れるのは ${expectedWinners} 回`, results.filter(Boolean).length, expectedWinners);
  }

  console.log("段の途中で DB エラー → 取れた扱いにしない");
  {
    let threw = false;
    try {
      await claimMarker({
        replaceDifferent: async () => {
          throw new Error("boom");
        },
        replaceNull: async () => true,
        insertIfAbsent: async () => true,
      });
    } catch {
      threw = true;
    }
    check("エラーは呼び出し側へ投げる", threw, true);
  }

  console.log("構造 (attendance-reminder.ts)");
  const src = readFileSync("src/lib/server/attendance-reminder.ts", "utf8");
  const start = src.indexOf("export async function dispatchAttendanceReminder(");
  const end = src.indexOf("\nasync function postToDiscord(", start);
  const body = src.slice(start, end);
  const claimAt = body.indexOf("claimMarker(reminderMarkerOps(");
  const postAt = body.indexOf("await postToDiscord(");
  check("cron 経路は印を取ってから送る", claimAt > 0 && postAt > claimAt, true);
  check(
    "取れなければ送らない",
    /if \(!claimed\) \{\s*return \{ ok: true, posted: 0, skipped: 1/.test(body),
    true,
  );
  check(
    "送れなければ自分の印だけを戻す",
    /\.update\(\{ value: lastSent \|\| null \}\)[\s\S]{0,120}\.eq\("value", marker\)/.test(body),
    true,
  );
  const unconditional = body.slice(0, postAt).match(/\.upsert\(\s*\{ key: REMINDER_LAST_SENT_KEY, value: marker \},\s*\{ onConflict: "key" \}/);
  check("送る前に無条件の上書きをしない", unconditional, null);
  const ops = src.slice(src.indexOf("function reminderMarkerOps("));
  check("段 1 は値が印と違う行だけ", /\.neq\("value", marker\)/.test(ops), true);
  check("段 2 は値が NULL の行だけ", /\.is\("value", null\)/.test(ops), true);
  check("段 3 は既存行を上書きしない", /ignoreDuplicates: true/.test(ops), true);
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

if (failures > 0) {
  console.log(`\n${failures} 件失敗`);
  process.exit(1);
}
console.log("\nすべて ok");
