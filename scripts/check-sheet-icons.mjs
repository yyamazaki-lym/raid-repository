/**
 * 軽減表アイコン抽出 / ジョブガイド名寄せの検証 (2026-08-31)。
 * 実行: `node scripts/check-sheet-icons.mjs`
 *
 * ここが壊れると「アイコンから判定」が誤った列に誤った名前を入れる。
 * 列番号のズレ (colspan / 行見出し) と、名前として拾ってはいけない文字列を
 * 重点的に見る。
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const SRC = "src/lib/sheet-icons.ts";

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

const outDir = mkdtempSync(join(tmpdir(), "sheet-icons-check-"));
try {
  execFileSync(
    "npx",
    [
      "tsc",
      SRC,
      "--outDir",
      outDir,
      "--target",
      "es2022",
      "--module",
      "es2022",
      "--moduleResolution",
      "bundler",
      "--strict",
    ],
    { stdio: "inherit" },
  );
  const mod = await import(pathToFileURL(join(outDir, "sheet-icons.js")).href);

  const IMG = (u) => `<img src="${u}">`;

  console.log("\n[列番号が CSV と一致すること]");
  // Google の HTML ビューは先頭に行番号の th (row-headers-background) を置く。
  // これを 1 列と数えると全列が 1 つズレる。
  const html1 = `
    <table>
      <tr><th class="row-header row-headers-background">26</th>
          <td>Action</td><td>${IMG("https://lds-img.finalfantasyxiv.com/h/a/aaa.png")}</td>
          <td>${IMG("https://lds-img.finalfantasyxiv.com/h/b/bbb.png")}</td></tr>
    </table>`;
  const rows1 = mod.parseSheetImageRows(html1);
  check("画像のある行が 1 行", rows1.length, 1);
  check("行番号 th は列に数えない", rows1[0].cells.map((c) => c.column), [1, 2]);

  // colspan で結合されたセルがあると、その分だけ後続の列がずれる。
  const html2 = `
    <table>
      <tr><td colspan="3">攻撃</td><td>${IMG("https://x/i/c.png")}</td></tr>
    </table>`;
  const rows2 = mod.parseSheetImageRows(html2);
  check("colspan を列数に反映", rows2[0].cells[0].column, 3);

  console.log("\n[アイコン行の選び方]");
  const rows3 = [
    { row: 0, cells: [{ column: 1, src: "a" }] },
    { row: 26, cells: [{ column: 1, src: "a" }, { column: 2, src: "b" }, { column: 3, src: "c" }] },
    { row: 40, cells: [{ column: 1, src: "a" }, { column: 2, src: "b" }] },
  ];
  check("画像が最も多い行を選ぶ", mod.pickIconRow(rows3).row, 26);
  // 装飾画像が 1 枚だけの行を「アビリティ行」と誤認しない。
  check(
    "画像 1 枚だけなら選ばない",
    mod.pickIconRow([{ row: 3, cells: [{ column: 1, src: "a" }] }]),
    null,
  );
  check("空なら null", mod.pickIconRow([]), null);

  console.log("\n[アイコンキーの正規化]");
  check(
    "拡張子を落とした basename",
    mod.iconKey("https://lds-img.finalfantasyxiv.com/h/E/abc123.png"),
    "abc123",
  );
  // シートの =IMAGE() は Google の画像プロキシ越しになることがある。
  check(
    "Google プロキシを剥がす",
    mod.iconKey(
      "https://images-proxy.googleusercontent.com/x?url=" +
        encodeURIComponent("https://lds-img.finalfantasyxiv.com/h/E/abc123.png"),
    ),
    "abc123",
  );
  check("クエリ付きでも同じキー", mod.iconKey("https://x/y/abc123.png?w=40"), "abc123");
  check("URL でなければ null", mod.iconKey(""), null);

  console.log("\n[ジョブガイドの解析]");
  const index = `
    <a href="/jobguide/battle/">戦闘職</a>
    <a href="/jobguide/paladin/">ナイト</a>
    <a href="/jobguide/paladin/">ナイト(重複)</a>
    <a href="/jobguide/whitemage/">白魔道士</a>
    <a href="/lodestone/">ロドスト</a>`;
  check("ジョブページだけ / 重複なし", mod.extractJobPaths(index), [
    "/jobguide/paladin/",
    "/jobguide/whitemage/",
  ]);

  const jobPage = `
    <div class="job__content">
      <img src="https://lds-img.finalfantasyxiv.com/h/1/keihi.png" width="40">
      <p class="job__skill_name">牽制</p>
      <p class="job__skill_text">敵に命中率低下と与ダメージ低下を付与する。</p>
      <img src="https://lds-img.finalfantasyxiv.com/h/2/rampart.png">
      <p class="job__skill_name">ランパート</p>
    </div>`;
  const pairs = mod.extractIconNamePairs(jobPage);
  check("アイコンと名前の対応を拾う", pairs, [
    ["keihi", "牽制"],
    ["rampart", "ランパート"],
  ]);

  // 公式 CDN 以外の画像 (ロゴ・バナー等) から名前を作らない。
  check(
    "公式 CDN 以外は無視",
    mod.extractIconNamePairs(`<img src="https://example.com/logo.png"><p>ナイト</p>`),
    [],
  );
  // 説明文を名前として拾わない (句読点を含むものは除外)。
  check(
    "説明文は名前にしない",
    mod.extractIconNamePairs(
      `<img src="https://lds-img.finalfantasyxiv.com/h/3/z.png"><p>効果時間：15秒</p><p>牽制</p>`,
    ),
    [["z", "牽制"]],
  );
  // 英数字だけのラベル (リキャスト値など) も名前にしない。
  check(
    "日本語を含まないものは名前にしない",
    mod.extractIconNamePairs(
      `<img src="https://lds-img.finalfantasyxiv.com/h/4/w.png"><p>90s</p><p>アドル</p>`,
    ),
    [["w", "アドル"]],
  );

  console.log("\n[\u5019\u88dc\u306e\u9078\u3073\u65b9 (\u30c1\u30a7\u30c3\u30af\u5217\u3068\u306e\u91cd\u306a\u308a)]");
  // 2026-08-31 \u5b9f\u6a5f: \u767b\u9332\u30bf\u30d6\u540d\u3067\u30b7\u30fc\u30c8\u3092\u5f53\u3066\u306b\u3044\u304d\u5916\u3057\u3001
  // \u5225\u30b7\u30fc\u30c8\u306e 11 \u884c\u76ee\u3092\u63b4\u3093\u3067\u5217\u304c\u307e\u308b\u3054\u3068\u30ba\u30ec\u305f\u3002\u540d\u524d\u3067\u306f\u306a\u304f
  // \u91cd\u306a\u308a\u3067\u9078\u3076\u3053\u3068\u3067\u3053\u308c\u3092\u9632\u3050\u3002
  const cand = (sheet, row, cols) => ({
    sheet,
    row,
    cells: cols.map((c) => ({ column: c, src: `i${c}` })),
  });
  const checkCols = [118, 119, 120, 130, 131];
  const picked = mod.pickBestCandidate(
    [
      // \u5225\u30b7\u30fc\u30c8\u306e\u30a2\u30a4\u30b3\u30f3\u884c (\u6570\u306f\u591a\u3044\u304c\u5217\u304c\u9055\u3046)
      cand("Settings", 10, [1, 2, 3, 4, 5, 6, 7]),
      // \u672c\u547d
      cand("M12S-2", 25, [118, 119, 130]),
    ],
    checkCols,
  );
  check("\u91cd\u306a\u308a\u306e\u591a\u3044\u5019\u88dc\u3092\u9078\u3076", picked.best.sheet, "M12S-2");
  check("\u91cd\u306a\u308a\u6570\u3092\u8fd4\u3059", picked.overlap, 3);
  // \u4ef6\u6570\u304c\u591a\u3044\u3060\u3051\u306e\u5019\u88dc\u306b\u5f15\u3063\u5f35\u3089\u308c\u306a\u3044\u3053\u3068\u3002
  check(
    "\u91cd\u306a\u308a\u304c\u7121\u3051\u308c\u3070\u63a1\u7528\u3057\u306a\u3044",
    mod.pickBestCandidate([cand("Settings", 10, [1, 2, 3, 4, 5, 6, 7])], checkCols),
    null,
  );
  check("\u5019\u88dc\u304c\u7121\u3051\u308c\u3070 null", mod.pickBestCandidate([], checkCols), null);

  console.log("\n[\u5217\u756a\u53f7 \u2192 \u5217\u8a18\u53f7]");
  check("0 \u306f A", mod.letterOf(0), "A");
  check("25 \u306f Z", mod.letterOf(25), "Z");
  check("26 \u306f AA", mod.letterOf(26), "AA");
  check("118 \u306f DO", mod.letterOf(118), "DO");
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

console.log(failures === 0 ? "\nすべて OK" : `\n${failures} 件 FAIL`);
process.exit(failures === 0 ? 0 : 1);
