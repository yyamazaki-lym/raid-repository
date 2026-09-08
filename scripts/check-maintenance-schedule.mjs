/**
 * メンテ日程の登録と衝突判定 (src/lib/maintenance-schedule.ts) の検証
 * (2026-09-07、W-30)。
 * 実行: `node scripts/check-maintenance-schedule.mjs`
 *
 * 手入力の設定なので、**不正な入力で画面が壊れないこと**が主眼。
 * 併せて衝突判定の境界 (半開区間) と JST 換算を固定する。
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const SRC = "src/lib/maintenance-schedule.ts";

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

const outDir = mkdtempSync(join(tmpdir(), "maint-check-"));
try {
  execFileSync(
    process.execPath,
    ["node_modules/typescript/bin/tsc", SRC, "--outDir", outDir, "--target", "es2022", "--module", "es2022",
     "--moduleResolution", "bundler", "--strict"],
    { stdio: "inherit" },
  );
  const {
    isMaintenanceDateTime,
    maintenanceMs,
    parseMaintenanceWindows,
    overlappingMaintenance,
    formatMaintenanceRange,
    MAINTENANCE_MAX_WINDOWS,
  } = await import(pathToFileURL(join(outDir, "maintenance-schedule.js")).href);

  console.log("日時の形式");
  check("正しい形式", isMaintenanceDateTime("2026-09-08T12:00"), true);
  check("秒付きは不正", isMaintenanceDateTime("2026-09-08T12:00:00"), false);
  check("Z 付きは不正", isMaintenanceDateTime("2026-09-08T12:00Z"), false);
  check("月が範囲外", isMaintenanceDateTime("2026-13-01T00:00"), false);
  check("時が範囲外", isMaintenanceDateTime("2026-09-08T24:00"), false);
  check("実在しない日 (2/30)", isMaintenanceDateTime("2026-02-30T12:00"), false);
  check("うるう日は有効", isMaintenanceDateTime("2028-02-29T12:00"), true);
  check("非うるう年の 2/29 は不正", isMaintenanceDateTime("2026-02-29T12:00"), false);
  check("数値は不正", isMaintenanceDateTime(20260908), false);

  console.log("\nJST → UTC");
  // JST 12:00 = UTC 03:00。
  check(
    "JST 12:00 は UTC 03:00",
    maintenanceMs("2026-09-08T12:00"),
    Date.UTC(2026, 8, 8, 3, 0),
  );
  // JST 00:00 は前日 15:00 UTC。
  check(
    "JST 00:00 は前日 15:00 UTC",
    maintenanceMs("2026-09-08T00:00"),
    Date.UTC(2026, 8, 7, 15, 0),
  );
  check("不正な形式は null", maintenanceMs("bogus"), null);

  console.log("\n設定値の読み取り (不正入力を捨てる)");
  check("未設定は空", parseMaintenanceWindows(null), []);
  check("空文字は空", parseMaintenanceWindows("  "), []);
  check("壊れた JSON は空", parseMaintenanceWindows("{oops"), []);
  check("配列でなければ空", parseMaintenanceWindows('{"start":"x"}'), []);
  check(
    "正しい 1 件",
    parseMaintenanceWindows(
      '[{"start":"2026-09-08T12:00","end":"2026-09-08T22:00","label":"7.56 メンテ"}]',
    ),
    [{ start: "2026-09-08T12:00", end: "2026-09-08T22:00", label: "7.56 メンテ" }],
  );
  check(
    "ラベル空は省く",
    parseMaintenanceWindows(
      '[{"start":"2026-09-08T12:00","end":"2026-09-08T22:00","label":"  "}]',
    ),
    [{ start: "2026-09-08T12:00", end: "2026-09-08T22:00" }],
  );
  check(
    "開始 > 終了は捨てる",
    parseMaintenanceWindows(
      '[{"start":"2026-09-08T22:00","end":"2026-09-08T12:00"}]',
    ),
    [],
  );
  check(
    "不正な要素だけ捨てて他は残す",
    parseMaintenanceWindows(
      '[{"start":"bogus","end":"x"},{"start":"2026-09-08T12:00","end":"2026-09-08T22:00"}]',
    ).length,
    1,
  );
  check(
    "開始時刻の昇順に並べ替える",
    parseMaintenanceWindows(
      '[{"start":"2026-10-01T12:00","end":"2026-10-01T13:00"},{"start":"2026-09-08T12:00","end":"2026-09-08T22:00"}]',
    ).map((w) => w.start),
    ["2026-09-08T12:00", "2026-10-01T12:00"],
  );
  const many = JSON.stringify(
    Array.from({ length: MAINTENANCE_MAX_WINDOWS + 10 }, (_, i) => ({
      start: `2026-09-${String((i % 28) + 1).padStart(2, "0")}T12:00`,
      end: `2026-09-${String((i % 28) + 1).padStart(2, "0")}T13:00`,
    })),
  );
  check("件数上限で打ち切る", parseMaintenanceWindows(many).length, MAINTENANCE_MAX_WINDOWS);

  console.log("\n衝突判定 (半開区間)");
  const w = [{ start: "2026-09-08T12:00", end: "2026-09-08T22:00" }];
  const at = (h, mi = 0) => Date.UTC(2026, 8, 8, h - 9, mi);
  check("完全に中",
    overlappingMaintenance(w, at(20), at(21)).length, 1);
  check("前から重なる", overlappingMaintenance(w, at(11), at(13)).length, 1);
  check("後ろから重なる", overlappingMaintenance(w, at(21), at(23)).length, 1);
  check("メンテを覆う", overlappingMaintenance(w, at(10), at(23)).length, 1);
  // 半開区間: メンテ終了ちょうどに始まる活動は衝突ではない
  // (「明けたら集合」の運用があるため)。
  check("終了ちょうどに開始は衝突しない",
    overlappingMaintenance(w, at(22), at(24)).length, 0);
  check("開始ちょうどに終了は衝突しない",
    overlappingMaintenance(w, at(10), at(12)).length, 0);
  check("完全に前は衝突しない", overlappingMaintenance(w, at(9), at(11)).length, 0);
  check("完全に後は衝突しない", overlappingMaintenance(w, at(23), at(24)).length, 0);
  check("枠が無ければ空", overlappingMaintenance([], at(20), at(21)), []);
  check("NaN は空", overlappingMaintenance(w, NaN, at(21)), []);
  // 開始 / 終了が逆に渡ってきても判定できる (呼び出し側の事故を吸収)。
  check("開始と終了が逆でも判定する",
    overlappingMaintenance(w, at(21), at(20)).length, 1);

  console.log("\n表示ラベル");
  check(
    "同日",
    formatMaintenanceRange({ start: "2026-09-08T12:00", end: "2026-09-08T22:00" }),
    "9/8(火) 12:00 〜 22:00",
  );
  check(
    "日跨ぎ",
    formatMaintenanceRange({ start: "2026-09-08T22:00", end: "2026-09-09T06:00" }),
    "9/8(火) 22:00 〜 9/9 06:00",
  );
  check(
    "英語",
    formatMaintenanceRange(
      { start: "2026-09-08T12:00", end: "2026-09-08T22:00" },
      "en",
    ),
    "9/8 (Tue) 12:00 - 22:00",
  );
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
