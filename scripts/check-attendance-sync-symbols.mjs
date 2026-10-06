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
      "--rootDir",
      "src/lib",
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
    pathToFileURL(join(outDir, "schedule", "attendance-sync-symbols.js")).href
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

  // 2026-10-06: シートでの旧名。本番で 9/11 まで「Lym」「makiton」、9/18 から
  // 「Lym.sln」「.makiton」に変わり、古い日の回答が「未回答」になっていた。
  console.log("\n[シートでの旧名]");
  const withAliases = [
    { discordUserId: "lym", displayName: "Lym.sln", scheduleAliases: ["Lym"] },
    { discordUserId: "mak", displayName: ".makiton", scheduleAliases: ["makiton"] },
    { discordUserId: "ene", displayName: "enero", scheduleAliases: [] },
    // 旧名が別のメンバーの今の表示名と同じ → 旧名の方は載せない (今の名前を優先)
    { discordUserId: "x", displayName: "X", scheduleAliases: ["enero"] },
    // 同じ旧名が 2 人 → 未解決
    { discordUserId: "p", displayName: "P", scheduleAliases: ["old"] },
    { discordUserId: "q", displayName: "Q", scheduleAliases: ["OLD"] },
  ];
  const keyByAlias = m.buildMemberKeyByName(withAliases);
  const aliasIdx = m.buildMemberNameIndex(withAliases);
  check(
    "旧名で引ける (本番の Lym / makiton)",
    m.syncSymbolsFromSnapshot({ Lym: "△", makiton: "◯", "Lym.sln": "×" }, aliasIdx.keyByName, aliasIdx.aliasKeys),
    { lym: "×", mak: "◯" },
  );
  check(
    "旧名でだけ載ったキーの集合 (表示名と同じ旧名・未解決の旧名を含めた対応表と一致)",
    [...aliasIdx.aliasKeys].sort(),
    ["lym", "makiton", "old"],
  );
  check("今の表示名は旧名より優先 (enero は enero のまま)", keyByAlias.get("enero"), "ene");
  check("同じ旧名が 2 人なら未解決", keyByAlias.get("old"), null);
  check("旧名が無ければ従来どおり", m.buildMemberKeyByName(members).get("むーたん"), "u1");

  const sheet = [
    { userId: "s1", name: "enero" },
    { userId: "s2", name: ".makiton" },
    { userId: "s3", name: "Lym.sln" },
  ];
  const resolve = m.buildSheetUserResolver(sheet, withAliases);
  check(
    "過去ログ: 今のシートの名前は完全一致、旧名はメンバーの表示名経由でシートの人へ",
    ["enero", "Lym", "makiton", "Lym.sln", "知らない人", "old"].map((n) => resolve(n) ?? null),
    ["s1", "s3", "s2", "s3", null, null],
  );
  check(
    "過去ログ: メンバーが空なら従来どおり完全一致だけ",
    ["enero", "Lym"].map((n) => m.buildSheetUserResolver(sheet, [])(n) ?? null),
    ["s1", null],
  );
  check(
    "過去ログ: 回答を今のシートの userId に直す (本番の Lym / makiton)",
    m.buildSheetAttendanceMapper(sheet, withAliases)({ Lym: "△", makiton: "◯", enero: "×", "知らない人": "◯" }),
    { s1: "×", s3: "△", s2: "◯" },
  );

  // ⚠ 保存済みの jsonb はキーを「バイト長が短い順」で返す。同じ日に旧名の行
  // (作り直す前の行など) と今の名前の行が両方あっても、どちらが残るかを名前の
  // 長さで決めない: 今の名前で当たった回答は旧名を入れる前と同じに扱い、
  // 旧名の回答はその人の回答が無いときだけ使う。
  console.log("\n[今の名前の回答が旧名の回答より優先]");
  const neko = [{ discordUserId: "a", displayName: "Neko", scheduleAliases: ["ねこまる"] }];
  const nekoIdx = m.buildMemberNameIndex(neko);
  const syncNeko = (snap) => m.syncSymbolsFromSnapshot(snap, nekoIdx.keyByName, nekoIdx.aliasKeys);
  const mapNeko = m.buildSheetAttendanceMapper([{ userId: "s-neko", name: "Neko" }], neko);
  for (const [label, snap] of [
    ["今の名前が先", { Neko: "◯", "ねこまる": "－" }],
    ["旧名が先", { "ねこまる": "－", Neko: "◯" }],
  ]) {
    check(`出席サマリー: ${label}でも今の名前の回答`, syncNeko(snap), { a: "◯" });
    check(`過去ログ: ${label}でも今の名前の回答`, mapNeko(snap), { "s-neko": "◯" });
  }
  check(
    "今の名前が未回答でも旧名の回答で上書きしない (旧名を入れる前と同じ結果)",
    [syncNeko({ "ねこまる": "◯", Neko: "－" }), mapNeko({ "ねこまる": "◯", Neko: "－" })],
    [{ a: "－" }, { "s-neko": "－" }],
  );
  check(
    "今の名前の回答が無ければ旧名の回答",
    [syncNeko({ "ねこまる": "△" }), mapNeko({ "ねこまる": "△" })],
    [{ a: "△" }, { "s-neko": "△" }],
  );
  const twoOld = [{ discordUserId: "b", displayName: "B", scheduleAliases: ["b1", "b2"] }];
  const twoIdx = m.buildMemberNameIndex(twoOld);
  check(
    "旧名どうしは回答済みを未回答より優先 (順序によらない)",
    [
      m.syncSymbolsFromSnapshot({ b1: "－", b2: "◯" }, twoIdx.keyByName, twoIdx.aliasKeys),
      m.syncSymbolsFromSnapshot({ b2: "◯", b1: "－" }, twoIdx.keyByName, twoIdx.aliasKeys),
    ],
    [{ b: "◯" }, { b: "◯" }],
  );

  console.log("\n[旧名の入力]");
  check(
    "区切り (カンマ・読点・改行) で分け、空白・空・重複を除く",
    m.normalizeScheduleAliases(m.splitScheduleAliasInput(" Lym, lym 、makiton\n\n")),
    { ok: true, aliases: ["Lym", "makiton"] },
  );
  check("6 つ以上は不可", m.normalizeScheduleAliases(["a", "b", "c", "d", "e", "f"]), { ok: false, error: "too-many" });
  check("41 文字以上は不可", m.normalizeScheduleAliases(["x".repeat(41)]), { ok: false, error: "too-long" });
  check("制御文字は不可", m.normalizeScheduleAliases(["a\u0007b"]), { ok: false, error: "control" });
  check("空なら空の一覧 (全部消す)", m.normalizeScheduleAliases([]), { ok: true, aliases: [] });
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

// 2026-10-06: 旧名の配線。
console.log("\n旧名の配線");
const callerN = caller.replace(/\r\n/g, "\n");
check(
  "出席サマリー: メンバーの旧名を読み、対応表に載せる",
  /\.select\("discord_user_id, display_name, sort_order, is_active, schedule_aliases"\)/.test(callerN) &&
    /scheduleAliases: mem\.schedule_aliases \?\? \[\],/.test(callerN) &&
    /syncSymbolsFromSnapshot\(s\.attendances, keyByName, aliasKeys\)/.test(callerN),
  true,
);
const nextSession = readFileSync("src/lib/schedule/next-session.ts", "utf8").replace(/\r\n/g, "\n");
check(
  "過去ログの表示: 旧名でもシートの人に結びつける",
  /fetchMemberNameAliases\(\),/.test(nextSession) &&
    /const mapSheetAttendances = buildSheetAttendanceMapper\(parsed\.users, memberAliases\);/.test(nextSession) &&
    /\? mapSheetAttendances\(s\.attendances\)/.test(nextSession),
  true,
);
const actions = readFileSync("src/lib/server/native-schedule-actions.ts", "utf8").replace(/\r\n/g, "\n");
check(
  "Server Action: 配列で文字列のときだけ受け取り、同じ規則で確かめる",
  /!Array\.isArray\(patch\.scheduleAliases\) \|\|\s*patch\.scheduleAliases\.some\(\(a\) => typeof a !== "string"\)/.test(actions) &&
    /const r = normalizeScheduleAliases\(patch\.scheduleAliases\);/.test(actions) &&
    /update\.schedule_aliases = r\.aliases;/.test(actions),
  true,
);
const schema = readFileSync("supabase/schema.sql", "utf8").replace(/\r\n/g, "\n");
check(
  "schema: 列は空の配列が既定 (既存の行を書き換えない) で、数・長さ・制御文字を CHECK",
  /ADD COLUMN IF NOT EXISTS schedule_aliases text\[\] NOT NULL DEFAULT '\{\}';/.test(schema) &&
    /cardinality\(schedule_aliases\) <= 5/.test(schema) &&
    /array_to_string\(schedule_aliases, ''\) !~ '\[\[:cntrl:\]\]'/.test(schema),
  true,
);
const section = readFileSync("src/components/portal/settings/native-members-section.tsx", "utf8").replace(/\r\n/g, "\n");
check(
  "設定: Members に旧名の欄があり、変えたときだけ送る",
  /aria-label=\{m\.nativeMembers\.aliasLabel\}/.test(section) &&
    /if \(aliasesKey\(draft\.scheduleAliases\) !== aliasesKey\(\(mem\.schedule_aliases \?\? \[\]\)\.join\(","\)\)\) \{/.test(section) &&
    /patch\.scheduleAliases = r\.aliases;/.test(section),
  true,
);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
