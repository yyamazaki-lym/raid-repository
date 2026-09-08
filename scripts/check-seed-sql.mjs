/**
 * supabase/seed-demo.sql の静的検査 (2026-09-08)。
 * 実行: `node scripts/check-seed-sql.mjs [--list]`
 *
 * ## なぜ要るのか
 *
 * seed-demo.sql は **CI では実行されない**。適用されるのは main への push
 * 後の `deploy-database-demo.yml` (psql) で、そこで初めて実行時エラーが
 * 出る。`--single-transaction` なので半端なデータは残らないが、
 * **デモサイトが古いまま + 失敗に気付くのが遅れる**。
 *
 * 2026-09-08 に実際に踏んだのがこれ:
 *
 *   - `fflogs_report_videos` は 2026-09-07 に「1 レポート N 動画」へ移行して
 *     主キーが `report_code` → `id` に変わり、一意制約は
 *     `UNIQUE INDEX (report_code, video_url)` になっていた
 *   - seed に `ON CONFLICT (report_code) DO NOTHING` と書くと、Postgres は
 *     **実行時**に `no unique or exclusion constraint matching the
 *     ON CONFLICT specification` で落ちる
 *   - 構文は完全に正しいので、パーサ (libpg_query) では見つからない
 *
 * そこで schema.sql から「実在する列」と「一意制約の列組」を読み、
 * seed の `INSERT` / `UPDATE` / `ON CONFLICT` と突き合わせる。
 *
 * ## 何を見ないか
 *
 * CHECK 制約の中身、型の整合、RLS。ここは「実行時に確実に落ちる形」だけを
 * 止める検査で、値の妥当性は見ない (見ようとすると SQL の評価器が要る)。
 */
import { readFileSync } from "node:fs";

const LIST = process.argv.includes("--list");
const schemaSrc = readFileSync("supabase/schema.sql", "utf8");
const seedSrc = readFileSync("supabase/seed-demo.sql", "utf8");

/** table → Set<column> */
const columns = new Map();
/**
 * table → Array<{ name, cols:Set }> (一意制約 / 一意インデックス)。
 *
 * ⚠ **schema.sql は「後から差し替える」書き方をする**ので、宣言を集める
 * だけでは嘘の結果が出る。実例 (2026-09-07):
 *
 *   CREATE TABLE fflogs_report_videos ( report_code text PRIMARY KEY, ... )
 *   ...
 *   ALTER TABLE fflogs_report_videos DROP CONSTRAINT fflogs_report_videos_pkey;
 *   ALTER TABLE fflogs_report_videos ADD CONSTRAINT fflogs_report_videos_pkey
 *     PRIMARY KEY (id);
 *   CREATE UNIQUE INDEX fflogs_report_videos_report_url_uidx
 *     ON fflogs_report_videos (report_code, video_url);
 *
 * 宣言だけ見ると `(report_code)` が一意に見えて、実際には落ちる
 * `ON CONFLICT (report_code)` を通してしまう (この検査の初版が実際に
 * 見逃した)。だから **DROP も含めて文書順に**適用する。
 */
const uniques = new Map();

const addCol = (t, c) => {
  if (!columns.has(t)) columns.set(t, new Set());
  columns.get(t).add(c);
};
const splitCols = (s) =>
  s
    .split(",")
    .map((x) => x.trim().replace(/\s+[\s\S]*$/, ""))
    .filter((x) => /^[a-z_]+$/.test(x));

const RESERVED = new Set([
  "primary",
  "unique",
  "check",
  "foreign",
  "constraint",
  "references",
  "exclude",
]);

/** @type {Array<{at:number, kind:"add"|"drop", table:string, name:string, cols?:string[]}>} */
const events = [];
const add = (at, table, name, cols) =>
  events.push({ at, kind: "add", table, name, cols });
const drop = (at, table, name) => events.push({ at, kind: "drop", table, name });

// ---- CREATE TABLE 本体 (列 + 表内の制約) --------------------------------
for (const m of schemaSrc.matchAll(
  /CREATE TABLE IF NOT EXISTS public\.([a-z_]+)\s*\(([\s\S]*?)\n\);/g,
)) {
  const table = m[1];
  if (!columns.has(table)) columns.set(table, new Set());
  for (const raw of m[2].split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("--")) continue;
    const cm = /^([a-z_]+)\s+[a-z]/.exec(line);
    if (cm && !RESERVED.has(cm[1].toLowerCase())) addCol(table, cm[1]);

    const pk = /^PRIMARY KEY\s*\(([^)]*)\)/i.exec(line);
    if (pk) add(m.index, table, `${table}_pkey`, splitCols(pk[1]));

    const uq = /^UNIQUE\s*\(([^)]*)\)/i.exec(line);
    if (uq) {
      const cols = splitCols(uq[1]);
      add(m.index, table, `${table}_${cols.join("_")}_key`, cols);
    }

    // 列定義に直接付いた PRIMARY KEY / UNIQUE。
    const inline = /^([a-z_]+)\s+[a-z][^,]*\b(PRIMARY KEY|UNIQUE)\b/i.exec(line);
    if (inline && !RESERVED.has(inline[1].toLowerCase())) {
      const isPk = /PRIMARY KEY/i.test(inline[2]);
      add(
        m.index,
        table,
        isPk ? `${table}_pkey` : `${table}_${inline[1]}_key`,
        [inline[1]],
      );
    }
  }
}

// ---- ALTER TABLE (後付け列 / 制約の追加・削除) --------------------------
for (const m of schemaSrc.matchAll(/ALTER TABLE public\.([a-z_]+)([\s\S]*?);/g)) {
  const table = m[1];
  const body = m[2];
  for (const cm of body.matchAll(/ADD COLUMN IF NOT EXISTS\s+([a-z_]+)/g)) {
    addCol(table, cm[1]);
  }
  for (const cm of body.matchAll(
    /ADD CONSTRAINT\s+([a-z_]+)\s+(?:PRIMARY KEY|UNIQUE)\s*\(([^)]*)\)/gi,
  )) {
    add(m.index + cm.index, table, cm[1], splitCols(cm[2]));
  }
  for (const cm of body.matchAll(/DROP CONSTRAINT(?: IF EXISTS)?\s+([a-z_]+)/gi)) {
    drop(m.index + cm.index, table, cm[1]);
  }
}

// ---- CREATE / DROP UNIQUE INDEX -----------------------------------------
for (const m of schemaSrc.matchAll(
  /CREATE UNIQUE INDEX(?: IF NOT EXISTS)?\s+([a-z_]+)\s+\n?\s*ON public\.([a-z_]+)\s*\(([^)]*)\)/g,
)) {
  add(m.index, m[2], m[1], splitCols(m[3]));
}
for (const m of schemaSrc.matchAll(
  /DROP INDEX(?: IF EXISTS)?\s+(?:public\.)?([a-z_]+)/g,
)) {
  // index 名からテーブルは解決できないので、同名を全テーブルから落とす。
  drop(m.index, "*", m[1]);
}

events.sort((a, b) => a.at - b.at);
for (const e of events) {
  if (e.kind === "add") {
    if (!uniques.has(e.table)) uniques.set(e.table, []);
    const list = uniques.get(e.table);
    const entry = { name: e.name, cols: new Set(e.cols) };
    const i = list.findIndex((u) => u.name === e.name);
    if (i >= 0) list[i] = entry;
    else list.push(entry);
  } else {
    for (const [t, list] of uniques) {
      if (e.table !== "*" && e.table !== t) continue;
      const i = list.findIndex((u) => u.name === e.name);
      if (i >= 0) list.splice(i, 1);
    }
  }
}

// ---- seed 側の照合 --------------------------------------------------------
const problems = [];
let insertCols = 0;
let updateCols = 0;
let conflicts = 0;

for (const m of seedSrc.matchAll(
  /INSERT INTO public\.([a-z_]+)\s*(?:\n\s*)?\(([^)]*)\)([\s\S]{0,4000}?)(?=INSERT INTO public\.|\n\s*(?:END|RAISE|UPDATE|FOR|IF)\b|$)/g,
)) {
  const table = m[1];
  const cols = columns.get(table);
  if (!cols) {
    problems.push(`${table}: schema.sql に CREATE TABLE が無い`);
    continue;
  }
  for (const c of splitCols(m[2].replace(/--[^\n]*/g, ""))) {
    insertCols += 1;
    if (!cols.has(c)) problems.push(`${table}.${c}: 存在しない列 (INSERT)`);
  }
  const oc = /ON CONFLICT\s*\(([^)]*)\)/.exec(m[3]);
  if (oc) {
    conflicts += 1;
    const target = splitCols(oc[1]);
    const list = uniques.get(table) ?? [];
    const ok = list.some(
      (u) => u.cols.size === target.length && target.every((c) => u.cols.has(c)),
    );
    if (!ok) {
      problems.push(
        `${table}: ON CONFLICT (${target.join(", ")}) に一致する一意制約が無い —` +
          ` 実在するのは ${
            list.length === 0
              ? "(なし)"
              : list.map((u) => `(${[...u.cols].join(", ")})`).join(" / ")
          }`,
      );
    }
  }
}

for (const m of seedSrc.matchAll(
  /UPDATE public\.([a-z_]+)\s*\n?\s*SET\s+([\s\S]*?)\n\s*(?:WHERE|;)/g,
)) {
  const table = m[1];
  const cols = columns.get(table);
  if (!cols) {
    problems.push(`${table}: schema.sql に CREATE TABLE が無い`);
    continue;
  }
  for (const cm of m[2]
    .replace(/--[^\n]*/g, "")
    .matchAll(/(?:^|,)\s*([a-z_]+)\s*=/g)) {
    updateCols += 1;
    if (!cols.has(cm[1])) {
      problems.push(`${table}.${cm[1]}: 存在しない列 (UPDATE)`);
    }
  }
}

if (LIST) {
  console.log("一意制約 (ON CONFLICT に使える列組):");
  for (const [t, list] of [...uniques].sort()) {
    console.log(
      `  ${t}: ${list.map((u) => `(${[...u.cols].join(", ")})`).join(" / ") || "(なし)"}`,
    );
  }
  console.log("");
}

let failures = 0;
const check = (name, ok, detail = "") => {
  if (ok) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ""}`);
  }
};

console.log(
  `seed-demo.sql: INSERT 列 ${insertCols} / UPDATE 列 ${updateCols} / ON CONFLICT ${conflicts} 件を照合`,
);
check(
  "列と ON CONFLICT の列組が schema.sql と整合する",
  problems.length === 0,
  [...new Set(problems)].join("\n       "),
);
check(
  "走査が空振りしていない (seed に INSERT と ON CONFLICT がある)",
  insertCols > 0 && conflicts > 0,
  "正規表現が seed の書き方に合わなくなった可能性がある",
);
// 主キーの差し替えを追えているか自己検査する。ここが崩れると
// ON CONFLICT の検査が「常に通る」= 無意味な検査に化ける。
const rv = uniques.get("fflogs_report_videos") ?? [];
check(
  "主キーの差し替えを文書順に反映できている",
  rv.some((u) => u.cols.size === 1 && u.cols.has("id")) &&
    !rv.some((u) => u.cols.size === 1 && u.cols.has("report_code")),
  `fflogs_report_videos の一意制約: ${rv
    .map((u) => `(${[...u.cols].join(", ")})`)
    .join(" / ")} — (id) を含み (report_code) 単独を含まないのが正`,
);

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
