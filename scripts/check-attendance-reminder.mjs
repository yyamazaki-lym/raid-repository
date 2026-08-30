/**
 * 出欠催促の純粋ロジックの検証 (2026-08-30)。
 *
 * 実行: `node scripts/check-attendance-reminder.mjs`
 *   (内部で `npx tsc` を使って attendance-reminder-core.ts だけを
 *    一時ディレクトリに JS 出力し、それを import して検証する)
 *
 * このプロジェクトにはテストランナーが無いが、催促は「実在の人へ
 * メンションが飛ぶ」取り消し不能な副作用なので、対象選定とテンプレート
 * 展開だけは機械的に確認できるようにしておく。
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const SRC = "src/lib/schedule/attendance-reminder-core.ts";

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

const outDir = mkdtempSync(join(tmpdir(), "reminder-check-"));
try {
  execFileSync(
    "npx",
    [
      "tsc",
      SRC,
      "--outDir",
      outDir,
      "--target",
      "es2022",
      "--module",
      "es2022",
      "--moduleResolution",
      "bundler",
      "--strict",
    ],
    { stdio: "inherit" },
  );
  const mod = await import(
    pathToFileURL(join(outDir, "attendance-reminder-core.js")).href
  );

  console.log("\n[未回答の判定]");
  check("全角ハイフン (character-sheets の未回答)", mod.isUnanswered("－"), true);
  check("空文字", mod.isUnanswered(""), true);
  check("空白のみ", mod.isUnanswered("   "), true);
  check("undefined (行が無い)", mod.isUnanswered(undefined), true);
  check("◯ は回答済み", mod.isUnanswered("◯"), false);
  check("× は回答済み (不可も意思表示)", mod.isUnanswered("×"), false);
  check("△ は回答済み", mod.isUnanswered("△"), false);

  console.log("\n[JST 暦日キー]");
  // 2026-09-02 21:00 UTC = 2026-09-03 06:00 JST → JST では 3 日
  check(
    "UTC 21:00 は翌日の JST",
    mod.jstDayKey(Date.parse("2026-09-02T21:00:00Z")),
    "2026-9-3",
  );
  // 2026-09-02 14:59 UTC = 2026-09-02 23:59 JST → まだ 2 日
  check(
    "UTC 14:59 は同日の JST",
    mod.jstDayKey(Date.parse("2026-09-02T14:59:00Z")),
    "2026-9-2",
  );
  check(
    "JST hour (UTC 12:00 → JST 21 時)",
    mod.getJstHour(new Date("2026-09-02T12:00:00Z")),
    21,
  );

  console.log("\n[表示名の正規化]");
  check("全角英数 → 半角", mod.normalizeName("Ｌｙｍ"), "lym");
  check("空白除去 + 小文字化", mod.normalizeName(" y.Moshi "), "y.moshi");

  console.log("\n[催促対象の選定]");
  const members = [
    { name: "makiton", answered: true, discordUserId: null },
    { name: "enero", answered: false, discordUserId: null },
    { name: "Ｌｙｍ", answered: false, discordUserId: null },
    { name: "ないり", answered: false, discordUserId: null },
    { name: "カゲツ", answered: false, discordUserId: "222222222222222222" },
  ];
  const audience = mod.selectReminderAudience({
    members,
    // 表記ゆれ (半角 lym) でも対応表が引けること
    memberMap: { lym: "111111111111111111", enero: "not-an-id" },
    excluded: ["ないり"],
  });
  check(
    "対象は未入力かつ非除外のみ",
    audience.targets.map((t) => t.name),
    ["enero", "Ｌｙｍ", "カゲツ"],
  );
  check(
    "表記ゆれを吸収して ID を解決",
    audience.targets.find((t) => t.name === "Ｌｙｍ").discordUserId,
    "111111111111111111",
  );
  check(
    "不正な ID は採用しない (名前のみ)",
    audience.targets.find((t) => t.name === "enero").discordUserId,
    null,
  );
  check(
    "ソース由来 ID (native) はそのまま使う",
    audience.targets.find((t) => t.name === "カゲツ").discordUserId,
    "222222222222222222",
  );
  check("除外者は excluded に退避", audience.excluded, ["ないり"]);
  check("除外者は集計 (total) に含めない", audience.total, 4);
  check("回答済み数", audience.answered, 1);

  console.log("\n[本文テンプレート]");
  const rendered = mod.renderReminderTemplate(
    "{mentions}\n{date} ({day}) {time_start}〜{time_end} 未入力 {count}/{total}\n{site_url}",
    {
      targets: audience.targets,
      rawDate: "2026/09/03(木) 22:00~0:00",
      dayOfWeek: "木",
      startTime: "22:00",
      endTime: "0:00",
      answered: audience.answered,
      total: audience.total,
      siteUrl: "https://example.test",
    },
  );
  check(
    "メンションは ID 有りのみ <@...>、無い人は名前",
    rendered.split("\n")[0],
    "enero <@111111111111111111> <@222222222222222222>",
  );
  check(
    "件数 placeholder",
    rendered.split("\n")[1],
    "2026/09/03(木) 22:00~0:00 (木) 22:00〜0:00 未入力 3/4",
  );

  console.log("\n[メンション無害化]");
  check(
    "@everyone は崩される",
    mod.neutralizeMentions("@everyone").includes("​"),
    true,
  );
  const injected = mod.renderReminderTemplate("{names}", {
    targets: [{ name: "@everyone", discordUserId: null }],
    rawDate: "",
    dayOfWeek: "",
    startTime: "",
    endTime: "",
    answered: 0,
    total: 0,
    siteUrl: "",
  });
  check("名前経由の @everyone も崩される", injected.includes("​"), true);
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

console.log("");
if (failures > 0) {
  console.error(`${failures} 件失敗`);
  process.exit(1);
}
console.log("すべて成功");
