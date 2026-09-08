/**
 * 入力文字数エラー文 (src/lib/text-length-error.ts) の検証 (2026-09-07)。
 * 実行: `node scripts/check-text-length-error.mjs`
 *
 * 4 つの client モジュール (category-macros / category-waymarks /
 * recruitment-templates / schedule-memos) に同じ形で重複していた
 * 「本文が長すぎます（最大 N 文字）」を 1 箇所に集約し、表示言語で
 * 切り替えられるようにした。集約で挙動が変わっていないこと (境界値、
 * 部分更新で未指定の欄を検査しないこと、報告順) を固定する。
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
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

const outDir = mkdtempSync(join(tmpdir(), "text-length-check-"));
try {
  execFileSync(
    process.execPath,
    [
      "node_modules/typescript/bin/tsc", "src/lib/text-length-error.ts",
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
  const { textLengthError, noPermissionError } = await import(
    pathToFileURL(join(outDir, "text-length-error.js")).href
  );

  const body = (n) => "あ".repeat(n);

  console.log("境界値");
  check("上限ちょうどは通す", textLengthError([{ field: "body", value: body(10), max: 10 }]), null);
  check(
    "1 文字超えると弾く",
    textLengthError([{ field: "body", value: body(11), max: 10 }]),
    "本文が長すぎます（最大 10 文字）",
  );
  check("空文字は通す", textLengthError([{ field: "body", value: "", max: 10 }]), null);
  check("検査対象なしは通す", textLengthError([]), null);

  console.log("\n部分更新 (patch) の扱い");
  check(
    "undefined の欄は検査しない",
    textLengthError([
      { field: "label", value: undefined, max: 1 },
      { field: "body", value: body(1), max: 10 },
    ]),
    null,
  );
  check(
    "null の欄も検査しない (note は null 許容)",
    textLengthError([{ field: "note", value: null, max: 1 }]),
    null,
  );

  console.log("\n報告は 1 件だけ / 渡した順");
  check(
    "本文とラベルが両方超えていても本文だけ返す",
    textLengthError([
      { field: "body", value: body(11), max: 10 },
      { field: "label", value: body(11), max: 10 },
    ]),
    "本文が長すぎます（最大 10 文字）",
  );
  check(
    "順を入れ替えるとラベルが先に出る",
    textLengthError([
      { field: "label", value: body(11), max: 10 },
      { field: "body", value: body(11), max: 10 },
    ]),
    "ラベルが長すぎます（最大 10 文字）",
  );

  console.log("\n欄の名前 (ja)");
  for (const [field, label] of [
    ["body", "本文"],
    ["label", "ラベル"],
    ["note", "メモ"],
    ["name", "名前"],
  ]) {
    check(
      `${field} → ${label}`,
      textLengthError([{ field, value: body(2), max: 1 }]),
      `${label}が長すぎます（最大 1 文字）`,
    );
  }

  console.log("\n表示言語 en");
  check(
    "本文",
    textLengthError([{ field: "body", value: body(2), max: 1 }], "en"),
    "Body is too long (max 1 characters)",
  );
  check(
    "メモ",
    textLengthError([{ field: "note", value: body(2), max: 1 }], "en"),
    "Note is too long (max 1 characters)",
  );
  check(
    "既定は ja (locale 省略)",
    textLengthError([{ field: "name", value: body(2), max: 1 }]),
    "名前が長すぎます（最大 1 文字）",
  );

  console.log("\n文字数の数え方");
  // サロゲートペア (絵文字) は UTF-16 で 2。Postgres の char_length は 1 に
  // 数えるので、ここで弾いても DB は通る = 安全側に倒れていることを固定。
  check("絵文字 1 個は 2 文字と数える", textLengthError([{ field: "body", value: "🐛", max: 1 }]), "本文が長すぎます（最大 1 文字）");
  check("結合なしの絵文字 1 個は上限 2 なら通る", textLengthError([{ field: "body", value: "🐛", max: 2 }]), null);

  console.log("\n権限エラー文");
  check("更新 (ja)", noPermissionError("update"), "更新できませんでした（権限がない可能性があります）");
  check("削除 (ja)", noPermissionError("delete"), "削除できませんでした（権限がない可能性があります）");
  check("更新 (en)", noPermissionError("update", "en"), "Could not update it (you may not have permission)");
  check("削除 (en)", noPermissionError("delete", "en"), "Could not delete it (you may not have permission)");
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
