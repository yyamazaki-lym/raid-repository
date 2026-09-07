/**
 * 攻略リンクのタグ (src/lib/link-tags.ts) の検証 (2026-09-07、B-1)。
 * 実行: `node scripts/check-link-tags.mjs`
 *
 * 実データに近い入力 (Discord 取り込みのタイトルは投稿者の書き方に依存する)
 * を並べて、フェーズ表記の正規化と誤検出の除外を固定する。
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const SRC = "src/lib/link-tags.ts";

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

const outDir = mkdtempSync(join(tmpdir(), "link-tags-check-"));
try {
  execFileSync(
    "npx",
    [
      "tsc", SRC,
      "--outDir", outDir,
      "--target", "es2022",
      "--module", "es2022",
      "--moduleResolution", "bundler",
      "--strict",
    ],
    { stdio: "inherit" },
  );
  const mod = await import(pathToFileURL(join(outDir, "link-tags.js")).href);
  const {
    normalizeLinkTag,
    linkTagError,
    sameLinkTag,
    suggestLinkTags,
    linkTagToneClass,
    linkMatchesTagFilter,
  } = mod;

  console.log("normalize / validate");
  check("前後の空白を落とす", normalizeLinkTag("  P3 "), "P3");
  check("全角空白も落とす", normalizeLinkTag("　散開　"), "散開");
  check("内部の連続空白は 1 つに", normalizeLinkTag("頭割り   位置"), "頭割り 位置");
  check("大文字小文字は変えない", normalizeLinkTag("AoE"), "AoE");
  check("空は empty", linkTagError("   "), "empty");
  check("24 文字は通る", linkTagError("あ".repeat(24)), null);
  check("25 文字は too_long", linkTagError("あ".repeat(25)), "too_long");
  check("大文字小文字を無視して同一", sameLinkTag("p3", "P3"), true);
  check("別ラベルは非同一", sameLinkTag("P3", "P4"), false);

  console.log("\nフェーズ検出");
  check("P3", suggestLinkTags("P3 の散開図"), ["P3", "散開"]);
  check("小文字 p2", suggestLinkTags("p2 タイムライン"), ["P2", "タイムライン"]);
  check("フェーズ表記", suggestLinkTags("フェーズ4 ギミック解説"), ["P4", "ギミック解説"]);
  check("Phase 表記", suggestLinkTags("Phase 5 guide"), ["P5", "ギミック解説"]);
  check("N フェーズ目", suggestLinkTags("6フェーズ目のマクロ"), ["P6", "マクロ"]);
  check("複数フェーズは昇順", suggestLinkTags("P3とP1の比較"), ["P3", "P1"].sort());
  check("2 桁は拾わない", suggestLinkTags("P10 メモ"), []);
  // 「MVP3」「TOP3」のような語中の P+数字を拾うと、タグが誤って増える。
  check("語中の P+数字は拾わない", suggestLinkTags("MVP3 の記録"), []);
  check("年号を拾わない", suggestLinkTags("2026 年の攻略"), []);

  console.log("\n種別キーワード");
  check("軽減", suggestLinkTags("軽減表 v3"), ["軽減"]);
  check("英語 mit", suggestLinkTags("P2 mit sheet"), ["P2", "軽減"]);
  check("装備", suggestLinkTags("BiS まとめ"), ["装備"]);
  check("視点動画", suggestLinkTags("ヒラ視点"), ["動画"]);
  check("該当なしは空", suggestLinkTags("メモ"), []);

  console.log("\nURL も見る (ホスト名は見ない)");
  check(
    "パスの語を拾う",
    suggestLinkTags("共有", "https://example.com/guides/p4-spread"),
    ["P4", "散開", "ギミック解説"],
  );
  check(
    "ホスト名は見ない",
    suggestLinkTags("共有", "https://phase3.example.com/x"),
    [],
  );
  check("壊れた URL でも落ちない", suggestLinkTags("P1 メモ", "not a url"), ["P1"]);

  console.log("\n既存タグは候補から外す");
  check(
    "既に P3 があれば出さない",
    suggestLinkTags("P3 の散開図", null, ["P3"]),
    ["散開"],
  );
  check(
    "大文字小文字を無視して外す",
    suggestLinkTags("P3 の散開図", null, ["p3", "散開"]),
    [],
  );

  console.log("\n色");
  check(
    "P3 は練習ログと同じ indigo",
    linkTagToneClass("P3"),
    "border-indigo-400/45 bg-indigo-400/10 text-indigo-200",
  );
  check("同じラベルは同じ色", linkTagToneClass("散開"), linkTagToneClass("散開"));
  check(
    "大文字小文字が違っても同じ色",
    linkTagToneClass("AoE"),
    linkTagToneClass("aoe"),
  );

  console.log("\n絞り込み (AND)");
  check("未選択は全部通す", linkMatchesTagFilter(["P3"], []), true);
  check("1 つ選択で一致", linkMatchesTagFilter(["P3", "散開"], ["P3"]), true);
  check("AND: 両方持つ", linkMatchesTagFilter(["P3", "散開"], ["P3", "散開"]), true);
  check("AND: 片方だけは落とす", linkMatchesTagFilter(["P3"], ["P3", "散開"]), false);
  check("大文字小文字を無視", linkMatchesTagFilter(["P3"], ["p3"]), true);
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
