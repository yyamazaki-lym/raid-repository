/**
 * Discord に流す文の無害化 (src/lib/discord-text.ts、2026-10-07 セキュリティ
 * 精査) の検証。
 * 実行: `node scripts/check-discord-text.mjs`
 *
 *   1. メンションの構文を崩す / Markdown の記号を文字として出す / 1 行に収める
 *   2. 配線: 開催確定の通知の出欠記号 (メンバーが自由に書ける) は 3 つとも通す
 *
 * ⚠ tsc は `process.execPath` + `node_modules/typescript/bin/tsc` で起動する
 *   (`npx` 経由は Windows で ENOENT / EINVAL になる)。
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}\n       expected: ${e}\n       actual:   ${a}`);
  }
}

const outDir = mkdtempSync(join(tmpdir(), "discord-text-check-"));
try {
  execFileSync(
    process.execPath,
    [
      "node_modules/typescript/bin/tsc",
      "src/lib/discord-text.ts",
      "--outDir", outDir,
      "--target", "es2022",
      "--module", "es2022",
      "--moduleResolution", "bundler",
      "--strict",
    ],
    { stdio: "inherit" },
  );
  const m = await import(pathToFileURL(join(outDir, "discord-text.js")).href);
  const zwsp = String.fromCharCode(0x200b);

  console.log("[メンション]");
  check("@everyone", m.neutralizeMentions("@everyone"), `@${zwsp}everyone`);
  check("@here", m.neutralizeMentions("a @here b"), `a @${zwsp}here b`);
  check("ユーザー / ロール / チャンネル", m.neutralizeMentions("<@1> <@!2> <@&3> <#4>"), `<${zwsp}@1> <${zwsp}@!2> <${zwsp}@&3> <${zwsp}#4>`);
  check("メールアドレスなどはそのまま", m.neutralizeMentions("a@example.com"), "a@example.com");

  console.log("\n[Markdown]");
  check("マスクリンク", m.escapeDiscordMarkdown("[中止](https://x.example/y)"), "\\[中止\\]\\(https://x.example/y\\)");
  check("強調・取り消し線・スポイラー・コード", m.escapeDiscordMarkdown("**a** __b__ ~~c~~ ||d|| `e`"), "\\*\\*a\\*\\* \\_\\_b\\_\\_ \\~\\~c\\~\\~ \\|\\|d\\|\\| \\`e\\`");
  check("\\ 自体もエスケープ (後ろの記号の打ち消しを作らせない)", m.escapeDiscordMarkdown("\\*"), "\\\\\\*");
  check("普通の記号はそのまま", m.escapeDiscordMarkdown("◯ △ × ? 遅刻"), "◯ △ × ? 遅刻");

  console.log("\n[1 行に収める]");
  check("改行・タブ・連続空白", m.toSingleLine("  a\n\n b\t\tc \r\n"), "a b c");
  check("制御文字", m.toSingleLine("a" + String.fromCharCode(0) + "b" + String.fromCharCode(0x7f) + "c"), "a b c");

  console.log("\n[配線]");
  const src = readFileSync("src/lib/server/native-schedule-discord.ts", "utf8").replace(/\r\n/g, "\n");
  check(
    "通知の出欠記号: 1 行 → 32 字 → メンション → Markdown の順",
    /function sanitizeSymbol\(s: string\): string \{\s*return escapeDiscordMarkdown\(neutralizeMentions\(toSingleLine\(s\)\.slice\(0, 32\)\)\);/.test(src),
    true,
  );
  check("通知は共通の neutralizeMentions を使う (手元の写しを持たない)", /function neutralizeMentions\(/.test(src), false);
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

console.log("");
if (failures > 0) {
  console.error(`${failures} 件失敗`);
  process.exit(1);
}
console.log("すべて成功");
