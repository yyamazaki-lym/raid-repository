/**
 * 外部サービスを叩く Server Action のゲートの検証 (2026-10-01 監査 S-1)。
 * 実行: `node scripts/check-external-fetch-guard.mjs`
 *
 * 公開デモでは `requireDiscordMember()` が匿名ゲストを返すので、それだけで
 * 外部 (FFLogs / XivGear / XIVAPI) へ取りに行く Server Action は、
 * ログインしていない訪問者から無制限に呼べた。ここでは次を固定する:
 *
 *   1. 監査で見つけた 4 本が `guardExternalFetch` を最初に通す
 *      (FFLogs の 2 本はゲストを弾く / BiS・pull 詳細はゲストを IP で絞る)
 *   2. `"use server"` の export で、固定運用の FFLogs トークンや外部取得を
 *      使う関数は、admin ゲートか `guardExternalFetch` を**その呼び出しより
 *      前に**通す (今後 4 本と同じ形の漏れを足さない)
 *   3. ゲート本体がゲストの判定をレート制限より前に行う
 *
 * どれも呼び出し側のソースにしか書けない前提なので、ソースを読んで確かめる。
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

/** `export async function <name>(` から次の `\nexport ` (か EOF) まで。 */
function exportedFunctions(src) {
  const out = [];
  const re = /export async function (\w+)\(/g;
  let m;
  while ((m = re.exec(src))) {
    const start = m.index;
    const next = src.indexOf("\nexport ", start + 1);
    out.push({ name: m[1], body: next < 0 ? src.slice(start) : src.slice(start, next) });
  }
  return out;
}

function walk(dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) files.push(...walk(p));
    else if (/\.tsx?$/.test(name)) files.push(p);
  }
  return files;
}

console.log("監査で見つけた 4 本");
for (const [file, fn, scope, allowDemoGuest] of [
  ["src/lib/server/xivgear-actions.ts", "fetchXivgearSummaryAction", "xivgear", true],
  ["src/lib/server/pull-detail-actions.ts", "fetchPullDetailAction", "pull-detail", true],
  ["src/lib/server/boss-damage-actions.ts", "fetchBossDamageTimelineAction", "fflogs-boss-damage", false],
  ["src/lib/server/death-leadup-actions.ts", "fetchDeathLeadUpAction", "fflogs-death-leadup", false],
]) {
  const body = exportedFunctions(readFileSync(file, "utf8")).find((f) => f.name === fn)?.body ?? "";
  const guardRe = new RegExp(
    `guardExternalFetch\\(\\s*"${scope}",\\s*\\{\\s*allowDemoGuest: ${allowDemoGuest},?\\s*\\}\\s*\\)`,
  );
  const guardAt = body.search(guardRe);
  // 本体の最初の await がゲートであること。
  const firstAwait = body.indexOf("await ");
  check(`${fn}: 最初の await が guardExternalFetch("${scope}", allowDemoGuest: ${allowDemoGuest})`, guardAt > 0 && body.indexOf("await guardExternalFetch(") === firstAwait, true);
  check(`${fn}: 通らなければ返す`, /if \(!guard\.ok\) return guard;/.test(body), true);
  check(`${fn}: requireDiscordMember 単独のゲートが残っていない`, /requireDiscordMember\(/.test(body), false);
}

console.log("\"use server\" 全体: 外部取得の前にゲート");
// 固定の資源 (FFLogs トークン) か外部取得に繋がる呼び出し。
const SENSITIVE = /\b(getValidFflogsOAuthToken|syncFflogsFights|linkFflogsReportsToVideos|fetchXivgearSummary|attachAbilityNames|resolveActionNames)\(/;
const GATE = /\b(assertAdminResult|requireAdmin|guardExternalFetch)\(/;
const offenders = [];
let inspected = 0;
for (const file of walk("src/lib")) {
  const src = readFileSync(file, "utf8");
  if (!/^\s*["']use server["'];/.test(src)) continue;
  for (const { name, body } of exportedFunctions(src)) {
    const s = body.search(SENSITIVE);
    if (s < 0) continue;
    inspected += 1;
    const g = body.search(GATE);
    if (g < 0 || g > s) offenders.push(`${file.replace(/\\/g, "/")}#${name}`);
  }
}
check("外部取得に繋がる export を 1 本以上見つけた (検査が空振りしていない)", inspected > 4, true);
check("ゲートより前に外部取得する export が無い", offenders, []);

console.log("ゲート本体");
// 2026-10-08: 同じファイルに limitDemoGuest (ゲストだけ絞る) を足したので、
// guardExternalFetch の中だけを見る。
const guardFile = readFileSync("src/lib/server/external-fetch-guard.ts", "utf8");
const guard = guardFile.slice(guardFile.indexOf("export async function guardExternalFetch("));
const demoAt = guard.indexOf("member.isDemoGuest && !opts.allowDemoGuest");
const rlAt = guard.indexOf("await checkRateLimit(");
check("ゲストの判定がレート制限より前", demoAt > 0 && rlAt > demoAt, true);
check("ゲストは IP ごと、メンバーは Discord ID ごとに数える", /isDemoGuest\s*\?\s*`ip:\$\{clientIpFromHeaders\(await headers\(\)\)\}`\s*:\s*`user:\$\{member\.discordId\}`/.test(guard), true);

if (failures > 0) {
  console.log(`\n${failures} 件失敗`);
  process.exit(1);
}
console.log("\nすべて ok");
