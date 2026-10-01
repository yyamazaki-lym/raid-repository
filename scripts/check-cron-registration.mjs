/**
 * schema.sql の pg_cron (HTTP を叩くジョブ) の登録方法の検証
 * (2026-10-01 監査 C-3 / F-5)。
 * 実行: `node scripts/check-cron-registration.mjs`
 *
 * schema.sql は本番と公開デモの両方に自動適用され、fork でもそのまま流される。
 * 以前はジョブごとに本番 URL を直書きしていたため、公開デモ DB と fork の
 * DB が上流の本番を叩いていた。ここでは次を固定する:
 *
 *   1. `net.http_get(` を書いてよいのは登録用の一時関数の中だけ
 *      (新しいジョブを足すときに直書きへ戻さない)
 *   2. URL の直書き (`https://…` を url := に渡す) が無い
 *   3. 一時関数は公開デモで登録しない分岐を、登録より前に持つ
 *   4. 通知・催促・warmup の 3 本がその関数経由で登録される
 *
 * 実行時の振る舞い (宛先の引き継ぎ・公開デモで外す・不正な宛先の拒否) は
 * CI に Postgres が無いのでここでは見ない。PR 作成時に PGlite + スタブの
 * cron / net / vault で 6 シナリオを実行して確かめた (PR 本文参照)。
 */
import { readFileSync } from "node:fs";

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

const raw = readFileSync("supabase/schema.sql", "utf8");
// コメント行 (`-- ...`) は説明に URL や関数名を含むので外して数える。
const sql = raw
  .split(/\r?\n/)
  .map((l) => l.replace(/--.*$/, ""))
  .join("\n");

const fnStart = sql.indexOf("CREATE OR REPLACE FUNCTION pg_temp.raid_upsert_http_cron(");
const fnEnd = sql.indexOf("$fn$;", fnStart);
const fn = fnStart >= 0 && fnEnd > fnStart ? sql.slice(fnStart, fnEnd) : "";
const outside = fn ? sql.slice(0, fnStart) + sql.slice(fnEnd) : sql;

console.log("登録の入口");
check("登録用の一時関数がある", fn.length > 0, true);
check(
  "net.http_get は一時関数の中にだけある",
  (outside.match(/net\.http_get\s*\(/g) ?? []).length,
  0,
);
check(
  "URL の直書きが無い (url := 'https://…')",
  (sql.match(/url\s*:=\s*'https?:\/\//g) ?? []).length,
  0,
);
check("vercel.app の直書きが無い", /vercel\.app/.test(sql), false);

console.log("一時関数の分岐");
const demoAt = fn.indexOf("current_setting('app.public_demo', true)");
const scheduleAt = fn.indexOf("cron.schedule(");
const alterAt = fn.indexOf("cron.alter_job(");
check("公開デモの分岐がある", demoAt > 0, true);
check("公開デモの分岐が登録より前", demoAt < scheduleAt && demoAt < alterAt, true);
check("公開デモでは既存ジョブを外す", /cron\.unschedule\(v_jobid\)/.test(fn), true);
check("宛先は app.cron_base_url から読む", /current_setting\('app\.cron_base_url', true\)/.test(fn), true);
check(
  "宛先の形を https://<ホスト名> に限る",
  fn.includes("'^https://[A-Za-z0-9.-]+(:[0-9]+)?$'"),
  true,
);
check("宛先は %L で引用して埋め込む", /url := %L/.test(fn), true);

console.log("登録されるジョブ");
const calls = [...sql.matchAll(/SELECT pg_temp\.raid_upsert_http_cron\(\s*'([^']+)'/g)].map(
  (m) => m[1],
);
check("3 本が一時関数経由", calls.sort(), [
  "attendance-reminder-hourly",
  "notify-native-schedule-hourly",
  "warmup-portal-function",
]);
check(
  "一時関数の定義が呼び出しより前",
  calls.length > 0 && sql.indexOf("SELECT pg_temp.raid_upsert_http_cron(") > fnStart,
  true,
);

if (failures > 0) {
  console.log(`\n${failures} 件失敗`);
  process.exit(1);
}
console.log("\nすべて ok");
