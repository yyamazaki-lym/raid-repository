/**
 * 出席の突合が 0 件のとき、原因を画面で分けられるようにする (2026-10-06) の検証。
 * 実行: `node scripts/check-attendance-unresolved.mjs`
 *
 * 実機: 出席サマリーが「突合できた活動日 0 日」のまま。原因はメンバーの
 * 「ログ名」が全員空で、表示名 (Discord の名前) が FFLogs のキャラ名と一致
 * しないことだったが、画面からは分からなかった。
 *   1. 対応表に無い名前を設定のメンバー一覧の下に出し、メンバーの「ログ名」に
 *      割り当てられるようにする。今の対応表で一致する名前は一覧から外す
 *      (`stillUnresolvedNames`)
 *   2. 詳細は取れたのに参加者名を 1 人も読めなかったレポートを数えて知らせる
 *      (以前は黙って何も出なかった。対応表では直らない取得側の問題)
 *
 * ⚠ tsc の起動は `process.execPath` + `node_modules/typescript/bin/tsc`
 *   (`npx` は Windows で走らない)。
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

const outDir = mkdtempSync(join(tmpdir(), "att-unresolved-check-"));
try {
  execFileSync(
    process.execPath,
    [
      "node_modules/typescript/bin/tsc", "src/lib/schedule/attendance-actuals.ts",
      "--outDir", outDir, "--rootDir", "src/lib",
      "--target", "es2022", "--module", "es2022", "--moduleResolution", "bundler", "--strict",
    ],
    { stdio: "inherit" },
  );
  for (const f of readdirSync(outDir, { recursive: true })) {
    if (!f.endsWith(".js")) continue;
    const fp = join(outDir, f);
    writeFileSync(fp, readFileSync(fp, "utf8").replace(/(from\s+["'])(\.\.?\/[^"']+?)(?<!\.js)(["'])/g, "$1$2.js$3"));
  }
  const { stillUnresolvedNames } = await import(pathToFileURL(join(outDir, "schedule", "attendance-actuals.js")).href);

  console.log("1. 対応表に無い名前の一覧");
  const rows = [
    { name: "Enero Alma", pulls: 30, lastSessionDate: "2026-10-05" },
    { name: "Yu Fuzuki", pulls: 28, lastSessionDate: "2026-10-05" },
    { name: "Ｋａｇｅｔｓｕ　Ｙｏｓａｋｕｒａ", pulls: 12, lastSessionDate: "2026-10-04" },
    { name: "Same Name", pulls: 3, lastSessionDate: null },
    { name: "  ", pulls: 1, lastSessionDate: null },
    { name: "Guest Player", pulls: 2, lastSessionDate: "2026-09-27" },
  ];
  // ログ名を入れていない固定 (実機の状態): 表示名は Discord の名前で、どれにも一致しない。
  const before = [
    { discordUserId: "u1", displayName: "enero", characterName: null },
    { discordUserId: "u2", displayName: "y.mochi", characterName: null },
  ];
  check(
    "ログ名が空なら全部残る (空の名前は落とす・順序はそのまま)",
    stillUnresolvedNames(rows, before).map((r) => r.name),
    ["Enero Alma", "Yu Fuzuki", "Ｋａｇｅｔｓｕ　Ｙｏｓａｋｕｒａ", "Same Name", "Guest Player"],
  );
  // ログ名を保存した後: 次の同期を待たずに一覧から消える。
  const after = [
    { discordUserId: "u1", displayName: "enero", characterName: "Enero Alma" },
    { discordUserId: "u2", displayName: "y.mochi", characterName: "yu fuzuki" },
    { discordUserId: "u3", displayName: "カゲツ", characterName: "Kagetsu Yosakura" },
    // 同じ名前に 2 人が当たる (取り違えるより未解決の方がよい) → 残す
    { discordUserId: "u4", displayName: "Same Name", characterName: null },
    { discordUserId: "u5", displayName: "x", characterName: "same name" },
  ];
  check(
    "ログ名・表示名に一致したら外す (大文字小文字・全角・空白の違いは同じ扱い)、曖昧は残す",
    stillUnresolvedNames(rows, after).map((r) => r.name),
    ["Same Name", "Guest Player"],
  );
  check("行の他の項目はそのまま返す", stillUnresolvedNames(rows, after)[1], rows[5]);
  check("メンバーが空なら全部残る", stillUnresolvedNames(rows.slice(0, 2), []).length, 2);
  check(
    "前後に空白がある名前も残す (落とさない)",
    stillUnresolvedNames([{ name: " Guest Player " }], after).map((r) => r.name),
    [" Guest Player "],
  );
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

console.log("\n配線");
const action = read("src/lib/server/attendance-unresolved-actions.ts");
check("Server Action: \"use server\"", action.startsWith('"use server";'), true);
check(
  "Server Action: admin でなければ DB に触る前に返す",
  /const auth = await assertAdminResult\(\);\s*if \(!auth\.ok\) return \{ ok: false, reason: "ADMIN ロールが必要です" \};\s*try \{\s*const db = createSupabaseServiceRoleClient\(\);/.test(action),
  true,
);
check("Server Action: 今のメンバーで絞る", /stillUnresolvedNames\(/.test(action) && /from\("native_schedule_members"\)/.test(action), true);
check("Server Action: 読み取りの失敗を空の一覧にしない", /if \(readError\) \{[\s\S]{0,200}?return \{ ok: false,/.test(action), true);
const section = read("src/components/portal/settings/native-members-section.tsx");
check(
  "メンバー一覧: admin のときだけ出し、選んだ名前をログ名の下書きに入れる",
  /\{canEdit && loaded && members\.length > 0 && \(\s*<UnresolvedLogNames\s*members=\{members\}\s*disabled=\{pending\}\s*onAssign=\{\(id, name\) => setDraft\(id, \{ characterName: name \}\)\}/.test(section),
  true,
);
const comp = read("src/components/portal/settings/unresolved-log-names.tsx");
check("一覧: メンバーが変わるたびに取り直す (保存後に消える)", /\}, \[members\]\);/.test(comp), true);
check("一覧: 名前が無ければ何も出さない", /if \(names\.length === 0\) return null;/.test(comp), true);
check("一覧: 選んだら割り当てる (空の選択肢は無視)", /if \(e\.target\.value\) onAssign\(e\.target\.value, n\.name\);/.test(comp), true);
check("一覧: 選択欄に読み上げ名", /aria-label=\{m\.nativeMembers\.unresolvedAssignAria\(n\.name\)\}/.test(comp), true);

const sync = read("src/lib/server/fflogs-fights.ts");
check(
  "同期: 詳細はあるのに名前が 0 件のレポートを数える",
  /if \(pullsByName\.size > 0\) \{\s*attendanceReports\.push\([\s\S]{0,400}?\} else \{[\s\S]{0,400}?attendanceNoNameCodes\.push\(ref\.code\);/.test(sync),
  true,
);
check("同期: 件数を結果に返す", /attendanceNoNameReports: attendanceNoNameCodes\.length,/.test(sync), true);
check("同期: 早期 return でも 0 を返す", /attendanceUnresolvedNames: \[\],\s*attendanceNoNameReports: 0,/.test(sync), true);
const fa = read("src/lib/server/fflogs-fights-actions.ts");
check("Server Action の型も件数を持つ", /attendanceNoNameReports: number;/.test(fa), true);
const view = read("src/app/(portal)/category/[slug]/logs/logs-view.tsx");
check(
  "トースト: 名前を読めなかったレポートがあれば警告 (紐づけ件数とは別に)",
  /if \(result\.attendanceNoNameReports > 0\) \{\s*toast\.warning\(m\.logsSync\.attendanceNoNames\(result\.attendanceNoNameReports\)\);/.test(view),
  true,
);

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
