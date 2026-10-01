/**
 * 2026-10-01 監査のセキュリティ指摘 (アプリ側) の回帰ガード。
 * 実行: `node scripts/check-security-followups.mjs`
 *
 * どれも呼び出し側のソースにしか書けない前提なので、ソースを読んで確かめる。
 *
 *   S-2 ユーザー / admin 入力の URL を取りに行く経路は、解決先を検査する
 *       (`safeFetch` / `fetchWithSafeRedirect` / `assertPublicResolution`)。
 *       `isPublicHttpUrl` は IP リテラルしか見ないので単独では不十分
 *   S-4 ミス注釈の読み取りは、公開デモのゲストに ID を伏せて返す
 *   S-6 FFLogs session cookie を app_settings (平文) から読まない
 *   S-7 CRON_SECRET を載せる自己 fetch はリダイレクトを辿らない
 *   S-8 ロットの消化表は、メンバー一覧の名前を本人が書いた名前より優先する
 *
 * S-5 (カテゴリ更新の allow-list) は tsc が保証する (キーの過不足で型エラー)。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

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

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.tsx?$/.test(name)) out.push(p.replace(/\\/g, "/"));
  }
  return out;
}

/** `marker` を含む関数の本体 (次のトップレベル宣言か EOF まで)。 */
function fnBody(src, marker) {
  const at = src.indexOf(marker);
  if (at < 0) return "";
  const rest = src.slice(at + marker.length);
  const next = rest.search(/\n(export )?(async )?function |\nexport const |\nconst [A-Z_]+ =/);
  return marker + (next < 0 ? rest : rest.slice(0, next));
}

console.log("S-2 URL を取りに行く経路");
// `isPublicHttpUrl` で入口を見ているファイルで、素の `fetch(` を使ってよい
// 回数。固定ホスト (YouTube oEmbed) への fetch と、Data Cache を保つために
// `assertPublicResolution` を先に通す TOP のスケジュール取得だけ。
const BARE_FETCH_ALLOWED = {
  "src/lib/server/page-title.ts": 1, // https://www.youtube.com/oembed (固定ホスト)
  "src/lib/schedule/next-session.ts": 1, // assertPublicResolution を先に通す
};
const offenders = [];
for (const file of walk("src")) {
  const src = readFileSync(file, "utf8");
  if (!src.includes("isPublicHttpUrl(")) continue;
  const n = (src.match(/await fetch\(/g) ?? []).length;
  if (n !== (BARE_FETCH_ALLOWED[file] ?? 0)) offenders.push(`${file} (${n})`);
}
check("isPublicHttpUrl を使うファイルの素の fetch が許可した数だけ", offenders, []);

const cat = readFileSync("src/lib/server/categories-actions.ts", "utf8");
const nameRaw = fnBody(cat, "async function fetchScheduleNameRaw(");
check("スケジュール名の取得は fetchWithSafeRedirect", /await fetchWithSafeRedirect\(url,/.test(nameRaw), true);
check("  └ 本文は上限つきで読む", /readBodyWithLimit\(res, SCHEDULE_NAME_MAX_HTML_BYTES\)/.test(nameRaw), true);
check("  └ 素の fetch が残っていない", /await fetch\(/.test(nameRaw), false);

const ns = readFileSync("src/lib/schedule/next-session.ts", "utf8");
const html = fnBody(ns, "async function fetchHtmlOrNull(");
const resolveAt = html.indexOf("await assertPublicResolution(current)");
const fetchAt = html.indexOf("await fetch(current,");
check("TOP のスケジュール取得は接続前に解決先を検査", resolveAt > 0 && fetchAt > resolveAt, true);
check("  └ リダイレクトは自動で辿らない", /redirect: "manual"/.test(html), true);
check("  └ リダイレクト先も isPublicHttpUrl にかける", /!isPublicHttpUrl\(next\)/.test(html), true);

console.log("S-4 ミス注釈の読み取り");
const read = readFileSync("src/lib/server/pull-notes-read.ts", "utf8");
const redact = fnBody(read, "export function redactPullNotesForGuest(");
check("本人限定の注釈を除く", /\.filter\(\(n\) => n\.scope !== "self"\)/.test(redact), true);
check("作成者と対象者の ID を伏せる", /discordUserId: null, createdById: null/.test(redact), true);
check(
  "コンテンツ単位の読み取りがゲストに伏せる",
  /user\.isDemoGuest \? redactPullNotesForGuest\(notes\) : notes/.test(
    fnBody(read, "export async function fetchCategoryPullNotes("),
  ),
  true,
);
const actions = readFileSync("src/lib/server/pull-notes-actions.ts", "utf8");
check(
  "pull 単位の読み取りがゲストに伏せる",
  /user\.isDemoGuest \? redactPullNotesForGuest\(notes\) : notes/.test(
    fnBody(actions, "export async function fetchPullNotesAction("),
  ),
  true,
);

console.log("S-6 FFLogs session cookie");
const fflogs = readFileSync("src/lib/server/fflogs.ts", "utf8");
check("app_settings から cookie を読まない", /fetchAppSetting\("fflogs_session_cookie"\)/.test(fflogs), false);

console.log("S-7 CRON_SECRET を載せる自己 fetch");
for (const file of ["src/lib/server/fflogs.ts", "src/lib/server/fflogs-fights.ts", "src/lib/server/logs-auto-sync.ts"]) {
  const src = readFileSync(file, "utf8");
  // `Bearer ${secret}` を載せる fetch 呼び出しを 1 つずつ切り出す。
  const calls = [...src.matchAll(/await fetch\([\s\S]*?\n {4}\}\);/g)].map((m) => m[0]);
  const withSecret = calls.filter((c) => /Bearer \$\{secret\}/.test(c));
  check(
    `${file}: secret を載せる fetch はすべて redirect: "error"`,
    withSecret.length > 0 && withSecret.every((c) => /redirect: "error"/.test(c)),
    true,
  );
}

console.log("S-8 ロットの消化表の名前");
const loot = readFileSync("src/lib/server/loot-weekly-actions.ts", "utf8");
check("categoryId を UUID で検査", /if \(!UUID_RE\.test\(input\.categoryId/.test(loot), true);
check("メンバー一覧の名前を server 側で引く", /\.from\("native_schedule_members"\)[\s\S]{0,120}\.eq\("discord_user_id", member\.discordId\)/.test(loot), true);
check("メンバー一覧の名前を優先する", /const displayName = rosterName \|\| sanitizeName\(input\.displayName\)/.test(loot), true);
const extras = readFileSync("src/lib/supabase/loot-extras.ts", "utf8");
check("表示もメンバー一覧の名前を優先する", /displayName: \(\(m\.display_name as string\) \?\? ""\) \|\| hit\?\.displayName/.test(extras), true);

if (failures > 0) {
  console.log(`\n${failures} 件失敗`);
  process.exit(1);
}
console.log("\nすべて ok");
