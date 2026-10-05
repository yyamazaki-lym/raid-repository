/**
 * 同じ日の同じ開催をまとめる (2026-10-05、`src/lib/schedule/past-session-dedup.ts`)
 * の検証。
 * 実行: `node scripts/check-past-session-dedup.mjs`
 *
 * 本番で、開催時刻を 22:00 → 21:30 に変えた日 (10/02・10/04) が
 * `schedule_past_sessions` に時刻違いの 2 行で残り、過去の日付チップが 2 つずつ
 * 並び、動画が両方に付いていた。ここでは
 *   - 同じ JST 暦日で時間帯が重なる行は 1 つにまとめ、重ならない行 (昼と夜) は残す
 *   - デイコードの行が残す側の最優先。無ければ出欠あり → 新しく作られた行 → 出どころ
 *   - まとめた rawDate の Logs・メモを残した行に寄せる
 *   - 表示 (`mergeStoredPastSessions`)・トップページ・出席サマリーが同じまとめ方を使う
 * を固定する。
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
  if (a === e) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}\n       expected: ${e}\n       actual:   ${a}`);
  }
}
const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

const outDir = mkdtempSync(join(tmpdir(), "past-session-dedup-check-"));
try {
  execFileSync(
    process.execPath,
    [
      "node_modules/typescript/bin/tsc", "src/lib/schedule/past-session-dedup.ts",
      "--outDir", outDir, "--rootDir", "src/lib",
      "--target", "es2022", "--module", "es2022", "--moduleResolution", "bundler", "--strict",
    ],
    { stdio: "inherit" },
  );
  const fix = (dir) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const fp = join(dir, ent.name);
      if (ent.isDirectory()) fix(fp);
      else if (ent.name.endsWith(".js")) {
        writeFileSync(fp, readFileSync(fp, "utf8").replace(/(from\s+["'])(\.\.?\/[^"']+?)(?<!\.js)(["'])/g, "$1$2.js$3"));
      }
    }
  };
  fix(outDir);
  const d = await import(pathToFileURL(join(outDir, "schedule", "past-session-dedup.js")).href);

  // 行を作る (JST の日付と時刻で書く)。
  const row = (ymd, start, end, o = {}) => {
    const [y, m, dd] = ymd.split("-");
    const dow = "日月火水木金土"[new Date(`${ymd}T00:00:00Z`).getUTCDay()];
    return {
      rawDate: `${y}/${m}/${dd}(${dow}) ${start}~${end}`,
      startMs: Date.parse(`${ymd}T${start.padStart(5, "0")}:00+09:00`),
      startTime: start,
      endTime: end,
      hasAttendances: true,
      createdAt: null,
      source: "snapshot",
      ...o,
    };
  };

  console.log("時間帯");
  check("21:30~0:00 は翌日 0:00 まで", d.sessionMinutes("21:30", "0:00"), { start: 1290, end: 1440 });
  check("13:00~15:00", d.sessionMinutes("13:00", "15:00"), { start: 780, end: 900 });
  check("読めなければ null", d.sessionMinutes("夜", "0:00"), null);
  check("22:00~0:00 と 21:30~0:00 は重なる", d.timeRangesOverlap(row("2026-10-04", "22:00", "0:00"), row("2026-10-04", "21:30", "0:00")), true);
  check("昼と夜は重ならない", d.timeRangesOverlap(row("2026-10-04", "13:00", "15:00"), row("2026-10-04", "21:30", "0:00")), false);
  check("端が触れるだけは重ならない", d.timeRangesOverlap(row("2026-10-04", "19:00", "21:30"), row("2026-10-04", "21:30", "0:00")), false);
  check("別の日は同じ開催ではない", d.isSameSession(row("2026-10-04", "21:30", "0:00"), row("2026-10-05", "21:30", "0:00")), false);

  console.log("\n本番と同じ形 (時刻を 22:00 → 21:30 に変えた日)");
  const prod = [
    row("2026-10-04", "22:00", "0:00", { createdAt: "2026-09-28T12:56:00Z" }),
    row("2026-10-04", "21:30", "0:00", { createdAt: "2026-10-01T12:56:00Z" }),
    row("2026-10-02", "22:00", "0:00", { createdAt: "2026-09-28T12:56:00Z" }),
    row("2026-10-02", "21:30", "0:00", { createdAt: "2026-09-30T12:56:00Z" }),
    row("2026-10-01", "21:30", "0:00", { createdAt: "2026-09-30T12:56:00Z" }),
    row("2026-09-27", "22:00", "0:00", { createdAt: "2026-09-20T12:56:00Z" }),
  ];
  const p1 = d.planPastSessionMerge({ sheet: [], stored: prod });
  check("1 日 1 行になる", p1.additions.map((r) => r.rawDate).sort(), [
    "2026/09/27(日) 22:00~0:00",
    "2026/10/01(木) 21:30~0:00",
    "2026/10/02(金) 21:30~0:00",
    "2026/10/04(日) 21:30~0:00",
  ]);
  check("後から作られた (時刻を直した後の) 行を残し、古い行を寄せる", p1.aliasOf, {
    "2026/10/04(日) 22:00~0:00": "2026/10/04(日) 21:30~0:00",
    "2026/10/02(金) 22:00~0:00": "2026/10/02(金) 21:30~0:00",
  });

  console.log("\n残す行の決め方");
  const pAtt = d.planPastSessionMerge({
    sheet: [],
    stored: [
      row("2026-10-04", "22:00", "0:00", { createdAt: "2026-10-05T00:00:00Z", hasAttendances: false, source: "discord" }),
      row("2026-10-04", "21:30", "0:00", { createdAt: "2026-10-01T00:00:00Z" }),
    ],
  });
  check("出欠のスナップショットがある行を優先", pAtt.additions.map((r) => r.rawDate), ["2026/10/04(日) 21:30~0:00"]);
  const pSrc = d.planPastSessionMerge({
    sheet: [],
    stored: [
      row("2026-10-04", "22:00", "0:00", { source: "discord" }),
      row("2026-10-04", "21:30", "0:00", { source: "manual" }),
    ],
  });
  check("作成日時が無ければ出どころ (手動 > スナップショット > Discord)", pSrc.additions.map((r) => r.rawDate), ["2026/10/04(日) 21:30~0:00"]);
  const pTwo = d.planPastSessionMerge({
    sheet: [],
    stored: [row("2026-10-04", "13:00", "15:00"), row("2026-10-04", "21:30", "0:00")],
  });
  check("昼と夜の 2 回開催はまとめない", [pTwo.additions.length, pTwo.aliasOf], [2, {}]);

  console.log("\nデイコードの行がある日");
  const sheet = [row("2026-10-04", "21:30", "0:00")];
  const pSheet = d.planPastSessionMerge({ sheet, stored: [row("2026-10-04", "22:00", "0:00"), row("2026-10-04", "21:30", "0:00")] });
  check("デイコードの行に重なる行は足さない", pSheet.additions, []);
  check("デイコードの行は実開催の証拠あり", [...pSheet.verifiedSheetRawDates], ["2026/10/04(日) 21:30~0:00"]);
  check("時刻違いの行はデイコードの行に寄せる", pSheet.aliasOf, { "2026/10/04(日) 22:00~0:00": "2026/10/04(日) 21:30~0:00" });
  const pOnlyOld = d.planPastSessionMerge({ sheet, stored: [row("2026-10-04", "22:00", "0:00")] });
  check("保存済みが古い時刻だけでも、デイコードの行を実開催とみなす", [...pOnlyOld.verifiedSheetRawDates], ["2026/10/04(日) 21:30~0:00"]);
  const pNoEvidence = d.planPastSessionMerge({ sheet, stored: [row("2026-10-03", "21:30", "0:00")] });
  check("別の日の保存済みでは証拠にならない", [[...pNoEvidence.verifiedSheetRawDates], pNoEvidence.additions.length], [[], 1]);

  console.log("\nLogs・メモを寄せる");
  const logs = {
    "2026/10/04(日) 21:30~0:00": [{ id: "a", url: "https://ja.fflogs.com/reports/X" }],
    "2026/10/04(日) 22:00~0:00": [
      { id: "b", url: "https://ja.fflogs.com/reports/X" },
      { id: "c", url: "https://ja.fflogs.com/reports/Y" },
    ],
    "2026/10/01(木) 21:30~0:00": [{ id: "d", url: "https://ja.fflogs.com/reports/Z" }],
  };
  const folded = d.foldAliasedKeys(logs, p1.aliasOf, (e) => e.url);
  check("寄せた先に連結し、同じ URL は 1 つにする", folded["2026/10/04(日) 21:30~0:00"].map((e) => e.id), ["a", "c"]);
  check("寄せた元の鍵は残さない", Object.keys(folded).sort(), ["2026/10/01(木) 21:30~0:00", "2026/10/04(日) 21:30~0:00"]);
  check("まとめが無い鍵はそのまま", folded["2026/10/01(木) 21:30~0:00"].map((e) => e.id), ["d"]);
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

console.log("\n配線");
const next = read("src/lib/schedule/next-session.ts");
check("表示: mergeStoredPastSessions がまとめの計画を使う", /const plan = planPastSessionMerge\(\{/.test(next), true);
check("表示: デイコードの過去行は同じ開催の証拠で残す", /plan\.verifiedSheetRawDates\.has\(s\.rawDate\)/.test(next), true);
check("表示: 保存済みの行は開催 1 つにつき 1 行だけ足す", /for \(const c of plan\.additions\) \{/.test(next), true);
check("表示: まとめた rawDate を返す", /rawDateAliases: plan\.aliasOf,/.test(next), true);
const page = read("src/app/(portal)/page.tsx");
check("トップ: Logs を寄せる (同じ URL は 1 つ)", /foldAliasedKeys\(rawSessionLogsByDate, aliases, \(e\) => e\.url\)/.test(page), true);
check("トップ: メモを寄せる", /foldAliasedKeys\(rawInitialMemosByDate, aliases, \(m\) => m\.id\)/.test(page), true);
const stored = read("src/lib/server/discord-schedule.ts");
check("読み取り: 出どころと作成日時を読む", /attendances, user_names, source, created_at"/.test(stored), true);
const summary = read("src/lib/server/attendance-summary-actions.ts");
check("出席サマリー: 同じまとめ方で開催日を数える", /planPastSessionMerge\(\{\s*sheet: \[\],/.test(summary), true);
check("出席サマリー: 除外した日は数えない", /\.from\("schedule_past_sessions"\)[\s\S]{0,300}\.is\("excluded_at", null\)/.test(summary), true);

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
