/**
 * 設定辞書の分離が崩れていないかの検査 (2026-09-09)。
 * 実行: `node scripts/check-i18n-settings-dict.mjs [--list]`
 *
 * ## なぜ要るのか
 *
 * `dict/*` 4 本を静的に合成して `MESSAGES[locale]` と添字アクセスする形だと
 * **ランタイム添字で tree-shake が効かず**、ja / en 全辞書が 1 つの chunk
 * (216KB raw / 72.5KB gz) になって**全ポータルページの初期 JS に載る**。
 * 設定辞書はその 31% を占めるのに、使うのは `next/dynamic` で遅延化済みの
 * 設定ダイアログの中だけだった (= 既存の lazy 化が文言側で相殺されていた)。
 *
 * 2026-09-09 に設定辞書を `SettingsMessagesProvider` 経由へ移したが、これは
 * **型では守れない**分離になっている:
 *
 *   - `Messages` の型は分離前と同じ (設定セクションも含む) ので tsc は通る
 *   - Provider の外側で `m.nativeMembers` を読むと **runtime で undefined**
 *   - 常時読み込みのモジュールが `dict/settings` を import すると、
 *     chunk が元に戻る (バンドルは増えるが、動くのでテストでは気付けない)
 *
 * どちらも実行時か実測でしか現れないので、ここで構造として固定する。
 *
 * ## 何を見るか
 *
 *   1. `dict/settings.ts` を import しているのは許可された経路だけか
 *      (`settings/settings-messages.tsx` と `lib/i18n/server.ts`)
 *   2. `"use client"` のファイルが、設定ダイアログの外から設定セクションを
 *      読んでいないか
 *
 * Server Component (`"use client"` なし) は `getMessages()` から**全部入り**を
 * 受け取るので対象外。
 *
 * `--list` を付けると、どのセクションがどちらの辞書に属するかを出す。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = "src";
const SETTINGS_DICT = "src/lib/i18n/dict/settings.ts";

/** `dict/settings.ts` を import してよいファイル (パスは `/` 区切り)。 */
const DICT_IMPORT_ALLOWED = new Set([
  // 設定ダイアログの chunk に辞書を載せる本体。
  "src/components/portal/settings/settings-messages.tsx",
  // Server Component 向けは全部入りを返す (server バンドルは初期 JS に載らない)。
  "src/lib/i18n/server.ts",
]);

/**
 * 設定セクションを読んでよい client ファイル。
 *
 * `src/components/portal/settings/**` と `settings-dialog.tsx` は
 * Provider の内側。下記は Provider の内側でだけ描画される部品
 * (描画元をたどって確認したもの)。
 */
const SECTION_USE_ALLOWED_PREFIXES = [
  "src/components/portal/settings/",
];
const SECTION_USE_ALLOWED_FILES = new Set([
  "src/components/portal/settings-dialog.tsx",
  // danger-zone-section (設定内) からのみ描画される確認ダイアログ。
  "src/components/portal/data-init-confirm-dialog.tsx",
]);

let failures = 0;
function fail(msg) {
  failures += 1;
  console.log(`  FAIL ${msg}`);
}
function ok(msg) {
  console.log(`  ok   ${msg}`);
}

/** ソースの全ファイル。 */
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p.replace(/\\/g, "/"));
  }
  return out;
}

/** オブジェクトリテラルのトップレベルキー (インデント 2、括弧の対応で判定)。 */
function topLevelKeys(src, objName) {
  const start = src.indexOf(`export const ${objName}`);
  if (start < 0) return [];
  const open = src.indexOf("{", start);
  const keys = [];
  let depth = 0;
  let i = open;
  while (i < src.length) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") {
      const j = src.indexOf("\n", i);
      i = j < 0 ? src.length : j;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const j = src.indexOf("*/", i);
      i = j < 0 ? src.length : j + 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      i += 1;
      while (i < src.length) {
        if (src[i] === "\\") {
          i += 2;
          continue;
        }
        if (src[i] === q) {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    if (c === "{" || c === "[" || c === "(") {
      depth += 1;
      i += 1;
      continue;
    }
    if (c === "}" || c === "]" || c === ")") {
      depth -= 1;
      if (depth === 0) break;
      i += 1;
      continue;
    }
    if (depth === 1) {
      const m = /^\n {2}([A-Za-z][A-Za-z0-9_]*):/.exec(src.slice(i, i + 60));
      if (m) {
        keys.push(m[1]);
        i += m[0].length;
        continue;
      }
    }
    i += 1;
  }
  return keys;
}

const settingsSrc = readFileSync(SETTINGS_DICT, "utf8");
const settingsSections = topLevelKeys(settingsSrc, "ja");
if (settingsSections.length === 0) {
  fail("dict/settings.ts のセクションを 1 つも読み取れなかった (検査が壊れている)");
}

const baseSections = new Set();
for (const f of ["core", "content", "logs"]) {
  for (const k of topLevelKeys(
    readFileSync(`src/lib/i18n/dict/${f}.ts`, "utf8"),
    "ja",
  )) {
    baseSections.add(k);
  }
}

if (process.argv.includes("--list")) {
  console.log("[常時読み込み (core / content / logs)]");
  console.log("  " + [...baseSections].sort().join(" "));
  console.log("\n[設定ダイアログの chunk (settings)]");
  console.log("  " + [...settingsSections].sort().join(" "));
  process.exit(0);
}

const files = walk(SRC);

console.log("[dict/settings.ts の import 元]");
{
  const offenders = [];
  for (const f of files) {
    if (f === SETTINGS_DICT) continue;
    const src = readFileSync(f, "utf8");
    if (!/from "(\.\.?\/)*(@\/lib\/i18n\/)?dict\/settings"/.test(src) &&
        !/i18n\/dict\/settings"/.test(src)) {
      continue;
    }
    if (!DICT_IMPORT_ALLOWED.has(f)) offenders.push(f);
  }
  if (offenders.length === 0) {
    ok(`許可された ${DICT_IMPORT_ALLOWED.size} 経路だけが import している`);
  } else {
    for (const f of offenders) {
      fail(
        `${f} が dict/settings を import している — 常時読み込みの chunk に ` +
          `辞書が戻る。設定ダイアログの部分木から使うか、文言を dict/content へ移すこと`,
      );
    }
  }
}

console.log("\n[設定セクションを Provider の外から読んでいないか]");
{
  const sectionRe = new RegExp(
    `\\bm\\.(${settingsSections.join("|")})\\b`,
    "g",
  );
  const offenders = [];
  let scanned = 0;
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    // Server Component は getMessages() から全部入りを受け取るので対象外。
    if (!/^\s*"use client";/m.test(src)) continue;
    if (
      SECTION_USE_ALLOWED_FILES.has(f) ||
      SECTION_USE_ALLOWED_PREFIXES.some((p) => f.startsWith(p))
    ) {
      continue;
    }
    scanned += 1;
    const hits = [...new Set([...src.matchAll(sectionRe)].map((m) => m[1]))];
    if (hits.length > 0) offenders.push([f, hits]);
  }
  if (offenders.length === 0) {
    ok(`client ${scanned} ファイルで参照なし`);
  } else {
    for (const [f, hits] of offenders) {
      fail(
        `${f} が設定セクション (${hits.join(", ")}) を読んでいる — 型は通るが ` +
          `runtime で undefined。文言を dict/content へ移すこと`,
      );
    }
  }
}

console.log("\n[分離の前提]");
{
  const client = readFileSync("src/lib/i18n/client.tsx", "utf8");
  const messages = readFileSync("src/lib/i18n/messages.ts", "utf8");
  if (/dict\/settings/.test(client)) {
    fail("lib/i18n/client.tsx が dict/settings に触れている (常時読み込み)");
  } else {
    ok("client.tsx は dict/settings を参照しない");
  }
  if (/^import \{[^}]*\} from "\.\/dict\/settings";$/m.test(messages)) {
    fail("messages.ts が dict/settings を値として import している");
  } else {
    ok("messages.ts の dict/settings 参照は型だけ");
  }
  const overlap = settingsSections.filter((s) => baseSections.has(s));
  if (overlap.length > 0) {
    fail(`セクション名が重複している (スプレッドで後勝ちに潰れる): ${overlap.join(", ")}`);
  } else {
    ok("セクション名の重複なし");
  }
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
