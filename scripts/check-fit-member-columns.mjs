/**
 * スケジュールの詳細表のメンバー列を入れ物に収まるよう詰める (2026-10-05、
 * `src/lib/schedule/fit-member-columns.ts` / `use-fit-member-columns.ts`) の検証。
 * 実行: `node scripts/check-fit-member-columns.mjs`
 *
 * 本番 (入れ物 974px) でメンバー列の合計が 976px になり、2px のはみ出しで横スクロール
 * バーが出ていた。ここでは
 *   - 収まるときは何も変えない (最低幅 80px・名前 7rem のまま)
 *   - まずメンバー列の最低幅を収まる最大の値まで下げ、それでも足りなければ名前の
 *     省略の上限を下げる。下限 (44px / 40px) でも収まらなければ下限で止める
 *   - 表のメンバー列・名前・入れ物が CSS 変数と測る印でつながっている
 * を固定する。
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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
const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

const outDir = mkdtempSync(join(tmpdir(), "fit-member-columns-check-"));
try {
  execFileSync(
    process.execPath,
    [
      "node_modules/typescript/bin/tsc", "src/lib/schedule/fit-member-columns.ts",
      "--outDir", outDir, "--rootDir", "src/lib",
      "--target", "es2022", "--module", "es2022", "--moduleResolution", "bundler", "--strict",
    ],
    { stdio: "inherit" },
  );
  for (const dir of [outDir, join(outDir, "schedule")]) {
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".js")) continue;
      const fp = join(dir, f);
      writeFileSync(fp, readFileSync(fp, "utf8").replace(/(from\s+["'])(\.\.?\/[^"']+?)(?<!\.js)(["'])/g, "$1$2.js$3"));
    }
  }
  const f = await import(pathToFileURL(join(outDir, "schedule", "fit-member-columns.js")).href);

  console.log("既定値");
  check("最低幅 80px / 下限 44px / 名前 112px (7rem) / 下限 40px", [f.MEMBER_COL_PREFERRED_PX, f.MEMBER_COL_FLOOR_PX, f.MEMBER_NAME_PREFERRED_PX, f.MEMBER_NAME_FLOOR_PX], [80, 44, 112, 40]);

  console.log("\n1 段目: メンバー列の最低幅");
  // 本番と同じ形: 日程 277 + 確定 48、メンバー 8 列 (名前の長い 2 列は 89 / 82)。
  const prod = { fixed: 325, contents: [70, 89, 82, 66, 72, 75, 60, 70] };
  check("収まるときは 80px のまま", f.fitMemberMinWidth({ available: 1200, ...prod }), 80);
  check("本番 (入れ物 974px、80px だと 976px) は 79px で収まる", f.fitMemberMinWidth({ available: 973, ...prod }), 79);
  const total = (m, p) => p.fixed + p.contents.reduce((s, c) => s + Math.max(m, c), 0);
  check("選んだ値で本当に収まる / 1px 大きいと収まらない", [total(79, prod) <= 973, total(80, prod) <= 973], [true, false]);
  check("下限でも収まらなければ下限", f.fitMemberMinWidth({ available: 500, ...prod }), 44);
  check("入れ物の幅が 0 (非表示) なら既定", f.fitMemberMinWidth({ available: 0, ...prod }), 80);
  check("メンバーがいなければ既定", f.fitMemberMinWidth({ available: 300, fixed: 325, contents: [] }), 80);

  console.log("\n2 段目: 名前の省略の上限");
  const cols = [
    { content: 78, name: 66 },
    { content: 91, name: 55 },
    { content: 78, name: 66 },
    { content: 100, name: 88 },
  ];
  const fit2 = (available) => f.fitMemberColumns({ available, fixed: 360, columns: cols });
  check("収まるときは名前を省略しない", fit2(973), { minWidth: 80, nameMax: 112 });
  // demo の実測 (入れ物 700px で 11px はみ出し) と同じ形。最も長い名前だけ省略する。
  check("最低幅で足りなければ名前の上限を下げる", fit2(699), { minWidth: 44, nameMax: 80 });
  const width = (r) => 360 + cols.reduce((s, c) => s + Math.max(r.minWidth, c.content - Math.max(0, c.name - r.nameMax)), 0);
  check("下げた後は収まる", width(fit2(699)) <= 699, true);
  check("もっと狭ければもっと省略する", fit2(679), { minWidth: 44, nameMax: 64 });
  check("名前の下限でも収まらなければ下限 (スクロールに任せる)", fit2(559), { minWidth: 44, nameMax: 40 });
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

console.log("\n配線");
const list = read("src/components/portal/schedule-list.tsx");
check("メンバー列の th は最低幅を CSS 変数で読み、測る印を持つ", /data-member-col=""\s*className="min-w-\[var\(--member-col-min,5rem\)\]/.test(list), true);
check("見出しの名前 3 か所とも省略の上限を CSS 変数で読む", (list.match(/max-w-\[var\(--member-name-max,7rem\)\] truncate/g) ?? []).length, 3);
check("名前の要素 3 か所に測る印", (list.match(/data-member-name=""/g) ?? []).length, 3);
check("決め打ちの 5rem / 7rem は残っていない", /min-w-\[5rem\] px-1\.5|max-w-\[7rem\] truncate/.test(list), false);
check("予定の表と過去の表の入れ物にフックを付ける", /ref=\{fitUpcomingRef\} className="hidden overflow-x-auto md:block"/.test(list) && /ref=\{fitPastRef\} className="overflow-x-auto"/.test(list), true);
const hook = read("src/components/portal/schedule/use-fit-member-columns.ts");
check("フック: 表を max-content にして測り、元に戻す", /table\.style\.width = "max-content";[\s\S]*table\.style\.width = prevWidth;/.test(hook), true);
check("フック: 測る間は最低幅を 0、名前を既定の上限にする", /setProperty\(MEMBER_COL_MIN_VAR, "0px"\)[\s\S]*setProperty\(MEMBER_NAME_MAX_VAR, `\$\{MEMBER_NAME_PREFERRED_PX\}px`\)/.test(hook), true);
check("フック: 決めた 2 つの値を入れる", /setProperty\(MEMBER_COL_MIN_VAR, `\$\{fit\.minWidth\}px`\)/.test(hook) && /setProperty\(MEMBER_NAME_MAX_VAR, `\$\{fit\.nameMax\}px`\)/.test(hook), true);
check("フック: 付いた時点でその場で 1 回測る", /\n    measure\(\);\n/.test(hook), true);
check("フック: 入れ物と表の大きさの変化で測り直す", /ro\.observe\(wrap\);[\s\S]*ro\.observe\(table\)/.test(hook), true);
check("フック: 非表示 (幅 0) は測らない", /wrap\.clientWidth === 0\) return;/.test(hook), true);
check("フック: 小数の丸めで 1px はみ出さないよう 1px 余らせる", /available: wrap\.clientWidth - 1,/.test(hook), true);

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
