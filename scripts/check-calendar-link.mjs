/**
 * カレンダーリンク生成の検証 (2026-08-30、Tier2-9)。
 * 実行: `node scripts/check-calendar-link.mjs`
 *
 * 22:00〜0:00 のような日跨ぎが正しく翌日終了になること (= 予定が
 * 「マイナス 22 時間」にならないこと) が主眼。
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const SRC = "src/lib/calendar-link.ts";

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

const outDir = mkdtempSync(join(tmpdir(), "calendar-check-"));
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
  const mod = await import(pathToFileURL(join(outDir, "calendar-link.js")).href);

  // 2026-09-03 22:00 JST = 2026-09-03 13:00 UTC
  const startMs = Date.parse("2026-09-03T13:00:00Z");

  console.log("\n[終了時刻の解決]");
  check(
    "22:00〜0:00 は翌日 0:00 (= +2h)",
    (mod.resolveSessionEndMs(startMs, "22:00", "0:00") - startMs) / 3600000,
    2,
  );
  check(
    "21:00〜23:00 は同日 (= +2h)",
    (mod.resolveSessionEndMs(startMs, "21:00", "23:00") - startMs) / 3600000,
    2,
  );
  check(
    "22:00〜1:30 は翌日 (= +3.5h)",
    (mod.resolveSessionEndMs(startMs, "22:00", "1:30") - startMs) / 3600000,
    3.5,
  );
  check(
    "パース不能は既定 2 時間",
    (mod.resolveSessionEndMs(startMs, "", "") - startMs) / 3600000,
    2,
  );

  console.log("\n[UTC スタンプ]");
  check("basic format", mod.toCalendarStamp(startMs), "20260903T130000Z");

  console.log("\n[Google カレンダー URL]");
  const url = new URL(
    mod.buildGoogleCalendarUrl({
      title: "固定活動 2026/09/03(木) 22:00~0:00",
      startMs,
      startTime: "22:00",
      endTime: "0:00",
      details: "https://example.test",
    }),
  );
  check("ホスト", url.hostname, "calendar.google.com");
  check("action", url.searchParams.get("action"), "TEMPLATE");
  check(
    "dates は開始/終了",
    url.searchParams.get("dates"),
    "20260903T130000Z/20260903T150000Z",
  );
  check(
    "タイトルはエンコードされて復元できる",
    url.searchParams.get("text"),
    "固定活動 2026/09/03(木) 22:00~0:00",
  );
  check("details", url.searchParams.get("details"), "https://example.test");
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

console.log("");
if (failures > 0) {
  console.error(`${failures} 件失敗`);
  process.exit(1);
}
console.log("すべて成功");
