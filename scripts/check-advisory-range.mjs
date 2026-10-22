/**
 * advisory の範囲の解釈 (scripts/advisory-range.mjs) の検証 (2026-10-21)。
 * 実行: `node scripts/check-advisory-range.mjs`
 *
 * 範囲の文字列は、2026-10-21 にパッケージのリポジトリの advisory
 * (vercel/next.js・facebook/react・nodejs/undici・lovell/sharp) で実際に見た書き方を使う。
 * ネットワークには出ない (週 1 の見張り本体は scripts/advisory-watch.mjs)。
 */
import {
  githubRepoOf,
  isAffected,
  parsePatchedVersions,
} from "./advisory-range.mjs";

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
const cases = (title, range, rows, patched = "") => {
  console.log(`\n[${title}] ${JSON.stringify(range)}`);
  for (const [version, expected] of rows) {
    check(`${version}`, isAffected(range, version, patched), expected);
  }
};

cases("比較の並び (next の 10-14 公開分)", ">=16.0.0 <= 16.4.0", [
  ["16.3.8", true], ["16.4.0", true], ["16.4.1", false], ["16.4.2", false], ["15.5.28", false],
]);
cases("比較の並び", ">= 16.0.0 < 16.2.11", [["16.2.10", true], ["16.2.11", false]]);
cases("より大きい", "> 16.0.0 <= 16.4.0", [["16.0.0", false], ["16.0.1", true]]);
cases("カンマ区切りの比較 (undici)", ">= 8.0.0, < 8.12.2", [
  ["8.10.2", true], ["8.12.1", true], ["8.12.2", false], ["7.30.0", false],
]);
cases("先頭の版に演算子が無い・`;` で系列", "6.17.0 < 6.27.0; 7.0.0 < 7.28.0; 8.0.0 < 8.5.0 ", [
  ["6.20.0", true], ["7.27.9", true], ["8.4.9", true], ["8.5.0", false], ["6.16.9", false],
]);
cases("片側だけの系列", "7.23.0 < 7.28.0; < 8.2.0", [["8.1.0", true], ["8.2.0", false]]);
cases("先頭が演算子の系列", "< 5.28.3; > 6.0.0 <= 6.11.0", [
  ["5.28.2", true], ["6.11.0", true], ["6.11.1", false], ["6.0.0", false],
]);
cases("先頭の版 + 以下 (next の古い分)", "12.0.0 <= 12.0.8", [["12.0.8", true], ["12.0.9", false], ["11.9.9", false]]);
cases(
  "版の列挙 (react-server-dom-*)",
  "19.0.0, 19.0.1, 19.1.0, 19.2.0, 19.2.1, 19.2.2, 19.2.3, 19.2.4, 19.2.5, 19.2.6, 19.2.7, 19.2.8, 19.3.0",
  [["19.2.4", true], ["19.3.0", true], ["19.2.9", false], ["19.3.1", false]],
);
cases("版の列挙のカンマ抜け", "19.1.5 19.2.0, 19.2.1", [["19.2.0", true], ["19.1.6", false]]);
cases("系列ぜんぶ", "10.x", [["10.2.3", true], ["11.0.0", false], ["9.9.9", false]]);
cases("パッチ番号が不明 (`?`)", ">= 16.0.0 < 16.3.?", [["16.3.7", true], ["16.4.0", false]]);
cases("より小さい (sharp)", "< 0.35.5", [["0.35.4", true], ["0.35.5", false]]);
cases("以下 (sharp)", "<= 0.30.4", [["0.30.4", true], ["0.30.5", false]]);
cases("版 1 つだけ・修正版あり", "12.2.3", [["12.2.2", false], ["12.2.3", true], ["16.4.2", false]], "12.2.4");
cases("版 1 つだけ・修正版なし (読めない)", "12.2.3", [["12.2.2", false], ["12.2.3", true], ["16.4.2", null]]);

console.log("\n[解釈できないものは null]");
check("文が混ざる", isAffected("before 1.2.3", "1.0.0"), null);
check("空", isAffected("", "1.0.0"), null);
check("null", isAffected(null, "1.0.0"), null);
check("使っている版が読めない", isAffected("< 2.0.0", "latest"), null);
check("1 系列が読めなくても、別の系列で当たれば対象", isAffected("before 1.2.3; >= 2.0.0 < 2.1.0", "2.0.5"), true);
check("1 系列が読めず、ほかで当たらなければ null", isAffected("before 1.2.3; >= 2.0.0 < 2.1.0", "3.0.0"), null);

console.log("\n[修正版の文字列]");
check("カンマ区切り", parsePatchedVersions("15.5.28, 16.4.1"), [[15, 5, 28], [16, 4, 1]]);
check("比較つき", parsePatchedVersions(">= 0.35.5"), [[0, 35, 5]]);
check("空", parsePatchedVersions(null), []);

console.log("\n[repository から GitHub の owner/repo]");
for (const [input, expected] of [
  ["git+https://github.com/nodejs/undici.git", "nodejs/undici"],
  ["https://github.com/facebook/react.git", "facebook/react"],
  [{ url: "https://github.com/supabase/supabase-js.git" }, "supabase/supabase-js"],
  ["git@github.com:upstash/redis-js.git", "upstash/redis-js"],
  ["github:vercel/analytics", "vercel/analytics"],
  ["vercel/next.js", "vercel/next.js"],
  ["https://github.com/motiondivision/motion", "motiondivision/motion"],
  ["https://gitlab.com/x/y", null],
  ["", null],
  [undefined, null],
]) {
  check(JSON.stringify(input), githubRepoOf(input), expected);
}

console.log("");
if (failures > 0) {
  console.error(`${failures} 件失敗`);
  process.exit(1);
}
console.log("すべて成功");
