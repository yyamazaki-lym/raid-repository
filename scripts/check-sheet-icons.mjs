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
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

console.log(failures === 0 ? "\nすべて OK" : `\n${failures} 件 FAIL`);
process.exit(failures === 0 ? 0 : 1);
