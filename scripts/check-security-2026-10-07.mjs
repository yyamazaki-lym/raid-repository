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
 *   L   URL の値 (`/auth/denied?reason=`・`/login?error=`・`?fflogs_oauth_error=`)
 *       をそのまま画面に出さない (2026-08-05 の L-7 の残り)
 *
 * Discord に流す文の無害化は check-discord-text.mjs が見る。
 */
import { readdirSync, readFileSync } from "node:fs";

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

console.log("\nL URL の値をそのまま画面に出さない");
{
  // /auth/denied: 出してよい reason の集合と、サイト自身が付ける reason の突き合わせ。
  const denied = read("src/app/auth/denied/page.tsx");
  const setBody = denied.match(/const KNOWN_REASONS = new Set\(\[([\s\S]*?)\]\);/)?.[1] ?? "";
  const known = new Set([...setBody.matchAll(/"([a-z_]+)"/g)].map((x) => x[1]));
  const produced = new Set();
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name)) {
        const s = read(p);
        for (const x of s.matchAll(/\/auth\/denied\?reason=([a-z_]+)/g)) produced.add(x[1]);
        for (const x of s.matchAll(/"\/auth\/denied", \{ reason: "([a-z_]+)" \}/g)) produced.add(x[1]);
      }
    }
  };
  walk("src");
  // callback が素通しする Discord の判定の理由 (union 型) と、proxy の失効の理由。
  const membership = read("src/lib/server/discord-membership.ts");
  for (const x of (membership.match(/reason: ("[a-z_]+"(?: \| "[a-z_]+")*);/)?.[1] ?? "").matchAll(/"([a-z_]+)"/g)) produced.add(x[1]);
  const proxy = read("src/proxy.ts");
  const proxyBlock = proxy.slice(proxy.indexOf('deniedUrl.searchParams.set('), proxy.indexOf('const revoked = NextResponse.redirect(deniedUrl);'));
  for (const x of proxyBlock.matchAll(/"([a-z_]+)"/g)) if (x[1] !== "not_in_guild" && x[1] !== "reason") produced.add(x[1]);
  check("denied: サイト自身が付ける reason を 8 種類以上拾えている", produced.size >= 8, true);
  check("denied: サイト自身が付ける reason はすべて許可リストにある", [...produced].filter((r) => !known.has(r)).sort(), []);
  check("denied: 許可リストに無い値は出さない", /KNOWN_REASONS\.has\(rawReason\)/.test(denied) && /reason: \{reason\}/.test(denied) && !/reason: \{rawReason\}/.test(denied), true);

  const login = read("src/app/login/page.tsx");
  const core = read("src/lib/i18n/dict/core.ts");
  check("login: 知らないコードは固定の文言 (コードを出さない)", /default:[\s\S]{0,200}return m\.login\.errorGeneric;/.test(login) && !/errorGeneric\(/.test(login), true);
  check("login: 辞書の errorGeneric は文字列 (差し込みが無い)", (core.match(/errorGeneric: "[^"$]+",/g) ?? []).length, 2);

  const callback = read("src/app/api/auth/fflogs/callback/route.ts");
  const start = read("src/app/api/auth/fflogs/start/route.ts");
  const setsInCallback = [...callback.matchAll(/searchParams\.set\("fflogs_oauth_error", ([^)]+)\)/g)].map((x) => x[1]);
  check("FFLogs OAuth (callback): URL にはコードだけを載せる", setsInCallback, ["errorCode"]);
  check("FFLogs OAuth (callback): 失敗はすべて fail(コード, 詳細) を通る", (callback.match(/return fail\(/g) ?? []).length, 4);
  check("FFLogs OAuth (start): URL にはコードだけを載せる", [...start.matchAll(/searchParams\.set\("fflogs_oauth_error", ([^)]+)\)/g)].map((x) => x[1]), ["result.code"]);

  const codesSrc = read("src/lib/fflogs-oauth-error.ts");
  const codes = [...(codesSrc.match(/FFLOGS_OAUTH_ERROR_CODES = \[([\s\S]*?)\] as const;/)?.[1] ?? "").matchAll(/^\s*"([a-z_]+)",$/gm)].map((x) => x[1]);
  const dict = read("src/lib/i18n/dict/settings.ts");
  const blocks = [...dict.matchAll(/oauthErrors: \{([\s\S]*?)\n    \},/g)].map((x) => x[1]);
  check("FFLogs OAuth: コードは 9 種類", codes.length, 9);
  check("FFLogs OAuth: 辞書 (ja / en) にすべてのコードの文言がある", blocks.map((b) => codes.filter((c) => !new RegExp(`^\\s*${c}: "`, "m").test(b))), [[], []]);
  const dialog = read("src/components/portal/settings-dialog.tsx");
  check("FFLogs OAuth: 画面は既知のコードだけを辞書の文言に変える", /isFflogsOauthErrorCode\(errParam\)\s*\?\s*m\.settingsDialog\.oauthErrors\[errParam\]\s*:\s*m\.settingsDialog\.oauthErrorUnknown;/.test(dialog) && !/toastOauthError\(errParam\)/.test(dialog), true);
}

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
