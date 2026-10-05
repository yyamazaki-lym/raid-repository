/**
 * トップページの描画で使う読み取りが Next.js の合図を握りつぶさないことの検証
 * (2026-10-05)。
 * 実行: `node scripts/check-render-rethrow.mjs`
 *
 * `next build` は `/` をまず静的に描こうとし、cookies() に触れた時点で
 * DYNAMIC_SERVER_USAGE の合図 (例外) を投げて動的に切り替える。読み取りの
 * try/catch がこれを普通のエラーとして握ると、
 *   - ビルドのログに「fetchSessionLogsByDate error: Dynamic server usage …」が出る
 *     (2026-10-05 に本番のビルドで実際に出た)
 *   - 握った読み取りしか cookies を使っていないページだと、空のデータのまま
 *     静的なページとして配られる
 * ので、catch の先頭で `unstable_rethrow` (または同じ判定) を呼ぶ。ここでは
 * `/` が呼ぶ cookies を使う読み取りの catch をすべて見る。
 */
import { readFileSync } from "node:fs";

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

/** 関数の本体 (`function name(` か `const name =` から、行頭の `}` / `});` / `);` まで)。 */
function fnBody(src, name) {
  let start = src.indexOf(`function ${name}(`);
  if (start < 0) start = src.indexOf(`const ${name} =`);
  if (start < 0) return null;
  const ends = ["\n}\n", "\n});\n", "\n);\n"]
    .map((t) => src.indexOf(t, start))
    .filter((i) => i >= 0);
  return src.slice(start, ends.length > 0 ? Math.min(...ends) + 2 : undefined);
}

/** catch ごとに、先頭近くで Next.js の合図を投げ直しているか。 */
function catchesRethrow(body) {
  return [...body.matchAll(/catch\s*(?:\(\s*\w+\s*\))?\s*\{/g)].map((m) =>
    /unstable_rethrow\(|rethrowNextSentinel\(|DYNAMIC_SERVER_USAGE/.test(body.slice(m.index, m.index + 600)),
  );
}

// `/` (src/app/(portal)/page.tsx) が呼ぶ、cookies を使う読み取り (と、その中で catch するもの)。
const READERS = [
  ["src/lib/server/fflogs.ts", "fetchSessionLogsByDate"],
  ["src/lib/server/fflogs.ts", "fetchNativeSessionLogsByDate"],
  ["src/lib/server/schedule-memos-fetch.ts", "fetchScheduleMemosByDateBulk"],
  ["src/lib/supabase/categories.ts", "fetchCategories"],
  ["src/lib/supabase/recruitment-templates.ts", "fetchRecruitmentTemplatesServer"],
  ["src/lib/server/native-schedule-placeholders.ts", "ensureNativeMonthlyPlaceholders"],
  // 同期式: fetchSchedule → mergeStoredPastSessions → fetchStoredPastSessions (cookies)
  ["src/lib/schedule/next-session.ts", "fetchSchedule"],
  ["src/lib/schedule/next-session.ts", "mergeStoredPastSessions"],
];

console.log("catch が Next.js の合図を投げ直す");
for (const [file, name] of READERS) {
  const body = fnBody(read(file), name);
  if (body === null) {
    check(`${name} が ${file} にある`, false, true);
    continue;
  }
  const results = catchesRethrow(body);
  check(`${name}: catch ${results.length} 個すべて投げ直す`, results.every(Boolean), true);
}

console.log("\n一覧がページとずれていない");
const page = read("src/app/(portal)/page.tsx");
for (const name of [
  "fetchSessionLogsByDate",
  "fetchNativeSessionLogsByDate",
  "fetchScheduleMemosByDateBulk",
  "fetchCategories",
  "fetchRecruitmentTemplatesServer",
  "ensureNativeMonthlyPlaceholders",
  "fetchSchedule",
]) {
  check(`page.tsx が ${name} を呼ぶ`, page.includes(`${name}(`), true);
}
check(
  "fetchSchedule は mergeStoredPastSessions を通る",
  (fnBody(read("src/lib/schedule/next-session.ts"), "fetchSchedule") ?? "").includes("mergeStoredPastSessions("),
  true,
);

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
