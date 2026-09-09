/**
 * 同期式の出欠スナップショット → メンバーキーの検証 (L-14、2026-09-09)。
 * 実行: `node scripts/check-attendance-sync-symbols.mjs`
 *
 * ## なぜ要るのか
 *
 * 出席サマリーを同期式でも使えるようにした
 * (`server/attendance-summary-actions.ts`)。同期式の回答は
 * `schedule_past_sessions.attendances` (`{"名前": "◯", ...}`) で **キーが
 * 名前**なので、集計に渡す前にメンバーキーへ直す層が入る。
 *
 * ここが崩れても**画面はエラーを出さない**。出るのは「回答が無かった」
 * = 実質「休んだ」扱いの静かな誤りなので、契約として固定する:
 *
 *   1. 名前の一致は表記ゆれを吸収する (全角/半角・空白・大文字小文字)
 *   2. 同じキーに 2 人当たったら**どちらにも解決しない** (取り違えるより
 *      未解決の方がまし)
 *   3. スナップショットが無い日は `null` を返す (= 集計から外して数える)。
 *      **空オブジェクトと混同しない** — 空は「記録はあるが誰も回答して
 *      いない」で、無いのは「分からない」
 *
 * ⚠ tsc は `npx` 経由にしない (Windows で ENOENT / EINVAL になり、CI の
 * ubuntu では通るので壊れていることに気付けない)。
 */
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

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

const outDir = mkdtempSync(join(tmpdir(), "sync-symbols-check-"));
try {
  execFileSync(
    process.execPath,
    [
      "node_modules/typescript/bin/tsc",
      "src/lib/schedule/attendance-sync-symbols.ts",
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
  const fix = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        fix(p);
        continue;
      }
      if (!name.endsWith(".js")) continue;
      const src = readFileSync(p, "utf8").replace(
        /from "(\.\.?\/[^"]+)"/g,
        (mm, spec) => (spec.endsWith(".js") ? mm : `from "${spec}.js"`),
      );
      writeFileSync(p, src);
    }
  };
  fix(outDir);

  const m = await import(
    pathToFileURL(join(outDir, "attendance-sync-symbols.js")).href
  );

  const members = [
    { discordUserId: "u1", displayName: "むーたん" },
    { discordUserId: "u2", displayName: "Latteko" },
    { discordUserId: "u3", displayName: "" },
    { discordUserId: "u4", displayName: "かぶり" },
    { discordUserId: "u5", displayName: "かぶり" },
  ];
  const keyByName = m.buildMemberKeyByName(members);

  console.log("\n[名前 → メンバーキー]");
  check("そのまま一致", keyByName.get("むーたん"), "u1");
  check("小文字化して一致", keyByName.get("latteko"), "u2");
  check("空の表示名は表に入れない", keyByName.has(""), false);
  check("同名は未解決 (null)", keyByName.get("かぶり"), null);

  console.log("\n[スナップショット → 記号]");
  check(
    "名前が当たった人だけメンバーキーで返る",
    m.syncSymbolsFromSnapshot(
      { "むーたん": "◯", "ＬＡＴＴＥＫＯ": "×", "退会した人": "◯" },
      keyByName,
    ),
    { u1: "◯", u2: "×" },
  );
  check(
    "同名で未解決の人は落ちる (取り違えない)",
    m.syncSymbolsFromSnapshot({ "かぶり": "◯", "むーたん": "△" }, keyByName),
    { u1: "△" },
  );
  check(
    "記号が文字列でない値は落とす",
    m.syncSymbolsFromSnapshot({ "むーたん": 1, "Latteko": "◯" }, keyByName),
    { u2: "◯" },
  );

  console.log("\n[記録が無い日と空の日を混同しない]");
  check("null は null (集計から外す)", m.syncSymbolsFromSnapshot(null, keyByName), null);
  check(
    "undefined は null",
    m.syncSymbolsFromSnapshot(undefined, keyByName),
    null,
  );
  check(
    "配列は null (形が違う)",
    m.syncSymbolsFromSnapshot([], keyByName),
    null,
  );
  check(
    "空オブジェクトは空の記号 (記録はあるが誰も回答していない)",
    m.syncSymbolsFromSnapshot({}, keyByName),
    {},
  );
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

/**
 * 呼び出し側 (`server/attendance-summary-actions.ts`) が **同期式では
 * `native_schedule_attendances` を読まない**ことを、コードを見て確かめる
 * (L-20、2026-09-09)。
 *
 * 同期式のセッション行は `schedule_past_sessions` 由来で `id` を持たない。
 * そのまま `.in("session_id", rows.map(s => s.id))` すると `undefined` が
 * 送られ **`invalid input syntax for type uuid: "undefined"`** で読み取りが
 * 3 本まとめて失敗し、画面は「出席サマリーの取得に失敗しました」になる
 * (本番で実際に発生)。純関数側では捕まえられないので構造検査で固定する。
 */
console.log("\n呼び出し側 (同期式では native の出欠表を読まない)");
const caller = readFileSync(
  "src/lib/server/attendance-summary-actions.ts",
  "utf8",
);
check(
  "session_id の in に生の s.id を渡していない",
  /\.in\(\s*["']session_id["'],\s*\n?\s*sessionRows\.map/.test(caller),
  false,
);
check(
  "同期式では session id を空にしている",
  /syncMode\s*\?\s*\[\]/.test(caller),
  true,
);
check(
  "undefined を除いてから渡している",
  /filter\(\(id\): id is string => typeof id === "string"\)/.test(caller),
  true,
);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
