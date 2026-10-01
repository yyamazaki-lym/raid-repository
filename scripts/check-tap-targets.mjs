/**
 * スマホ表示の修正 (2026-10-01 監査 U-2 / U-3 / U-8 / U-10) の検査。
 * 実行: `node scripts/check-tap-targets.mjs`
 *
 *   1. U-8: 24 / 28px (`h-6 w-6` / `h-7 w-7`) のクリック要素は `tap-target`
 *      (タッチ端末でだけ当たり判定を 40px 四方に広げる) と position を持つ。
 *      新しく小さなボタンを足したときの付け忘れをここで止める
 *   2. U-8: globals.css の `.tap-target::after` が `(pointer: coarse)` の中だけ
 *      にあり、40px 四方の式であること (PC の見た目と当たり判定は変えない)
 *   3. U-2: ヘッダーの版数の日付は sm 以上だけ・折り返さない
 *   4. U-3: 練習ログのツールバーは折り返す
 *   5. U-10: 過去詳細表は md 未満で横スクロールの一言を出し、表そのものは残す
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

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

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith(".tsx")) out.push(p);
  }
  return out;
}

const INTERACTIVE = new Set([
  "button",
  "a",
  "Link",
  "Button",
  "DropdownMenuTrigger",
  "PopoverTrigger",
  "DialogTrigger",
]);

console.log("1. 小さなクリック要素に tap-target");
{
  const missing = [];
  const unpositioned = [];
  const unknown = [];
  let tagged = 0;
  for (const file of walk("src")) {
    const rel = relative(".", file).replace(/\\/g, "/");
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      if (!/\b(h-6 w-6|h-7 w-7)\b/.test(line)) return;
      // 要素の開きタグを 40 行まで遡って探す (className は属性の最後の方にあり、
      // 間に onClick の本体が挟まることがある)。開きタグは行頭の `<名前` に限る。
      let tag = null;
      let dragHandle = false;
      for (let j = i; j >= Math.max(0, i - 40); j--) {
        if (/\{\.\.\.listeners\}/.test(lines[j])) dragHandle = true;
        const m = /^<([A-Za-z.]+)(?=[\s>]|$)/.exec(lines[j].trim());
        if (m) {
          tag = m[1];
          break;
        }
      }
      const interactive = INTERACTIVE.has(tag) || dragHandle;
      if (!interactive) {
        // 付いているのに対話要素と判定できない = この検査の取りこぼし
        if (/\btap-target\b/.test(line)) unknown.push(`${rel}:${i + 1} <${tag}>`);
        return;
      }
      if (!/\btap-target\b/.test(line)) {
        missing.push(`${rel}:${i + 1} <${tag}>`);
        return;
      }
      tagged += 1;
      if (!/\b(relative|absolute|fixed|sticky)\b/.test(line)) {
        unpositioned.push(`${rel}:${i + 1}`);
      }
    });
  }
  check("付け忘れ 0 件", missing, []);
  check("tap-target の要素は position を持つ", unpositioned, []);
  check("tap-target の要素はすべて対話要素と判定できる", unknown, []);
  check("付けた数 (2026-10-01 時点 46 箇所以上)", tagged >= 46, true);
}

console.log("2. globals.css の .tap-target");
{
  const css = readFileSync("src/app/globals.css", "utf8");
  const at = css.indexOf(".tap-target::after");
  const before = css.slice(0, at);
  const mediaOpen = before.lastIndexOf("@media (pointer: coarse)");
  const between = css.slice(mediaOpen, at);
  check("規則がある", at > 0, true);
  check("(pointer: coarse) の中にだけある", mediaOpen > 0 && !between.includes("}") , true);
  check(".tap-target の規則は 1 つだけ", (css.match(/\.tap-target/g) ?? []).length, 1);
  const rule = css.slice(at, css.indexOf("}", at));
  check("中心から 40px 四方", /inset:\s*min\(0px,\s*calc\(\(100% - 40px\) \/ 2\)\);/.test(rule), true);
  check("中身は空で絶対配置", /content:\s*"";/.test(rule) && /position:\s*absolute;/.test(rule), true);
}

console.log("3. U-2 ヘッダーの版数");
{
  const src = readFileSync("src/components/portal/site-header.tsx", "utf8");
  check("日付は sm 以上だけ", /<span className="hidden sm:inline">\{` \(\$\{APP_DATE\}\)`\}<\/span>/.test(src), true);
  check("版数は折り返さない", /<span className="whitespace-nowrap">\s*v\{APP_VERSION\}/.test(src), true);
}

console.log("4. U-3 練習ログのツールバー");
{
  const src = readFileSync("src/app/(portal)/category/[slug]/logs/logs-view.tsx", "utf8");
  check("3 つの並びは折り返す", /<span className="flex flex-wrap items-center justify-end gap-2">\s*\{difficultyButton\}\s*\{importButton\}\s*\{syncButton\}/.test(src), true);
  check("レポート 0 件の並びも折り返す", /<div className="flex flex-wrap justify-end gap-2">\s*\{importButton\}\s*\{syncButton\}/.test(src), true);
}

console.log("5. U-10 過去詳細表");
{
  const src = readFileSync("src/components/portal/schedule-list.tsx", "utf8");
  const at = src.indexOf("m.schedule.pastTableScrollHint");
  check("md 未満でだけ一言", at > 0 && /className="[^"]*\bmd:hidden"[^>]*>\s*\{$/.test(src.slice(0, at)), true);
  const after = src.slice(at, at + 400);
  check("表は全幅で残す (md:block に限定しない)", /<div className="overflow-x-auto">\s*<table className="w-full min-w-\[640px\]/.test(after), true);
  const core = readFileSync("src/lib/i18n/dict/core.ts", "utf8");
  check("ja / en の文言", (core.match(/pastTableScrollHint:/g) ?? []).length, 2);
}

if (failures > 0) {
  console.log(`\n${failures} 件失敗`);
  process.exit(1);
}
console.log("\nすべて ok");
