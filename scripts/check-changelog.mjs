/**
 * 更新履歴 (changelog) の構造検査 (2026-09-06)。
 * 実行: `node scripts/check-changelog.mjs [--dump <path>]`
 *
 * `src/lib/changelog.ts` は「最新 1 エントリだけ」を持ち、それより古い
 * エントリは `src/lib/changelog-archive.ts` に graduate する運用
 * (changelog.ts ヘッダー / changelog-meta.ts の手順を参照)。2026-05 以降
 * この運用が守られず本体が 32 エントリ / 420 KB まで育ち、設定ダイアログ
 * を開くたびに全文を取得する状態になっていた。同じ逆戻りを CI で止める。
 *
 * 検査項目:
 *   1. RELEASES がちょうど 1 件
 *   2. RELEASES[0] の version / date が LATEST_RELEASE_META と一致
 *      (spread で組み立てているので構造上一致するが、リテラルに書き戻して
 *      meta の更新を忘れた事故を拾う)
 *   3. RELEASES + RELEASES_ARCHIVE を通して `version|date` の重複が無い
 *      (React key に使っているため、重複すると duplicate-key warning)
 *   4. 同じ並びで date が非増加 (新しい → 古い)。graduate 時に archive の
 *      末尾へ append してしまった、などの並び崩れを拾う
 *   5. 各エントリに parts (title 必須) か notes のどちらかがある
 *   6. parts を持つ各エントリに `docs/release-notes/v<version>-<date>.md`
 *      があり、その `## ` 見出しが parts の title と順序込みで一致する
 *      (本文は 2026-09-06 に TS の `body` から md へ移した。見出しが
 *      ずれると「どの本文がどの変更のものか」が追えなくなる)
 *   7. 対応するエントリの無い md が docs/release-notes/ に残っていない
 *
 * `--dump <path>` を付けると結合済みの配列を JSON で書き出す。graduate
 * 前後で内容が 1 バイトも変わっていないことの比較に使う。
 *
 * .ts を実行するために typescript の transpileModule で一時ディレクトリへ
 * JS を吐き、そこから import する (依存追加なし、Node 22+ で動く)。
 */

import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const FILES = ["changelog-meta", "changelog", "changelog-archive"];
const SRC_DIR = "src/lib";
const NOTES_DIR = "docs/release-notes";

const mdNameOf = (r) => `v${r.version}-${r.date}.md`;

/** md の `## ` 見出しを出現順に返す (先頭の `# ` タイトルは含めない)。 */
function mdHeadings(text) {
  return text
    .split("\n")
    .filter((line) => line.startsWith("## "))
    .map((line) => line.slice(3).trim());
}

function transpileToDir(dir) {
  for (const name of FILES) {
    const source = readFileSync(join(SRC_DIR, `${name}.ts`), "utf8");
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        verbatimModuleSyntax: false,
      },
      fileName: `${name}.ts`,
    });
    // 相対 import に拡張子を足す (ESM の Node は拡張子必須)。
    const withExt = outputText.replace(
      /from\s+"\.\/([a-z0-9-]+)"/g,
      'from "./$1.js"',
    );
    writeFileSync(join(dir, `${name}.js`), withExt);
  }
}

let failures = 0;
function check(name, ok, detail = "") {
  if (ok) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ""}`);
  }
}

const dir = mkdtempSync(join(tmpdir(), "changelog-check-"));
try {
  transpileToDir(dir);
  const meta = await import(pathToFileURL(join(dir, "changelog-meta.js")).href);
  const main = await import(pathToFileURL(join(dir, "changelog.js")).href);
  const archive = await import(
    pathToFileURL(join(dir, "changelog-archive.js")).href
  );
  const RELEASES = main.RELEASES;
  const RELEASES_ARCHIVE = archive.RELEASES_ARCHIVE;
  const combined = [...RELEASES, ...RELEASES_ARCHIVE];

  const dumpIdx = process.argv.indexOf("--dump");
  if (dumpIdx !== -1 && process.argv[dumpIdx + 1]) {
    writeFileSync(process.argv[dumpIdx + 1], JSON.stringify(combined, null, 1));
    console.log(`  dump ${combined.length} entries -> ${process.argv[dumpIdx + 1]}`);
  }

  console.log(
    `changelog: RELEASES=${RELEASES.length} / RELEASES_ARCHIVE=${RELEASES_ARCHIVE.length}`,
  );

  check(
    "RELEASES holds exactly the latest entry (graduate older ones to changelog-archive.ts)",
    RELEASES.length === 1,
    `RELEASES.length = ${RELEASES.length}`,
  );

  const head = RELEASES[0];
  check(
    "RELEASES[0] matches LATEST_RELEASE_META",
    head?.version === meta.LATEST_RELEASE_META.version &&
      head?.date === meta.LATEST_RELEASE_META.date,
    `RELEASES[0] = ${head?.version} (${head?.date}), meta = ${meta.LATEST_RELEASE_META.version} (${meta.LATEST_RELEASE_META.date})`,
  );

  const keys = combined.map((r) => `${r.version}|${r.date}`);
  const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
  check(
    "no duplicate version|date across RELEASES + RELEASES_ARCHIVE",
    dupes.length === 0,
    `duplicates: ${[...new Set(dupes)].join(", ")}`,
  );

  const disorder = [];
  for (let i = 1; i < combined.length; i++) {
    if (combined[i].date > combined[i - 1].date) {
      disorder.push(`${keys[i - 1]} -> ${keys[i]}`);
    }
  }
  check(
    "entries are ordered newest -> oldest (non-increasing date)",
    disorder.length === 0,
    `out of order at: ${disorder.join(", ")}`,
  );

  const empty = combined.filter(
    (r) =>
      !(
        (Array.isArray(r.parts) &&
          r.parts.length > 0 &&
          r.parts.every((p) => typeof p.title === "string" && p.title)) ||
        (Array.isArray(r.notes) && r.notes.length > 0)
      ),
  );
  check(
    "every entry has parts (with titles) or notes",
    empty.length === 0,
    `empty: ${empty.map((r) => `${r.version}|${r.date}`).join(", ")}`,
  );

  const withParts = combined.filter(
    (r) => Array.isArray(r.parts) && r.parts.length > 0,
  );
  const missingMd = [];
  const headingMismatch = [];
  for (const r of withParts) {
    const file = join(NOTES_DIR, mdNameOf(r));
    if (!existsSync(file)) {
      missingMd.push(mdNameOf(r));
      continue;
    }
    const got = mdHeadings(readFileSync(file, "utf8"));
    const want = r.parts.map((p) => p.title.trim());
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      const firstDiff = want.findIndex((t, i) => got[i] !== t);
      headingMismatch.push(
        `${mdNameOf(r)} (md ${got.length} / ts ${want.length} headings; first diff at #${firstDiff + 1}: ts="${want[firstDiff] ?? ""}" md="${got[firstDiff] ?? ""}")`,
      );
    }
  }
  check(
    `every entry with parts has ${NOTES_DIR}/v<version>-<date>.md`,
    missingMd.length === 0,
    `missing: ${missingMd.join(", ")}`,
  );
  check(
    "md '## ' headings match part titles in order",
    headingMismatch.length === 0,
    headingMismatch.join("\n       "),
  );

  const known = new Set(withParts.map(mdNameOf));
  const orphans = existsSync(NOTES_DIR)
    ? readdirSync(NOTES_DIR).filter(
        (f) => f.endsWith(".md") && f !== "README.md" && !known.has(f),
      )
    : [];
  check(
    `no orphan md in ${NOTES_DIR} (every v*.md has a matching entry)`,
    orphans.length === 0,
    `orphans: ${orphans.join(", ")}`,
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
