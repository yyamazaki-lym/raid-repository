/**
 * 書き出したデータの取り込み直し (2026-10-05、監査 F-3 の残り) の検証。
 * 実行: `node scripts/check-data-import.mjs`
 *
 * ユーザー決定は「上書き (主キーが同じ行は上書き、無い行は足す、ファイルに無い
 * 行は消さない)」+「確認画面あり」。ここでは次を固定する:
 *
 *   1. ファイルの読み取り (`src/lib/data-import.ts`): 別のアプリの JSON・版違い・
 *      知らない種類を弾く / 表は種類の並び (参照される側が先) / 秘密になり得る
 *      設定キー・主キーが欠けた行を飛ばす / 種類に無い表は読まない
 *   2. 塊の分け方: JSON のバイト数で上限を超えない (Server Action の 1MB)
 *   3. **上書きが効く前提**: 全種類の全表で、主キーの列 (書き出しの並び) に
 *      schema の PRIMARY KEY / UNIQUE がある (無いと upsert の onConflict が失敗する)
 *   4. 配線: admin を確かめてから service role / 種類に無い表は弾く / 秘密に
 *      なり得る設定キーは書かない / 画面は確認してから取り込む
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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
const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

const outDir = mkdtempSync(join(tmpdir(), "data-import-check-"));
try {
  execFileSync(
    process.execPath,
    [
      "node_modules/typescript/bin/tsc", "src/lib/data-import.ts",
      "--outDir", outDir, "--rootDir", "src/lib",
      "--target", "es2022", "--module", "es2022", "--moduleResolution", "bundler", "--strict",
    ],
    { stdio: "inherit" },
  );
  for (const f of readdirSync(outDir)) {
    if (!f.endsWith(".js")) continue;
    const fp = join(outDir, f);
    writeFileSync(fp, readFileSync(fp, "utf8").replace(/(from\s+["'])(\.\.?\/[^"']+?)(?<!\.js)(["'])/g, "$1$2.js$3"));
  }
  const imp = await import(pathToFileURL(join(outDir, "data-import.js")).href);
  const exp = await import(pathToFileURL(join(outDir, "data-export.js")).href);
  const { parseExportFile, importKeyColumns, pickKey, keyString, chunkRowsBySize, chunkByCount, IMPORT_PART_ORDER, IMPORT_BATCH_MAX_BYTES } = imp;
  const { EXPORT_PARTS, EXPORT_FORMAT, EXPORT_VERSION } = exp;

  console.log("1. ファイルの読み取り");
  const file = (over = {}) => ({ format: EXPORT_FORMAT, version: EXPORT_VERSION, part: "schedule", exportedAt: "2026-10-05T00:00:00.000Z", tables: {}, errors: [], ...over });
  check("別のアプリの JSON は弾く", parseExportFile({ foo: 1 }), { ok: false, reason: "format" });
  check("配列は弾く", parseExportFile([]), { ok: false, reason: "format" });
  check("版が違えば弾く", parseExportFile(file({ version: 999 })), { ok: false, reason: "version" });
  check("知らない種類は弾く", parseExportFile(file({ part: "secrets" })), { ok: false, reason: "part" });
  const sched = parseExportFile(file({
    tables: {
      // わざと参照する側を先に書く
      native_schedule_sessions: [{ id: "s1", raw_date: "x" }, { raw_date: "no id" }, "not an object"],
      native_schedules: [{ id: "sc1", name: "メイン" }],
      secrets: [{ key: "k" }],
    },
    errors: [{ table: "schedule_session_memos", reason: "boom" }],
  }));
  check("読める", sched.ok, true);
  check("表は種類の並び (参照される側が先)", sched.value.tables.map((t) => t.table), ["native_schedules", "native_schedule_sessions"]);
  check("主キーが欠けた行・オブジェクトでない行は飛ばす", [sched.value.tables[1].rows.length, sched.value.tables[1].skipped], [1, 2]);
  check("種類に無い表は読まない", sched.value.ignoredTables, ["secrets"]);
  check("書き出しの失敗を伝える", sched.value.exportErrors, ["schedule_session_memos"]);
  const settings = parseExportFile(file({ part: "settings", tables: { app_settings: [
    { key: "native_schedule_discord_notify_hour", value: "12" },
    { key: "fflogs_oauth_token", value: "x" },
    { key: "discord_cookie", value: "y" },
  ] } }));
  check("秘密になり得る設定キーは飛ばす", settings.value.tables[0].rows.map((r) => r.key), ["native_schedule_discord_notify_hour"]);
  check("飛ばした数", settings.value.tables[0].skipped, 2);
  check("主キー (単一)", importKeyColumns("schedule", "native_schedules"), ["id"]);
  check("主キー (複合)", importKeyColumns("schedule", "native_schedule_attendances"), ["session_id", "discord_user_id"]);
  check("種類に無い表は null", importKeyColumns("schedule", "categories"), null);
  check("知らない種類は null", importKeyColumns("secrets", "secrets"), null);
  check("主キーだけを取り出す", pickKey({ session_id: "s", discord_user_id: "d", symbol: "○" }, ["session_id", "discord_user_id"]), { session_id: "s", discord_user_id: "d" });
  check("主キーの文字列は並び順で比べられる", keyString({ b: 2, a: 1 }, ["a", "b"]), "[1,2]");

  console.log("\n   取り込む順番の案内");
  check("全種類を 1 回ずつ", [...IMPORT_PART_ORDER].sort(), EXPORT_PARTS.map((p) => p.id).sort());
  check("設定値とコンテンツが先、明細が最後", [IMPORT_PART_ORDER[0], IMPORT_PART_ORDER[1], IMPORT_PART_ORDER.at(-1)], ["settings", "content", "fights"]);

  console.log("\n2. 塊の分け方");
  const big = Array.from({ length: 50 }, (_, i) => ({ id: String(i), body: "あ".repeat(100) }));
  const chunks = chunkRowsBySize(big, 2000);
  const enc = new TextEncoder();
  check("どの塊も上限以下", chunks.every((c) => enc.encode(JSON.stringify(c)).length <= 2000), true);
  check("全行が順に入る", chunks.flat().map((r) => r.id), big.map((r) => r.id));
  check("1 行で上限を超える行はその 1 行で 1 塊", chunkRowsBySize([{ x: "a".repeat(5000) }, { x: "b" }], 1000).map((c) => c.length), [1, 1]);
  check("空", chunkRowsBySize([]), []);
  check("既定の上限は 1MB 未満", IMPORT_BATCH_MAX_BYTES < 1_000_000, true);
  check("数で分ける", chunkByCount([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);

  console.log("\n3. 上書きが効く前提 (主キーの列に schema の PRIMARY KEY / UNIQUE)");
  const schema = read("supabase/schema.sql");
  const norm = (cols) => cols.split(",").map((c) => c.trim().replace(/"/g, "")).filter(Boolean).sort().join(",");
  function uniqueSets(table) {
    const sets = new Set();
    const createRe = new RegExp(`CREATE TABLE IF NOT EXISTS (?:public\\.)?${table} \\(([\\s\\S]*?)\\n\\);`);
    const m = schema.match(createRe);
    if (m) {
      for (const line of m[1].split("\n")) {
        const col = line.match(/^\s*([a-z_][a-z0-9_]*)\s+[a-z].*\b(PRIMARY KEY|UNIQUE)\b/);
        if (col) sets.add(col[1]);
      }
      for (const t of m[1].matchAll(/(?:PRIMARY KEY|UNIQUE)\s*\(([^)]+)\)/g)) sets.add(norm(t[1]));
    }
    for (const t of schema.matchAll(new RegExp(`ALTER TABLE (?:public\\.)?${table}\\s+ADD CONSTRAINT \\w+\\s+(?:PRIMARY KEY|UNIQUE)\\s*\\(([^)]+)\\)`, "g"))) sets.add(norm(t[1]));
    for (const t of schema.matchAll(new RegExp(`CREATE UNIQUE INDEX IF NOT EXISTS \\w+\\s+ON (?:public\\.)?${table}\\s*\\(([^)]+)\\)\\s*;`, "g"))) {
      if (!/\(/.test(t[1])) sets.add(norm(t[1]));
    }
    return sets;
  }
  for (const p of EXPORT_PARTS) {
    for (const t of p.tables) {
      check(`${p.id}/${t.table}: (${t.order.join(", ")}) が一意`, uniqueSets(t.table).has(norm(t.order.join(","))), true);
    }
  }

  // 2026-10-07: 種類の中の表は「参照される側が先」の順で入れる (外部キー)。
  // content で category_links (gphoto_album_id → category_gphoto_albums) が
  // アルバムより先に並んでいて、アルバムがまだ無い DB に取り込むとアルバムに
  // 紐づくリンクの塊が外部キーで失敗していた。schema の REFERENCES と突き合わせる。
  console.log("\n3b. 種類の中の表の順番 (参照される側が先)");
  function referencedTables(table) {
    const refs = new Set();
    const createRe = new RegExp(`CREATE TABLE IF NOT EXISTS (?:public\\.)?${table} \\(([\\s\\S]*?)\\n\\);`);
    const m = schema.match(createRe);
    const bodies = m ? [m[1]] : [];
    for (const a of schema.matchAll(new RegExp(`ALTER TABLE (?:public\\.)?${table}\\b([^;]*);`, "g"))) bodies.push(a[1]);
    for (const b of bodies) {
      for (const r of b.matchAll(/REFERENCES\s+(?:public\.)?([a-z_][a-z0-9_]*)\s*\(/g)) {
        if (r[1] !== table) refs.add(r[1]);
      }
    }
    return refs;
  }
  for (const p of EXPORT_PARTS) {
    const pos = new Map(p.tables.map((t, i) => [t.table, i]));
    const late = [];
    p.tables.forEach((t, i) => {
      for (const ref of referencedTables(t.table)) {
        if (pos.has(ref) && pos.get(ref) > i) late.push(`${t.table} → ${ref}`);
      }
    });
    check(`${p.id}: 参照される表が先に並ぶ`, late, []);
  }
  // 種類をまたぐ参照は、取り込み順の案内 (IMPORT_PART_ORDER) で参照される側の
  // 種類が先に来ること。
  const partOf = new Map(EXPORT_PARTS.flatMap((p) => p.tables.map((t) => [t.table, p.id])));
  const partPos = new Map(IMPORT_PART_ORDER.map((id, i) => [id, i]));
  const crossLate = [];
  for (const p of EXPORT_PARTS) {
    for (const t of p.tables) {
      for (const ref of referencedTables(t.table)) {
        const rp = partOf.get(ref);
        if (rp && rp !== p.id && partPos.get(rp) > partPos.get(p.id)) crossLate.push(`${p.id}/${t.table} → ${rp}/${ref}`);
      }
    }
  }
  check("種類をまたぐ参照は、参照される種類が案内の順で先", crossLate, []);
  check(
    "content: category_links はアルバム (category_gphoto_albums) を参照する (この検査が効く前提)",
    referencedTables("category_links").has("category_gphoto_albums"),
    true,
  );
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

console.log("\n4. 配線");
const actions = read("src/lib/server/data-import-actions.ts");
for (const fn of ["countExistingImportRowsAction", "applyImportBatchAction"]) {
  const at = actions.indexOf(`export async function ${fn}(`);
  const body = at < 0 ? "" : actions.slice(at, actions.indexOf("\nexport ", at + 1) < 0 ? undefined : actions.indexOf("\nexport ", at + 1));
  check(`${fn}: admin を確かめてから service role`, body.indexOf("assertAdminResult()") > 0 && body.indexOf("assertAdminResult()") < body.indexOf("createSupabaseServiceRoleClient()"), true);
  check(`${fn}: 種類に無い表を弾く入力検査を通す`, /const v = checkInput\(/.test(body), true);
}
check("入力検査は importKeyColumns で表を照合する", /const keyColumns = importKeyColumns\(part, table\);\s*if \(!keyColumns\) return/.test(actions), true);
check("upsert は主キーで照合する (上書き)", /\.upsert\(rows, \{ onConflict: v\.keyColumns\.join\(","\), ignoreDuplicates: false \}\)/.test(actions), true);
check("秘密になり得る設定キーは書かない", /input\.table === "app_settings"\s*\?\s*v\.rows\.filter\(\(r\) => !isSensitiveSettingKey/.test(actions), true);
check("delete を使わない (ファイルに無い行は消さない)", /\.delete\(/.test(actions), false);
const panel = read("src/components/portal/settings/data-import-panel.tsx");
const importAt = panel.indexOf("const onImport = async");
const importBody = panel.slice(importAt, panel.indexOf("\n  };", importAt));
check("画面: 確認ダイアログのあとで取り込む", importBody.indexOf("await confirm(") > 0 && importBody.indexOf("await confirm(") < importBody.indexOf("applyImportBatchAction("), true);
check("画面: 件数の確認が済むまで取り込めない", /disabled=\{busy !== null \|\| counts === null\}/.test(panel), true);

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
