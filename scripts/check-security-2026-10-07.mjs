/**
 * 2026-10-07 セキュリティ精査 (アプリ側) の回帰ガード。
 * 実行: `node scripts/check-security-2026-10-07.mjs`
 *
 * どれも呼び出し側のソースにしか書けない前提なので、ソースを読んで確かめる。
 * データベースの規則 (RLS) は check-rls-membership.mjs、日付メモの上限は
 * check-memo-permissions.mjs が見る。
 *
 *   M-1 Discord のロール一覧 (bot token で Discord を叩く) は admin だけ
 *   M-2 ミス注釈は実在する pull にだけ付け、カテゴリは pull の行から取る。1 人 1 日の上限
 */
import { readFileSync } from "node:fs";

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
/** 行コメント (`// ...`) を落とす。経緯の説明に旧い書き方が出てくるため。 */
const code = (s) => s.replace(/^\s*\/\/.*$/gm, "");
/** `export async function name(` から次の top-level の "\n}\n" まで。 */
function fnBody(src, name) {
  const start = src.indexOf(`export async function ${name}(`);
  if (start < 0) return "";
  const end = src.indexOf("\n}\n", start);
  return end < 0 ? src.slice(start) : src.slice(start, end);
}

console.log("M-1 Discord のロール一覧");
const categories = read("src/lib/server/categories-actions.ts");
const roles = fnBody(categories, "fetchAvailableGuildRoles");
check(
  "admin を確かめてから bot token で取りに行く",
  /const auth = await assertAdminResult\(\);\s*if \(!auth\.ok\) return \[\];\s*return fetchGuildRoles\(\);/.test(roles),
  true,
);

console.log("\nM-2 ミス注釈の追加");
const notes = read("src/lib/server/pull-notes-actions.ts");
const add = code(fnBody(notes, "addPullNoteAction"));
check(
  "pull の実在を確かめる (無ければ付けない)",
  /\.from\("fflogs_fights"\)\s*\.select\("category_id"\)\s*\.eq\("report_code", code\)\s*\.eq\("fight_id", input\.fightId\)\s*\.maybeSingle\(\);/.test(add) &&
    /if \(!fight\) \{\s*return \{ ok: false, reason: "その pull が見つかりません" \};/.test(add),
  true,
);
check(
  "カテゴリは pull の行から取り、呼び出し側の値を使わない",
  /const categoryId = \(fight\.category_id as string \| null\) \?\? null;/.test(add) &&
    /category_id: categoryId,/.test(add) &&
    !/input\.categoryId/.test(add),
  true,
);
check(
  "1 人 24 時間の上限を、書き込む前に数える",
  /\.eq\("created_by_id", user\.discordId\)\s*\.gte\("created_at", since\);/.test(add) &&
    add.indexOf("NOTES_PER_DAY_LIMIT") < add.indexOf('.from("fflogs_pull_notes").insert('),
  true,
);
check("上限の値は export しない (\"use server\" のファイル)", /^const NOTES_PER_DAY_LIMIT = \d+;/m.test(notes) && !/export const NOTES_PER_DAY_LIMIT/.test(notes), true);

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
