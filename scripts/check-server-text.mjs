/**
 * Server Action の日本語の失敗理由を表示言語に訳す仕組み (2026-10-01 監査 U-6)
 * の検査。
 * 実行: `node scripts/check-server-text.mjs [--stale]`
 *
 *   1. 訳す処理 (src/lib/i18n/server-text.ts) の境界: 完全一致 / 雛形 (先頭・
 *      途中・末尾の差し込み) / 「{見出し}に失敗しました」/ 文中の部分一致 /
 *      辞書に無い日本語はそのまま / 日本語表示では何もしない / トーストの
 *      差し替えと元に戻す処理
 *   2. **辞書の網羅**: src/lib/server と text-length-error.ts の `reason` の
 *      日本語 (文字列とテンプレート) と `dbError()` の見出しが、すべて
 *      src/lib/i18n/server-text-en.ts にあること。新しい日本語の理由を
 *      足したのに訳を足し忘れると、ここで落ちる
 *   3. 配線: root layout に ServerTextLocalizer があり、英語表示のときだけ
 *      辞書を読み込む。画面の中に出すエラー (`setError(r.reason)` など) は
 *      `sr(...)` で訳す
 *
 * `--stale` を付けると、辞書にあるがソースから消えたキーを出す (棚卸し用)。
 */
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
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

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const outDir = mkdtempSync(join(tmpdir(), "server-text-check-"));
try {
  execFileSync(
    process.execPath,
    [
      "node_modules/typescript/bin/tsc",
      "src/lib/i18n/server-text.ts",
      "src/lib/i18n/server-text-en.ts",
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
  const st = await import(pathToFileURL(join(outDir, "server-text.js")).href);
  const { SERVER_TEXT_EN } = await import(
    pathToFileURL(join(outDir, "server-text-en.js")).href
  );
  const dict = st.compileServerTextDict(SERVER_TEXT_EN);
  const tr = (s) => st.localizeServerText(s, dict);

  console.log("1. 訳す処理");
  check("完全一致", tr("ADMIN ロールが必要です"), "The ADMIN role is required");
  check("日本語表示 (辞書なし) はそのまま", st.localizeServerText("ADMIN ロールが必要です", null), "ADMIN ロールが必要です");
  check("日本語を含まない文はそのまま", tr("discord api 429 (page 2)"), "discord api 429 (page 2)");
  check("dbError の見出し", tr("リンク作成に失敗しました"), "Failed to create the link");
  check("dbError の見出し (差し込みあり)", tr("native_schedule_sessions 削除に失敗しました"), "Failed to delete native_schedule_sessions");
  check("雛形: 先頭の差し込み", tr("3 行目: 日時の形式が不正です"), "Row 3: invalid date/time format");
  check(
    "雛形: 先頭の差し込みは空白までで、前の英文を取り込まない",
    tr("Import failed: 3 行目: 日時の形式が不正です"),
    "Import failed: Row 3: invalid date/time format",
  );
  check("雛形: 末尾の差し込み", tr("アルバムの取得に失敗しました: 404 Not Found"), "Failed to fetch the album: 404 Not Found");
  check("雛形: 差し込み 2 つ", tr("参加可能 3 人 < 必要 5 人"), "3 available < 5 required");
  check("雛形: 途中の差し込み", tr("ユーザー「alice」が見つかりません"), 'User "alice" was not found');
  check("英語の雛形に埋め込まれた理由", tr("Save failed: 保存できませんでした"), "Save failed: Could not save");
  check("英語の雛形に埋め込まれた dbError", tr("Save failed: カテゴリ作成に失敗しました"), "Save failed: Failed to create the content");
  check("文字列の後ろに続きがある理由", tr("暗号化保存に失敗: invalid key"), "Failed to store encrypted: invalid key");
  check("辞書に無い日本語はそのまま", tr("未知のエラーです"), "未知のエラーです");
  check("出席サマリー (文全体が「…に失敗しました」の固定文言)", tr("出席サマリーの取得に失敗しました"), "Failed to load the attendance summary");

  console.log("   トーストの差し替え");
  {
    const calls = [];
    const fake = {
      error: (msg, data) => calls.push(["error", msg, data]),
      success: (msg, data) => calls.push(["success", msg, data]),
      dismiss: () => calls.push(["dismiss"]),
    };
    const origError = fake.error;
    const restore = st.patchToastMethods(fake, tr);
    fake.error("ADMIN ロールが必要です");
    fake.success("ok", { description: "保存できませんでした" });
    const jsx = { type: "span" };
    fake.error(jsx);
    check("本文を訳す", calls[0], ["error", "The ADMIN role is required", undefined]);
    check("description を訳す", calls[1], ["success", "ok", { description: "Could not save" }]);
    check("文字列でない本文はそのまま", calls[2][1] === jsx, true);
    let translated = 0;
    const restore2 = st.patchToastMethods(fake, (s) => {
      translated += 1;
      return tr(s);
    });
    fake.error("ADMIN ロールが必要です");
    check("二重に掛けない (2 回目の差し替えは何もしない)", [calls[3][1], translated], ["The ADMIN role is required", 0]);
    restore2();
    restore();
    check("元に戻す", fake.error === origError, true);
    fake.error("ADMIN ロールが必要です");
    check("戻したあとは訳さない", calls[4][1], "ADMIN ロールが必要です");
    check("dismiss などは触らない", st.LOCALIZED_TOAST_METHODS.includes("dismiss"), false);
  }

  console.log("2. 辞書の網羅");
  {
    const JA = /[ぁ-んァ-ヶ一-龠ー]/;
    const files = [...walk("src/lib/server"), "src/lib/text-length-error.ts"];
    const literals = new Set();
    const templates = new Set();
    const labels = new Set();
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/\breason\s*[:=]\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/g)) {
        if (!JA.test(m[2])) continue;
        if (m[1] === "`" && m[2].includes("${")) templates.add(m[2]);
        else literals.add(m[2]);
      }
      for (const m of src.matchAll(/dbError\(\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/g)) {
        if (JA.test(m[2])) labels.add(m[2]);
      }
    }
    const miss = (set, dictPart) => [...set].filter((k) => !(k in dictPart)).sort();
    check(`reason の固定文言 ${literals.size} 件がすべて辞書にある`, miss(literals, SERVER_TEXT_EN.exact), []);
    check(`reason の雛形 ${templates.size} 件がすべて辞書にある`, miss(templates, SERVER_TEXT_EN.templates), []);
    check(`dbError の見出し ${labels.size} 件がすべて辞書にある`, miss(labels, SERVER_TEXT_EN.labels), []);
    check("抽出が空でない (検査が壊れていない)", literals.size > 100 && labels.size > 100, true);
    // 訳に日本語が残っていない / 雛形の差し込み数が合う
    const jaLeft = Object.entries({ ...SERVER_TEXT_EN.exact, ...SERVER_TEXT_EN.templates, ...SERVER_TEXT_EN.labels })
      .filter(([, en]) => JA.test(en)).map(([k]) => k);
    check("訳に日本語が残っていない", jaLeft, []);
    const holes = Object.entries({ ...SERVER_TEXT_EN.templates, ...SERVER_TEXT_EN.labels })
      .filter(([ja, en]) => (ja.match(/\$\{/g) ?? []).length !== new Set(en.match(/\{\d+\}/g) ?? []).size)
      .map(([k]) => k);
    check("雛形の差し込みの数が訳と合う", holes, []);
    if (process.argv.includes("--stale")) {
      const stale = [
        ...Object.keys(SERVER_TEXT_EN.exact).filter((k) => !literals.has(k)),
        ...Object.keys(SERVER_TEXT_EN.templates).filter((k) => !templates.has(k)),
        ...Object.keys(SERVER_TEXT_EN.labels).filter((k) => !labels.has(k)),
      ];
      console.log(`  (ソースから消えたキー ${stale.length} 件)`);
      for (const k of stale) console.log(`       ${k}`);
    }
  }

  console.log("3. 配線");
  {
    const layout = readFileSync("src/app/layout.tsx", "utf8");
    check("root layout に ServerTextLocalizer", /<ServerTextLocalizer locale=\{locale\} \/>/.test(layout), true);
    const loc = readFileSync("src/components/server-text-localizer.tsx", "utf8");
    check("英語表示のときだけ動く", /if \(locale !== "en"\) return;/.test(loc), true);
    check("辞書は遅延読み込み", /loadServerTextEn\(\)/.test(loc), true);
    check("言語を切り替えたら元に戻す", /restore\?\.\(\);/.test(loc), true);
    const hook = readFileSync("src/lib/i18n/use-server-text.ts", "utf8");
    check("辞書は dynamic import (日本語表示には配らない)", /import\("\.\/server-text-en"\)/.test(hook), true);
    const staticImports = walk("src").filter((f) => {
      const s = readFileSync(f, "utf8");
      return /from ["']@\/lib\/i18n\/server-text-en["']|from ["']\.\/server-text-en["']/.test(s);
    }).map((f) => relative(".", f).replace(/\\/g, "/"));
    check("辞書を静的に import している所が無い", staticImports, []);

    // 画面の中に出すエラー: 状態に入れるときに sr(...) で訳す。effect の中で
    // 入れるもの (依存を増やさないため) は、表示するときに sr(...) で訳す。
    const RENDER_TRANSLATED = {
      "src/components/portal/logs/pull-detail-panel.tsx": /\{sr\(state\.reason\)\}/,
      "src/components/portal/settings/logs-notify-section.tsx": /loadFailed\(sr\(loadError\)\)/,
      "src/components/portal/settings/report-discovery.tsx": /loadFailed\(sr\(loadError\)\)/,
    };
    const raw = [];
    for (const f of [...walk("src/components"), ...walk("src/app")]) {
      const rel = relative(".", f).replace(/\\/g, "/");
      if (rel.includes("/api/") || !rel.endsWith(".tsx")) continue;
      const lines = readFileSync(f, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (!/\bset[A-Z]\w*\(/.test(line) || !/\.reason\b/.test(line)) return;
        if (/\bsr\(/.test(line)) return;
        const rule = RENDER_TRANSLATED[rel];
        if (rule && rule.test(lines.join("\n"))) return;
        raw.push(`${rel}:${i + 1}`);
      });
    }
    check("画面の中に出すエラーは訳してから出す", raw, []);
  }
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

if (failures > 0) {
  console.log(`\n${failures} 件失敗`);
  process.exit(1);
}
console.log("\nすべて ok");
