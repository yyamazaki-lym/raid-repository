/**
 * public の全テーブルで RLS が有効化されているかの検査 (2026-09-09)。
 * 実行: `node scripts/check-rls-enabled.mjs [--list]`
 *
 * ## なぜ要るのか
 *
 * Supabase の security advisor が `rls_disabled_in_public` を上げると
 * 「プロジェクト URL を知っている誰でも全行を読み書き削除できる」状態で、
 * 事故としては最も重い。この repo は 2026-08-05 の監査で
 * `fflogs_report_blocklist` が **30 テーブル中ただ 1 つ RLS 未有効**だったのを
 * **人力レビューで見つけた** — 機械的なガードが無かった。
 *
 * `deploy-database.yml` のガードは「本番で anon SELECT ポリシーが 0 本」と
 * 「DEFINER 関数に anon EXECUTE が無い」を見るだけで、**RLS そのものを
 * 有効化し忘れた表は素通りする** (ポリシーが 0 本なのは正常な形でもあるため)。
 *
 * ⚠ **これは repo 側の漏れしか止められない。** ダッシュボードや SQL Editor で
 * 手で作った表は schema.sql に載らないので、この検査には現れない。advisor が
 * 上げてきた表がここに出てこない場合は「schema 外で作られた表」を疑う。
 *
 * ## 何を見るか
 *
 *   1. `CREATE TABLE public.<name>` した表すべてに
 *      `ALTER TABLE public.<name> ENABLE ROW LEVEL SECURITY` があるか
 *   2. 逆に、CREATE が無いのに ENABLE だけ書かれた表が無いか (名前の打ち間違い)
 *   3. 7 章の汎用ポリシーループが名指ししている表が実在するか
 *   4. 2026-10-30 より後に足した表に、GRANT / REVOKE の明示があるか (下の
 *      `PRE_2026_10_30_TABLES` の節)
 *
 * ポリシーの**内容**は見ない (それは 2026-08-05 監査の担当範囲で、
 * 「ポリシー 0 本 = service role 専用」という正しい形もある)。ここは
 * 「RLS を有効化し忘れた」という**一発で致命的になる形**だけを止める。
 */
import { readFileSync } from "node:fs";

// 検査そのものの確かめ用に、読むファイルを差し替えられる (CI では使わない)。
const SCHEMA = process.env.CHECK_SCHEMA_PATH ?? "supabase/schema.sql";

/**
 * 2026-10-30 より前から schema.sql にある表 (2026-10-22 時点の 37 件)。
 *
 * Supabase は 2026-10-30 から、public に新しく作った表を、明示の GRANT があるまで
 * Data API (PostgREST) に出さない。既存の表は従来の既定の権限 (anon / authenticated
 * にも付く) のまま変わらない。schema.sql は表の GRANT を明示せず既定の権限に
 * 頼ってきたので、この一覧に無い (= これから足す) 表は、GRANT か REVOKE を書いて
 * 誰に何を許すかを明示しないと、supabase-js から permission denied になる。
 * ここには表を足さないこと (消した表は外す)。
 */
const PRE_2026_10_30_TABLES = [
  "app_settings", "categories", "category_bis_links", "category_bis_slots",
  "category_discord_blocklist", "category_gphoto_albums", "category_link_reads",
  "category_links", "category_macros", "category_onboarding_steps", "category_waymarks",
  "fflogs_attendance_actuals", "fflogs_attendance_unresolved", "fflogs_fights",
  "fflogs_notify_state", "fflogs_pull_notes", "fflogs_report_blocklist",
  "fflogs_report_syncs", "fflogs_report_videos", "loot_entries", "loot_items",
  "loot_weekly_checks", "mitigation_entries", "mitigation_phases",
  "native_schedule_attendances", "native_schedule_member_jobs",
  "native_schedule_members", "native_schedule_session_logs",
  "native_schedule_sessions", "native_schedules", "recruitment_templates",
  "schedule_past_session_logs", "schedule_past_sessions", "schedule_session_memos",
  "secrets", "strategy_docs", "tags",
];

let failures = 0;
function fail(msg) {
  failures += 1;
  console.log(`  FAIL ${msg}`);
}
function ok(msg) {
  console.log(`  ok   ${msg}`);
}

const src = readFileSync(SCHEMA, "utf8");

/** `CREATE TABLE [IF NOT EXISTS] public.<name>` の表名 (出現順、重複なし)。 */
const created = [];
for (const m of src.matchAll(
  /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?public\.([A-Za-z0-9_]+)/g,
)) {
  if (!created.includes(m[1])) created.push(m[1]);
}

/** `ALTER TABLE public.<name> ENABLE ROW LEVEL SECURITY` の表名。 */
const enabled = new Set(
  [
    ...src.matchAll(
      /ALTER TABLE\s+public\.([A-Za-z0-9_]+)\s+ENABLE ROW LEVEL SECURITY/g,
    ),
  ].map((m) => m[1]),
);

/** 7 章の汎用ポリシーループが名指ししている表 (配列リテラルの中の文字列)。 */
const loopTables = new Set();
{
  const at = src.indexOf("FOR t IN SELECT unnest(ARRAY[");
  if (at >= 0) {
    const end = src.indexOf("]) LOOP", at);
    for (const m of src.slice(at, end).matchAll(/'([a-z0-9_]+)'/g)) {
      loopTables.add(m[1]);
    }
  }
}

if (process.argv.includes("--list")) {
  console.log(`[public テーブル ${created.length} 件]`);
  for (const t of created) {
    const marks = [
      enabled.has(t) ? "RLS" : "RLS なし",
      loopTables.has(t) ? "汎用ポリシー" : "policy 個別/なし",
    ];
    console.log(`  ${t.padEnd(36)} ${marks.join(" / ")}`);
  }
  process.exit(0);
}

console.log(`[RLS 有効化 (public テーブル ${created.length} 件)]`);
{
  const missing = created.filter((t) => !enabled.has(t));
  if (missing.length === 0) {
    ok("全テーブルに ENABLE ROW LEVEL SECURITY がある");
  } else {
    for (const t of missing) {
      fail(
        `public.${t} に ENABLE ROW LEVEL SECURITY が無い — ` +
          `プロジェクト URL を知っている誰でも全行を読み書きできる状態になる。` +
          `7 章に ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY; を足すこと`,
      );
    }
  }
}

console.log("\n[名前の打ち間違い]");
{
  const orphans = [...enabled].filter((t) => !created.includes(t));
  if (orphans.length === 0) {
    ok("ENABLE だけ書かれた表は無い");
  } else {
    for (const t of orphans) {
      fail(
        `public.${t} は ENABLE されているが CREATE TABLE が無い — ` +
          `表名の打ち間違いか、消した表の後始末漏れ`,
      );
    }
  }
}

console.log("\n[汎用ポリシーループの名指し]");
{
  if (loopTables.size === 0) {
    fail("7 章のループを読み取れなかった (検査が壊れている)");
  } else {
    const unknown = [...loopTables].filter((t) => !created.includes(t));
    if (unknown.length === 0) {
      ok(`${loopTables.size} 件すべて実在する`);
    } else {
      for (const t of unknown) {
        fail(
          `ループが public.${t} を名指ししているが CREATE TABLE が無い — ` +
            `DO ブロックは実行時にしか落ちないので、デプロイまで気付けない`,
        );
      }
    }
  }
}

console.log("\n[書き込みポリシーに USING (true) / WITH CHECK (true) が無い]");
{
  // 2026-10-01 監査 S-9: 「誰でも書ける」ポリシーを機械的に止める。今は
  // `USING (true)` は SELECT ポリシーにしか無い (読み取りは authenticated
  // 全員に開ける設計)。書き込みで使うと、PostgREST 直叩きで全行を書き換え
  // られる (2026-08-05 監査 M-1 の元の形)。ポリシーは DO ブロックの
  // format() 文字列で組むことが多いので、コメントを除いた行単位で見る。
  const offenders = [];
  src.split(/\r?\n/).forEach((line, i) => {
    const code = line.replace(/--.*$/, "");
    if (!/(USING|WITH CHECK)\s*\(\s*true\s*\)/i.test(code)) return;
    if (/FOR SELECT/i.test(code)) return;
    offenders.push(`${SCHEMA}:${i + 1}: ${code.trim().slice(0, 100)}`);
  });
  if (offenders.length === 0) {
    ok("書き込み (INSERT / UPDATE / DELETE / ALL) で true を使うポリシーは 0 本");
  } else {
    for (const o of offenders) fail(`SELECT 以外で true を使っている — ${o}`);
  }
}

console.log("\n[2026-10-30 より後に足した表の GRANT / REVOKE の明示]");
{
  const code = src.replace(/--.*$/gm, "");
  const newTables = created.filter((t) => !PRE_2026_10_30_TABLES.includes(t));
  const missing = newTables.filter(
    (t) =>
      !new RegExp(
        `\\b(GRANT|REVOKE)\\s[^;]*?\\sON\\s+(TABLE\\s+)?public\\.${t}\\b`,
        "i",
      ).test(code),
  );
  if (missing.length === 0) {
    ok(
      newTables.length === 0
        ? "新しい表は無い"
        : `新しい表 ${newTables.length} 件すべてに GRANT / REVOKE がある`,
    );
  } else {
    for (const t of missing) {
      fail(
        `public.${t} に GRANT / REVOKE が無い — 2026-10-30 以降の Supabase は、` +
          `明示の GRANT が無い新しい表を Data API に出さない (supabase-js から ` +
          `permission denied)。使うロールへの GRANT (ポリシーの無い表なら REVOKE) を書くこと`,
      );
    }
  }
  const stale = PRE_2026_10_30_TABLES.filter((t) => !created.includes(t));
  if (stale.length === 0) {
    ok(`10-30 より前の表 ${PRE_2026_10_30_TABLES.length} 件はすべて実在する`);
  } else {
    for (const t of stale) {
      fail(`PRE_2026_10_30_TABLES の ${t} に CREATE TABLE が無い — 消した表は一覧からも外す`);
    }
  }
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
