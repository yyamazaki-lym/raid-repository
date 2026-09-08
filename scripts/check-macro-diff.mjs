/**
 * マクロの差分の要点 (src/lib/macro-diff.ts) の検証 (2026-09-08、UI-7)。
 * 実行: `node scripts/check-macro-diff.mjs`
 *
 * 固定したいのは 4 点:
 *   1. **行の順番は差分にしない** (マクロは並び替えが普通に起きるので、
 *      順番を見るとほぼ全部が「違う」になって役に立たない)
 *   2. 同じ行の**回数**は見る (2 回コールするのは意味のある違い)
 *   3. マクロ記号 (`/p` 等) や絵文字は落とさない (それが strat の違い)
 *   4. 空行 / 空白だけの行は無視する
 *
 * ⚠ tsc は `process.execPath` + `node_modules/typescript/bin/tsc` で起動する
 *   (`npx` 経由は Windows で ENOENT / EINVAL になり、CI の ubuntu では
 *   通るので壊れていることに気付けない)。
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
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

const outDir = mkdtempSync(join(tmpdir(), "macro-diff-check-"));
try {
  execFileSync(
    process.execPath,
    [
      "node_modules/typescript/bin/tsc",
      "src/lib/macro-diff.ts",
      "--outDir", outDir,
      "--target", "es2022",
      "--module", "es2022",
      "--moduleResolution", "bundler",
      "--strict",
    ],
    { stdio: "inherit" },
  );
  const m = await import(pathToFileURL(join(outDir, "macro-diff.js")).href);

  console.log("\n[順番と空行]");
  check(
    "行を並び替えただけなら差分なし",
    m.macroDiffSummary(m.diffMacroBodies("/p A\n/p B", "/p B\n/p A")),
    { identical: true, added: 0, removed: 0 },
  );
  check(
    "空行 / 全角空白だけの行は無視",
    m.macroDiffSummary(m.diffMacroBodies("/p A\n\n/p B", "/p A\n　\n/p B")),
    { identical: true, added: 0, removed: 0 },
  );
  check(
    "前後の空白は無視",
    m.macroDiffSummary(m.diffMacroBodies("/p A", "  /p A  ")),
    { identical: true, added: 0, removed: 0 },
  );

  console.log("\n[差分]");
  let d = m.diffMacroBodies("/p A\n/p B\n/p C", "/p A\n/p X");
  check("両方にある行数", d.same, 1);
  check("採用中にしか無い行", d.onlyInBase, ["/p B", "/p C"]);
  check("この案にしか無い行", d.onlyInOther, ["/p X"]);
  check("要点", m.macroDiffSummary(d), { identical: false, added: 1, removed: 2 });
  check("行数", [d.baseLines, d.otherLines], [3, 2]);

  console.log("\n[回数]");
  d = m.diffMacroBodies("/p A", "/p A\n/p A");
  check("同じ行を 2 回書くのは違い", m.macroDiffSummary(d), {
    identical: false,
    added: 1,
    removed: 0,
  });
  d = m.diffMacroBodies("/p A\n/p A", "/p A");
  check("減った側も拾う", m.macroDiffSummary(d), {
    identical: false,
    added: 0,
    removed: 1,
  });

  console.log("\n[落とさないもの]");
  check(
    "マクロ記号の違いは差分",
    m.macroDiffSummary(m.diffMacroBodies("/p A", "/say A")),
    { identical: false, added: 1, removed: 1 },
  );
  check(
    "絵文字 / マーカーの違いは差分",
    m.macroDiffSummary(
      m.diffMacroBodies("/p A → 1", "/p A → 2"),
    ),
    { identical: false, added: 1, removed: 1 },
  );

  console.log("\n[空入力]");
  check("両方空", m.macroDiffSummary(m.diffMacroBodies("", "")), {
    identical: true,
    added: 0,
    removed: 0,
  });
  check(
    "採用中が空なら全部が追加",
    m.macroDiffSummary(m.diffMacroBodies("", "/p A\n/p B")),
    { identical: false, added: 2, removed: 0 },
  );
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
