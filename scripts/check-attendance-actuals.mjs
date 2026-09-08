/**
 * 出席の自動突合 (src/lib/schedule/attendance-actuals.ts) の検証
 * (2026-09-08、W-6)。
 * 実行: `node scripts/check-attendance-actuals.mjs`
 *
 * 固定したいのは 3 点:
 *   1. **名前の取り違えをしない** — 同じ正規化キーに 2 人が当たったら
 *      どちらにも解決しない (誤った出席を記録するより未解決の方がよい)
 *   2. **辞書外の記号で「不在」を捏造しない** — 参加可かどうか不明な記号は
 *      映っていなくてもズレとして出さない (attendance-summary と同じ方針)
 *   3. 遅刻 / 時間帯つきの回答では部分参加をズレにしない (申告どおり)
 *
 * ⚠ tsc の起動は `process.execPath` + `node_modules/typescript/bin/tsc`。
 *   他の check スクリプトの `execFileSync("npx", ...)` は Windows で
 *   ENOENT / EINVAL になり手元で走らない (CI の ubuntu では通る)。
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
  if (a === e) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}\n       expected: ${e}\n       actual:   ${a}`);
  }
}

const outDir = mkdtempSync(join(tmpdir(), "att-actuals-check-"));
try {
  execFileSync(
    process.execPath,
    [
      "node_modules/typescript/bin/tsc",
      "src/lib/schedule/attendance-actuals.ts",
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
    writeFileSync(fp, readFileSync(fp, "utf8").replace(
      /(from\s+["'])(\.\.?\/[^"']+?)(?<!\.js)(["'])/g, "$1$2.js$3"));
  }
  const { resolveParticipants, attendanceMismatch, mismatchWeight } = await import(
    pathToFileURL(join(outDir, "attendance-actuals.js")).href
  );

  // ---- 1. 名前の解決 ----
  const members = [
    { discordUserId: "u1", displayName: "たろう", characterName: "Taro Yamada" },
    { discordUserId: "u2", displayName: "Hanako Sato", characterName: null },
    { discordUserId: "u3", displayName: "じろう", characterName: null },
  ];

  check(
    "キャラ名で解決する",
    resolveParticipants([{ name: "Taro Yamada", pulls: 12 }], members),
    { matched: [{ discordUserId: "u1", pulls: 12 }], unresolved: [] },
  );

  check(
    "キャラ名未設定なら表示名で解決する",
    resolveParticipants([{ name: "Hanako Sato", pulls: 3 }], members),
    { matched: [{ discordUserId: "u2", pulls: 3 }], unresolved: [] },
  );

  check(
    "全角英数 / 空白 / 大小文字のゆらぎを吸収する",
    resolveParticipants([{ name: "ｔａｒｏ　ｙａｍａｄａ", pulls: 5 }], members),
    { matched: [{ discordUserId: "u1", pulls: 5 }], unresolved: [] },
  );

  check(
    "対応表に無い名前は unresolved",
    resolveParticipants([{ name: "Unknown Person", pulls: 7 }], members),
    { matched: [], unresolved: [{ name: "Unknown Person", pulls: 7 }] },
  );

  check(
    "同じキーに 2 人当たったらどちらにも解決しない",
    resolveParticipants([{ name: "かぶり", pulls: 9 }], [
      { discordUserId: "a", displayName: "かぶり", characterName: null },
      { discordUserId: "b", displayName: "かぶり", characterName: null },
    ]),
    { matched: [], unresolved: [{ name: "かぶり", pulls: 9 }] },
  );

  check(
    "同じ人に 2 つの名前が当たったら pull 数を足す",
    resolveParticipants(
      [{ name: "Taro Yamada", pulls: 4 }, { name: "たろう", pulls: 6 }],
      members,
    ),
    { matched: [{ discordUserId: "u1", pulls: 10 }], unresolved: [] },
  );

  check(
    "pulls 0 / 空名前は無視する",
    resolveParticipants(
      [{ name: "Taro Yamada", pulls: 0 }, { name: "  ", pulls: 4 }],
      members,
    ),
    { matched: [], unresolved: [] },
  );

  // ---- 2. ズレの判定 ----
  const mm = (symbol, pulls, dayPulls) =>
    attendanceMismatch({ symbol, pulls, dayPulls });

  check("○ で映っている → ズレなし", mm("○", 40, 40), null);
  check("○ で不在 → absent-though-yes", mm("○", 0, 40), "absent-though-yes");
  check("× で映っている → present-though-no", mm("×", 30, 40), "present-though-no");
  check("× で不在 → ズレなし", mm("×", 0, 40), null);
  check("△ で映っている → present-though-other", mm("△", 30, 40), "present-though-other");
  check("△ で不在 → ズレなし", mm("△", 0, 40), null);
  check("未回答で映っている → present-though-other", mm("－", 30, 40), "present-though-other");
  check("未回答で不在 → ズレなし", mm(null, 0, 40), null);
  check(
    "辞書外の記号で不在 → ズレなし (参加可か不明なので捏造しない)",
    mm("？", 0, 40),
    null,
  );
  check(
    "辞書外の記号で参加 → present-though-other",
    mm("？", 20, 40),
    "present-though-other",
  );
  check(
    "○ で 1/40 pull → partial-though-yes",
    mm("○", 1, 40),
    "partial-though-yes",
  );
  check("○ で 20/40 pull → ズレなし", mm("○", 20, 40), null);
  check(
    "遅刻 (⏰) で 1/40 pull → ズレなし (申告どおり)",
    mm("⏰", 1, 40),
    null,
  );
  check(
    "時間帯つき (夜) で 1/40 pull → ズレなし",
    mm("夜", 1, 40),
    null,
  );
  check(
    "その日の総 pull が不明 (0) なら部分参加を判定しない",
    mm("○", 1, 0),
    null,
  );
  check(
    "全 pull に映っていれば partial にならない (dayPulls が小さい日)",
    mm("○", 2, 2),
    null,
  );

  // ---- 3. 並び順 ----
  check(
    "ズレの重さは 不在>未定参加>部分>不可参加",
    ["absent-though-yes", "present-though-other", "partial-though-yes", "present-though-no"]
      .map(mismatchWeight),
    [3, 2, 1, 0],
  );
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
