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

  // 2026-10-06: 傾向の行の hover に出す明細。
  console.log("\n[行の hover の明細]");
  const fights = [
    { reportCode: "r1", fightId: 1, sessionDate: "2026-10-04", startMs: 1000 },
    { reportCode: "r1", fightId: 2, sessionDate: "2026-10-04", startMs: 2000 },
    { reportCode: "r2", fightId: 1, sessionDate: "2026-10-06", startMs: 5000 },
  ];
  const hoverNotes = [
    note({ reportCode: "r1", fightId: 2, tag: "position", note: " 散開が\n遅れた " }),
    note({ reportCode: "r2", fightId: 1, tag: "position" }),
    note({ reportCode: "gone", fightId: 9, tag: "position", note: "古い", createdAt: "2026-09-01T00:00:00Z" }),
    note({ reportCode: "gone", fightId: 8, tag: "position", note: "新しい", createdAt: "2026-09-02T00:00:00Z" }),
    note({ reportCode: "r1", fightId: 1, tag: " other " }),
  ];
  const byTag = m.pullNoteDetailsByTag(hoverNotes, fights, fights);
  check(
    "新しい pull が先・明細に無い注釈は後ろ (作成の新しい順)・メモの空白は 1 つに",
    byTag.get("position"),
    [
      { date: "2026-10-06", startMs: 5000, overallPulls: 3, note: null },
      { date: "2026-10-04", startMs: 2000, overallPulls: 2, note: "散開が 遅れた" },
      { date: null, startMs: null, overallPulls: null, note: "新しい" },
      { date: null, startMs: null, overallPulls: null, note: "古い" },
    ],
  );
  check(
    "タグは前後の空白を落とした値で振り分ける (countPullNoteTags と同じ鍵)",
    [...byTag.keys()].sort(),
    m.countPullNoteTags(hoverNotes).map((c) => c.tag).sort(),
  );
  check(
    "各タグの明細の件数は countPullNoteTags の件数と一致",
    m.countPullNoteTags(hoverNotes).map((c) => byTag.get(c.tag)?.length ?? 0),
    m.countPullNoteTags(hoverNotes).map((c) => c.count),
  );
  check(
    "明細が打ち切られているとき (numbered = null) は通算の番号を出さない",
    m.pullNoteDetailsByTag(hoverNotes, fights, null).get("position").map((d) => d.overallPulls),
    [null, null, null, null],
  );
  check(
    "通算の番号は開始時刻の昇順で数える (渡す順によらない)",
    m.pullNoteDetailsByTag(hoverNotes, fights, [...fights].reverse()).get("other")[0].overallPulls,
    1,
  );
  // ⚠ Windows の Chrome / Edge は title を 1024 文字で切る。行数だけで切ると、
  // メモが長いときに末尾の行と「ほか N 件」が黙って消える。
  console.log("\n[hover の行数と文字数の予算]");
  const more = (n) => `ほか ${n} 件`;
  const tenChars = Array.from({ length: 20 }, (_, i) => `${String(i).padStart(2, "0")}-------`);
  check(
    "行数の上限で切り、残りの件数を最後に出す",
    m.fitTooltipLines(tenChars, { maxLines: 3, maxChars: 1000, more }).split("\n"),
    ["00-------", "01-------", "02-------", "ほか 17 件"],
  );
  check(
    "全部入れば「ほか」を出さない",
    m.fitTooltipLines(tenChars.slice(0, 2), { maxLines: 15, maxChars: 1000, more }),
    "00-------\n01-------",
  );
  // 9 文字の行を改行で繋ぐと 9, 19, 29, …。「ほか N 件」(7 文字) と改行の分を残す。
  const fitted = m.fitTooltipLines(tenChars, { maxLines: 15, maxChars: 40, more });
  check("文字数の予算を超えない", fitted.length <= 40, true);
  check(
    "文字数で切っても、見えていない件数の行は必ず残る",
    fitted.split("\n"),
    ["00-------", "01-------", "02-------", "ほか 17 件"],
  );
  check(
    "予算ちょうどまでは入れる (3 行 29 + 改行 1 + 「ほか 17 件」7 = 37 ≤ 37)",
    m.fitTooltipLines(tenChars, { maxLines: 15, maxChars: 37, more }).split("\n").length,
    4,
  );
  check(
    "1 文字足りなければ 1 行減らす (改行の分も数える: 36 では 3 行目が入らない)",
    (() => {
      const s = m.fitTooltipLines(tenChars, { maxLines: 15, maxChars: 36, more });
      return [s.split("\n"), s.length <= 36];
    })(),
    [["00-------", "01-------", "ほか 18 件"], true],
  );
  check(
    "1 行目は長くても出す (何も出ないよりよい)",
    m.fitTooltipLines(["x".repeat(50), "y"], { maxLines: 15, maxChars: 10, more }).split("\n"),
    ["x".repeat(50), "ほか 1 件"],
  );
  check(
    "total を渡すと、作った行より多い件数を「ほか」に数える",
    m.fitTooltipLines(tenChars.slice(0, 3), { maxLines: 3, maxChars: 1000, more, total: 20 }).split("\n"),
    ["00-------", "01-------", "02-------", "ほか 17 件"],
  );
  check("0 件は空", m.fitTooltipLines([], { maxLines: 15, maxChars: 1000, more }), "");

  check(
    "ティアの明細に無い pull は日時だけ (番号なし)",
    m.pullNoteDetailsByTag(hoverNotes, fights, fights.slice(0, 2)).get("position")[0],
    { date: "2026-10-06", startMs: 5000, overallPulls: null, note: null },
  );
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
