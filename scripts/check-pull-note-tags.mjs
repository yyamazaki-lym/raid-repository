/**
 * ミス注釈のタグ集計 (src/lib/logs/pull-note-tags.ts) の検証
 * (2026-09-08、W-7)。
 * 実行: `node scripts/check-pull-note-tags.mjs`
 *
 * 固定したいのは 3 点:
 *   1. 件数の並びが**実行ごとに揺れない** (同数は語彙の並び順)
 *   2. 知らないタグを落とさず、末尾に回す (語彙を増やす前の注釈が消えない)
 *   3. **Discord 用の本文に個人タグ (`self`) の中身を出さない** — 本人が
 *      自分用に付けた印をチャンネルへ流すのは意図と違う
 *
 * ⚠ tsc は `process.execPath` + `node_modules/typescript/bin/tsc` で起動する
 *   (`npx` は Windows で ENOENT / EINVAL になる)。
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

const outDir = mkdtempSync(join(tmpdir(), "pull-note-tags-check-"));
try {
  execFileSync(
    process.execPath,
    [
      "node_modules/typescript/bin/tsc",
      "src/lib/logs/pull-note-tags.ts",
      "--outDir", outDir,
      "--target", "es2022",
      "--module", "es2022",
      "--moduleResolution", "bundler",
      "--strict",
    ],
    { stdio: "inherit" },
  );
  const m = await import(
    pathToFileURL(join(outDir, "pull-note-tags.js")).href
  );

  const note = (over) => ({
    id: "x",
    reportCode: "abc12345",
    fightId: 1,
    tag: "aoe-hit",
    scope: "team",
    discordUserId: null,
    note: null,
    createdById: null,
    createdAt: "2026-09-08T12:00:00Z",
    ...over,
  });

  console.log("\n[語彙]");
  check("既知のタグ", [m.isPullNoteTagId("aoe-hit"), m.isPullNoteTagId("nope")], [true, false]);
  check("帰属", [m.isPullNoteScope("team"), m.isPullNoteScope("self"), m.isPullNoteScope("x")], [true, true, false]);

  console.log("\n[集計]");
  check(
    "多い順",
    m.countPullNoteTags([
      { tag: "mit-missing" },
      { tag: "aoe-hit" },
      { tag: "mit-missing" },
    ]),
    [
      { tag: "mit-missing", count: 2 },
      { tag: "aoe-hit", count: 1 },
    ],
  );
  check(
    "同数は語彙の並び順 (挿入順に依存しない)",
    m.countPullNoteTags([{ tag: "position" }, { tag: "aoe-hit" }]),
    [
      { tag: "aoe-hit", count: 1 },
      { tag: "position", count: 1 },
    ],
  );
  check(
    "知らないタグは落とさず末尾へ",
    m.countPullNoteTags([{ tag: "legacy-tag" }, { tag: "aoe-hit" }]),
    [
      { tag: "aoe-hit", count: 1 },
      { tag: "legacy-tag", count: 1 },
    ],
  );
  check("空文字は無視", m.countPullNoteTags([{ tag: "  " }]), []);
  check("空入力", m.countPullNoteTags([]), []);

  console.log("\n[Discord 用の本文]");
  const digest = m.buildPullNotesDigest({
    header: "09/08 の振り返り",
    notes: [
      note({ tag: "aoe-hit" }),
      note({ tag: "aoe-hit", note: "P2 の散開" }),
      note({ tag: "mit-missing" }),
      note({ scope: "self", discordUserId: "u1", tag: "position", note: "秘密のメモ" }),
    ],
    labelOf: (t) => `[${t}]`,
    selfLabel: (n) => `(個人メモ ${n} 件)`,
    emptyLabel: "- なし",
  });
  check(
    "チーム帰属だけを集計 / 一言はそのまま / 個人タグは件数のみ",
    digest.split("\n"),
    [
      "09/08 の振り返り",
      "- [aoe-hit] ×2",
      "- [mit-missing] ×1",
      "  - [aoe-hit]: P2 の散開",
      "(個人メモ 1 件)",
    ],
  );
  check(
    "個人メモの本文が含まれない",
    digest.includes("秘密のメモ"),
    false,
  );
  check(
    "チーム帰属が 0 件なら空の 1 行",
    m
      .buildPullNotesDigest({
        header: "H",
        notes: [note({ scope: "self", discordUserId: "u1" })],
        labelOf: (t) => t,
        selfLabel: (n) => `self ${n}`,
        emptyLabel: "- なし",
      })
      .split("\n"),
    ["H", "- なし", "self 1"],
  );
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
