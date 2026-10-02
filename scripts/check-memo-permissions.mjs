/**
 * 日付メモの編集・削除権限 (src/lib/memo-permissions.ts) の検証
 * (2026-09-09、L-18)。実行: `node scripts/check-memo-permissions.mjs`
 *
 * この規則は **UI (ボタンの出し分け) と RLS (supabase/schema.sql 7a-2) の
 * 2 箇所に同じものが要る**。片方だけ直すと「押せるのに失敗するボタン」か
 * 「消せるのに出ないボタン」になるので、真理値表に加えて schema 側の
 * ポリシー本文も突き合わせる。
 *
 * 特に固定したいのは次の点:
 *   - 所有者不明 (author_user_id IS NULL) は編集も削除も admin だけ
 *     (2026-10-02 のユーザー決定で L-18 の削除開放を閉じた。監査 S-10)
 *   - 作成は本人の ID でだけ (admin の代理作成もやめた。S-11)
 *   - 1 人 1 日付の件数上限が schema と UI で同じ値 (S-3)
 *   - demo のゲスト (viewer.id = null) には何も開けない。anon key なので
 *     RLS に必ず弾かれる = 押せるのに失敗するボタンになる
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

const ME = "discord-me";
const OTHER = "discord-other";
const mine = { authorUserId: ME };
const others = { authorUserId: OTHER };
const orphan = { authorUserId: null };

const member = { id: ME, isAdmin: false };
const admin = { id: "discord-admin", isAdmin: true };
const guest = { id: null, isAdmin: false };

const outDir = mkdtempSync(join(tmpdir(), "memo-permissions-check-"));
try {
  execFileSync(
    process.execPath,
    ["node_modules/typescript/bin/tsc", "src/lib/memo-permissions.ts", "--outDir", outDir, "--target", "es2022",
     "--module", "es2022", "--moduleResolution", "bundler", "--strict"],
    { stdio: "inherit" },
  );
  for (const f of readdirSync(outDir)) {
    if (!f.endsWith(".js")) continue;
    const fp = join(outDir, f);
    writeFileSync(fp, readFileSync(fp, "utf8").replace(
      /(from\s+["'])(\.\.?\/[^"']+?)(?<!\.js)(["'])/g, "$1$2.js$3"));
  }
  const { canEditMemo, canDeleteMemo, isOwnMemo, isOrphanMemo, MEMO_PER_DATE_LIMIT } =
    await import(pathToFileURL(join(outDir, "memo-permissions.js")).href);
  globalThis.__memoLimit = MEMO_PER_DATE_LIMIT;

  console.log("所有者の判定");
  check("自分のメモ", isOwnMemo(mine, member), true);
  check("他人のメモ", isOwnMemo(others, member), false);
  check("所有者不明は誰の物でもない", isOwnMemo(orphan, member), false);
  check("ゲストは所有者になれない", isOwnMemo(orphan, guest), false);
  check("author_user_id が null = 所有者不明", isOrphanMemo(orphan), true);
  check("所有者つきは所有者不明ではない", isOrphanMemo(mine), false);

  console.log("\n編集 (自分 or admin。所有者不明は開けない)");
  check("自分のメモは編集できる", canEditMemo(mine, member), true);
  check("他人のメモは編集できない", canEditMemo(others, member), false);
  check("所有者不明は一般メンバーには編集させない", canEditMemo(orphan, member), false);
  check("admin は他人のメモも編集できる", canEditMemo(others, admin), true);
  check("admin は所有者不明も編集できる", canEditMemo(orphan, admin), true);
  check("ゲストは編集できない", canEditMemo(orphan, guest), false);
  check("ゲストは自分名義に見える行でも編集できない",
    canEditMemo({ authorUserId: null }, { id: null, isAdmin: false }), false);

  console.log("\n削除 (編集と同じ。所有者不明は admin だけ — 2026-10-02 S-10)");
  check("自分のメモは削除できる", canDeleteMemo(mine, member), true);
  check("他人のメモは削除できない", canDeleteMemo(others, member), false);
  check("所有者不明は一般メンバーには削除させない", canDeleteMemo(orphan, member), false);
  check("admin はどれでも削除できる",
    [canDeleteMemo(mine, admin), canDeleteMemo(others, admin), canDeleteMemo(orphan, admin)],
    [true, true, true]);
  check("ゲストは所有者不明でも削除できない (anon は RLS で弾かれる)",
    canDeleteMemo(orphan, guest), false);
  check("ゲストは何も削除できない",
    [canDeleteMemo(mine, guest), canDeleteMemo(others, guest)], [false, false]);

  console.log("\n編集と削除は同じ規則 (2026-10-02 S-10 以降)");
  for (const [label, memo] of [["自分", mine], ["他人", others], ["所有者不明", orphan]]) {
    for (const [who, viewer] of [["メンバー", member], ["admin", admin], ["ゲスト", guest]]) {
      if (canEditMemo(memo, viewer) !== canDeleteMemo(memo, viewer)) {
        failures += 1;
        console.log(`  FAIL ${label} × ${who}: 編集と削除の可否が食い違う`);
      }
    }
  }
  console.log("  ok   全組み合わせで編集と削除の可否が一致");
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

console.log("\nRLS (supabase/schema.sql 7a-2) と同じ規則か");
const schema = readFileSync("supabase/schema.sql", "utf8");
const policyLine = (action) => {
  const re = new RegExp(
    `CREATE POLICY schedule_session_memos_owner_${action} ON public\\.schedule_session_memos[^']*`,
  );
  const m = schema.match(re);
  return m ? m[0] : "";
};
check("DELETE ポリシーがある", policyLine("delete") !== "", true);
check("DELETE は所有者不明を許さない (S-10)",
  /author_user_id IS NULL/.test(policyLine("delete")), false);
check("DELETE は所有者 または admin",
  /USING %s',\s*owner_or_admin\s*\);/.test(policyLine("delete") + schema.slice(schema.indexOf(policyLine("delete")) + policyLine("delete").length, schema.indexOf(policyLine("delete")) + policyLine("delete").length + 40)), true);
check("UPDATE は所有者不明を許さない",
  /author_user_id IS NULL/.test(policyLine("update")), false);
check("INSERT は所有者不明を許さない",
  /author_user_id IS NULL/.test(policyLine("insert")), false);
const insertAt = schema.indexOf(policyLine("insert"));
check("INSERT は本人だけ (admin の代理作成なし、S-11)",
  /WITH CHECK %s',\s*owner_only\s*\);/.test(schema.slice(insertAt, insertAt + policyLine("insert").length + 40)), true);
const ownerOnly = schema.match(/owner_only text :=\s*\$expr\$\(([\s\S]*?)\)\$expr\$;/);
check("owner_only に is_admin の分岐が無い",
  ownerOnly !== null && !/is_admin/.test(ownerOnly[1]), true);

console.log("\n1 人 1 日付の件数上限 (S-3)");
const trig = schema.match(/CREATE OR REPLACE FUNCTION public\.schedule_session_memos_enforce_limit\(\)[\s\S]*?\$fn\$;/);
const trigBody = trig ? trig[0] : "";
const limitInSchema = trigBody.match(/IF n >= (\d+) THEN/);
check("schema の上限 = MEMO_PER_DATE_LIMIT", limitInSchema ? Number(limitInSchema[1]) : null, globalThis.__memoLimit);
check("上限は 10 (ユーザー決定)", globalThis.__memoLimit, 10);
check("所有者不明の行は数えない", /IF NEW\.author_user_id IS NULL THEN\s*RETURN NEW;/.test(trigBody), true);
check("同じ人・同じ日付で数える", /WHERE author_user_id = NEW\.author_user_id\s*AND raw_date = NEW\.raw_date;/.test(trigBody), true);
check("同時の INSERT を 1 件ずつにする", /pg_advisory_xact_lock\(/.test(trigBody), true);
check("作るときだけ (日付の付け替えを止めない)",
  /CREATE TRIGGER schedule_session_memos_limit\s*BEFORE INSERT ON public\.schedule_session_memos/.test(schema), true);
const client = readFileSync("src/lib/schedule-memos-client.ts", "utf8");
check("画面はトリガーの語を見分けて説明を出す",
  /error\?\.message\?\.includes\("memo_limit_per_date"\)/.test(client) && /memoLimitError\(MEMO_PER_DATE_LIMIT, locale\)/.test(client), true);

console.log("\nUI が判定を再実装していないか");
const popover = readFileSync("src/components/portal/session-memo-popover.tsx", "utf8");
check("canEditMemo / canDeleteMemo を使っている",
  /canEditMemo\(/.test(popover) && /canDeleteMemo\(/.test(popover), true);
check("popover に所有者比較を直書きしていない",
  /authorUserId\s*===\s*viewerId/.test(popover), false);

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
