/**
 * 日付メモの編集・削除権限 (src/lib/memo-permissions.ts) の検証
 * (2026-09-09、L-18)。実行: `node scripts/check-memo-permissions.mjs`
 *
 * この規則は **UI (ボタンの出し分け) と RLS (supabase/schema.sql 7a-2) の
 * 2 箇所に同じものが要る**。片方だけ直すと「押せるのに失敗するボタン」か
 * 「消せるのに出ないボタン」になるので、真理値表に加えて schema 側の
 * ポリシー本文も突き合わせる。
 *
 * 特に固定したいのは次の 2 点:
 *   - 所有者不明 (author_user_id IS NULL) は **削除だけ** 開ける。UPDATE を
 *     開けると、誰の物か分からない行の文面を別人が書き換えられる
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
  const { canEditMemo, canDeleteMemo, isOwnMemo, isOrphanMemo } =
    await import(pathToFileURL(join(outDir, "memo-permissions.js")).href);

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

  console.log("\n削除 (編集できる人 + 所有者不明はログイン済みなら誰でも)");
  check("自分のメモは削除できる", canDeleteMemo(mine, member), true);
  check("他人のメモは削除できない", canDeleteMemo(others, member), false);
  check("所有者不明はログイン済みメンバーなら削除できる", canDeleteMemo(orphan, member), true);
  check("admin はどれでも削除できる",
    [canDeleteMemo(mine, admin), canDeleteMemo(others, admin), canDeleteMemo(orphan, admin)],
    [true, true, true]);
  check("ゲストは所有者不明でも削除できない (anon は RLS で弾かれる)",
    canDeleteMemo(orphan, guest), false);
  check("ゲストは何も削除できない",
    [canDeleteMemo(mine, guest), canDeleteMemo(others, guest)], [false, false]);

  console.log("\n編集より削除のほうが広い (逆転していない)");
  for (const [label, memo] of [["自分", mine], ["他人", others], ["所有者不明", orphan]]) {
    for (const [who, viewer] of [["メンバー", member], ["admin", admin], ["ゲスト", guest]]) {
      if (canEditMemo(memo, viewer) && !canDeleteMemo(memo, viewer)) {
        failures += 1;
        console.log(`  FAIL ${label} × ${who}: 編集できるのに削除できない`);
      }
    }
  }
  console.log("  ok   編集できる組み合わせは必ず削除もできる");
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
check("DELETE は所有者不明も許す",
  /author_user_id IS NULL/.test(policyLine("delete")), true);
check("UPDATE は所有者不明を許さない",
  /author_user_id IS NULL/.test(policyLine("update")), false);
check("INSERT は所有者不明を許さない",
  /author_user_id IS NULL/.test(policyLine("insert")), false);

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
