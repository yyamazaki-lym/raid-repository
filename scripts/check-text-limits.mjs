/**
 * コンテンツとリンクの文字数上限 (src/lib/text-limits.ts) の検査
 * (2026-10-01 監査 U-7)。
 * 実行: `node scripts/check-text-limits.mjs`
 *
 *   1. `clampText` がコードポイント単位で切る (絵文字の途中で切らない)
 *   2. TS の上限と schema.sql の CHECK (`categories_text_sane` /
 *      `category_links_text_sane`) の値が一致する — 片方だけ変えると、
 *      画面と Server Action を通った値が DB で弾かれる (または逆に DB の
 *      上限まで使えない)
 *   3. 自動取り込み (Discord / Google フォト) がリンクのタイトルを切り詰めて
 *      から保存する — 1 行でも上限を超えると bulk upsert ごと失敗する
 *   4. 利用者が入力する 3 つのフォームに maxLength がある
 */
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

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

const outDir = mkdtempSync(join(tmpdir(), "text-limits-check-"));
try {
  execFileSync(
    process.execPath,
    [
      "node_modules/typescript/bin/tsc",
      "src/lib/text-limits.ts",
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
    writeFileSync(
      fp,
      readFileSync(fp, "utf8").replace(
        /(from\s+["'])(\.\.?\/[^"']+?)(?<!\.js)(["'])/g,
        "$1$2.js$3",
      ),
    );
  }
  const L = await import(pathToFileURL(join(outDir, "text-limits.js")).href);

  console.log("clampText");
  check("上限以内はそのまま", L.clampText("abc", 3), "abc");
  check("超えたら切る", L.clampText("abcdef", 3), "abc");
  check("絵文字を途中で切らない (コードポイント単位)", L.clampText("ab😀c", 3), "ab😀");
  check("絵文字だけ", [...L.clampText("😀😀😀😀", 2)].length, 2);

  console.log("schema の CHECK と一致");
  const sql = readFileSync("supabase/schema.sql", "utf8");
  const block = (name) => {
    const at = sql.indexOf(`ADD CONSTRAINT ${name}`);
    return at < 0 ? "" : sql.slice(at, sql.indexOf(") NOT VALID;", at));
  };
  const cat = block("categories_text_sane");
  const link = block("category_links_text_sane");
  const max = (blockSrc, col) =>
    Number(blockSrc.match(new RegExp(`char_length\\(${col}\\) <= (\\d+)`))?.[1]);
  check("categories.name", max(cat, "name"), L.CATEGORY_NAME_MAX);
  check("categories.description", max(cat, "description"), L.CATEGORY_DESCRIPTION_MAX);
  check("category_links.title", max(link, "title"), L.LINK_TITLE_MAX);
  check("category_links.url", max(link, "url"), L.LINK_URL_MAX);
  check("category_links.description", max(link, "description"), L.LINK_DESCRIPTION_MAX);
  check("既存行を検査しない (NOT VALID)", cat.length > 0 && link.length > 0, true);

  console.log("自動取り込みは切り詰めてから保存");
  const imp = readFileSync("src/lib/server/discord-import.ts", "utf8");
  check("Discord 取り込み: タイトルを切る", /title: clampText\(e\.title \?\? e\.url, LINK_TITLE_MAX\)/.test(imp), true);
  check("Discord 取り込み: 上限を超える URL は入れない", /\.filter\(\(e\) => e\.url\.length <= LINK_URL_MAX\)/.test(imp), true);
  const actions = readFileSync("src/lib/server/categories-actions.ts", "utf8");
  const gphotoInserts = [...actions.matchAll(/kind: "gphoto" as const,\s*(?:\/\/[^\n]*\n\s*)?title: ([^\n]+)/g)].map((m) => m[1]);
  check("Google フォト: 2 箇所とも切る", gphotoInserts.length === 2 && gphotoInserts.every((t) => t.startsWith("clampText(")), true);

  console.log("入力欄の maxLength");
  for (const [file, consts] of [
    ["src/components/portal/link-form-dialog.tsx", ["LINK_URL_MAX", "LINK_TITLE_MAX", "LINK_DESCRIPTION_MAX"]],
    ["src/components/portal/image-form-dialog.tsx", ["LINK_URL_MAX", "LINK_TITLE_MAX", "LINK_DESCRIPTION_MAX"]],
    ["src/components/portal/category-form-dialog.tsx", ["CATEGORY_NAME_MAX", "CATEGORY_DESCRIPTION_MAX"]],
  ]) {
    const src = readFileSync(file, "utf8");
    check(file, consts.every((c) => src.includes(`maxLength={${c}}`)), true);
  }
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

if (failures > 0) {
  console.log(`\n${failures} 件失敗`);
  process.exit(1);
}
console.log("\nすべて ok");
