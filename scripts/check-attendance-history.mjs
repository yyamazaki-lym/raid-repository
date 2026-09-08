/**
 * 出席サマリー (src/lib/schedule/attendance-history.ts) の検証
 * (2026-09-08、W-19)。
 * 実行: `node scripts/check-attendance-history.mjs`
 *
 * 固定したいのは 4 点:
 *   1. **ログが無い日を分母に入れない** — 入れるとログ担当が休んだ日が
 *      全員の欠席に化ける
 *   2. 有志練習 (W-18) と中止の日を外す
 *   3. ズレ一覧は新しい日から、同じ日は重い順
 *   4. 「参加と答えた」に遅刻 / 時間帯つきの回答を含める (attendance-summary
 *      の availableCount と同じ扱い)
 *
 * ⚠ tsc は `process.execPath` + `node_modules/typescript/bin/tsc` で起動する
 *   (`npx` は Windows で ENOENT / EINVAL になる)。
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

const outDir = mkdtempSync(join(tmpdir(), "att-history-check-"));
try {
  execFileSync(
    process.execPath,
    [
      "node_modules/typescript/bin/tsc",
      "src/lib/schedule/attendance-history.ts",
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
    writeFileSync(fp, readFileSync(fp, "utf8").replace(
      /(from\s+["'])(\.\.?\/[^"']+?)(?<!\.js)(["'])/g, "$1$2.js$3"));
  }
  const { summarizeAttendanceHistory } = await import(
    pathToFileURL(join(outDir, "attendance-history.js")).href
  );

  const members = [
    { discordUserId: "a", displayName: "あかね" },
    { discordUserId: "b", displayName: "びわ" },
  ];
  const session = (over) => ({
    sessionDate: "2026-09-01",
    rawDate: "2026/09/01(火) 21:00~23:00",
    status: "DECISION",
    isOptional: false,
    dayPulls: 40,
    symbols: {},
    pullsBy: {},
    ...over,
  });

  // ---- 1. 分母 ----
  let r = summarizeAttendanceHistory({
    sessions: [
      session({ symbols: { a: "○", b: "○" }, pullsBy: { a: 40, b: 40 } }),
      // ログが無い日 — 分母に入れない
      session({ sessionDate: "2026-09-02", dayPulls: 0, symbols: { a: "○", b: "○" } }),
    ],
    members,
  });
  check(
    "ログが無い日は分母外",
    [r.sessions, r.noLog, r.unmatched, r.excluded],
    [1, 1, 0, 0],
  );
  check("両者 1/1 参加", r.rows.map((x) => [x.sessions, x.saidYes, x.attended]), [
    [1, 1, 1],
    [1, 1, 1],
  ]);
  check("ズレ 0", r.mismatches.length, 0);

  // ---- 2. 除外 ----
  r = summarizeAttendanceHistory({
    sessions: [
      session({ isOptional: true, symbols: { a: "○" }, pullsBy: {} }),
      session({ sessionDate: "2026-09-03", status: "CANCELLED", symbols: { a: "○" } }),
    ],
    members,
  });
  check(
    "有志練習 / 中止は除外",
    [r.sessions, r.noLog, r.unmatched, r.excluded],
    [0, 0, 0, 2],
  );

  check("除外だけならズレも 0", r.mismatches.length, 0);

  // ---- 2-b. 参加者が 1 人も紐づかない日 ----
  // ⚠ ここを素通しすると「参加可と答えた全員が不在」に化ける (実際に
  // dev preview でそう見えた)。分母から外し unmatched に数える。
  r = summarizeAttendanceHistory({
    sessions: [
      session({ symbols: { a: "○", b: "○" }, pullsBy: {} }),
      session({ sessionDate: "2026-09-03", symbols: { a: "○" }, pullsBy: { a: 0, b: 0 } }),
    ],
    members,
  });
  check(
    "pull はあるが参加者 0 人の日は分母外",
    [r.sessions, r.noLog, r.unmatched, r.excluded],
    [0, 0, 2, 0],
  );
  check("その日のズレは 0 件", r.mismatches.length, 0);
  check(
    "行も加算されない",
    r.rows.map((x) => [x.sessions, x.saidYes, x.attended]),
    [
      [0, 0, 0],
      [0, 0, 0],
    ],
  );
  // 逆に、誰か 1 人でも映っていれば突合する (本人だけを渡された場合も同じ)。
  r = summarizeAttendanceHistory({
    sessions: [session({ symbols: { a: "○" }, pullsBy: { b: 40 } })],
    members: [members[0]],
  });
  check(
    "他の人が映っていれば本人の不在は検出する",
    [r.sessions, r.unmatched, r.mismatches.map((x) => x.kind)],
    [1, 0, ["absent-though-yes"]],
  );

  // ---- 3. ズレの検出と並び ----
  r = summarizeAttendanceHistory({
    sessions: [
      session({
        sessionDate: "2026-09-01",
        symbols: { a: "×", b: "○" },
        pullsBy: { a: 30 },
      }),
      session({
        sessionDate: "2026-09-05",
        rawDate: "2026/09/05(土) 21:00~23:00",
        symbols: { a: "○", b: "△" },
        pullsBy: { b: 20 },
      }),
    ],
    members,
  });
  check(
    "新しい日から / 同じ日は重い順",
    r.mismatches.map((x) => [x.sessionDate, x.displayName, x.kind]),
    [
      ["2026-09-05", "あかね", "absent-though-yes"],
      ["2026-09-05", "びわ", "present-though-other"],
      ["2026-09-01", "びわ", "absent-though-yes"],
      ["2026-09-01", "あかね", "present-though-no"],
    ],
  );
  check(
    "行のズレ件数",
    r.rows.map((x) => [x.displayName, x.mismatches]),
    [
      ["あかね", 2],
      ["びわ", 2],
    ],
  );

  // ---- 4. 「参加と答えた」の範囲 ----
  r = summarizeAttendanceHistory({
    sessions: [
      session({ symbols: { a: "⏰", b: "夜" }, pullsBy: { a: 5, b: 5 } }),
    ],
    members,
  });
  check(
    "遅刻 / 時間帯つきも「参加と答えた」に数える",
    r.rows.map((x) => x.saidYes),
    [1, 1],
  );
  check("申告どおりなのでズレ 0", r.mismatches.length, 0);

  // ---- 5. 空入力 ----
  r = summarizeAttendanceHistory({ sessions: [], members: [] });
  check("空入力", [r.rows.length, r.mismatches.length, r.sessions], [0, 0, 0]);
  r = summarizeAttendanceHistory({
    sessions: [session({ pullsBy: { a: 40 } })],
    members: [],
  });
  check("メンバー 0 人でも日は数える", [r.rows.length, r.sessions], [0, 1]);
  r = summarizeAttendanceHistory({ sessions: [session({})], members: [] });
  check(
    "メンバー 0 人 + 参加者 0 人なら unmatched",
    [r.sessions, r.unmatched],
    [0, 1],
  );
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
