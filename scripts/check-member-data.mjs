/**
 * メンバー削除のときに残る関連データの整理 (2026-10-01 監査 F-4) の検査。
 * 実行: `node scripts/check-member-data.mjs`
 *
 *   1. **schema の網羅**: メンバーの ID を持つ列 (`discord_user_id` /
 *      `created_by_id` / `author_user_id`) が、整理の対象 (MEMBER_DATA_TARGETS)
 *      ・FK で CASCADE する表・メンバー行そのもの・意図した除外のどれかに
 *      必ず入っている。新しい表にメンバーの ID の列を足したら、ここで落ちる
 *      (削除のときに残るのか消すのかを決めさせる)
 *   2. 純関数と、メンバーキーの形が削除 Action と同じであること
 *   3. 配線: 件数 → 2 段目の確認 → (選んだときだけ) 整理 → メンバー削除 の順。
 *      件数が読めなければ削除しない。Action は admin のみ・キーを検査する
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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

/** FK で CASCADE するので整理の対象にしない列。 */
const CASCADES = new Set([
  "native_schedule_member_jobs.discord_user_id",
  "native_schedule_attendances.discord_user_id",
]);
/** メンバー行そのもの。 */
const SELF = new Set(["native_schedule_members.discord_user_id"]);
/** 意図して残す列と理由。 */
const EXCLUDED = {
  "native_schedule_sessions.created_by_id":
    "日程を作った admin の記録 (メンバーの個人データではない)",
};

const outDir = mkdtempSync(join(tmpdir(), "member-data-check-"));
try {
  execFileSync(
    process.execPath,
    [
      "node_modules/typescript/bin/tsc",
      "src/lib/member-data.ts",
      "--outDir", outDir,
      "--target", "es2022",
      "--module", "es2022",
      "--moduleResolution", "bundler",
      "--strict",
    ],
    { stdio: "inherit" },
  );
  const md = await import(pathToFileURL(join(outDir, "member-data.js")).href);

  console.log("1. schema の網羅");
  {
    const schema = readFileSync("supabase/schema.sql", "utf8");
    const cols = new Map(); // "table.column" -> FK あり?
    for (const m of schema.matchAll(/CREATE TABLE IF NOT EXISTS public\.(\w+) \(([\s\S]*?)\n\);/g)) {
      for (const c of m[2].matchAll(/^\s+(discord_user_id|created_by_id|author_user_id)\s+text[^\n]*(\n\s+REFERENCES public\.native_schedule_members)?/gm)) {
        cols.set(`${m[1]}.${c[1]}`, Boolean(c[2]) || /REFERENCES public\.native_schedule_members/.test(c[0]));
      }
    }
    for (const m of schema.matchAll(/ALTER TABLE public\.(\w+)\s+ADD COLUMN IF NOT EXISTS (discord_user_id|created_by_id|author_user_id) text/g)) {
      cols.set(`${m[1]}.${m[2]}`, false);
    }
    const targets = new Set(md.MEMBER_DATA_TARGETS.map((t) => `${t.table}.${t.column}`));
    const unclassified = [...cols.keys()].filter(
      (k) => !targets.has(k) && !CASCADES.has(k) && !SELF.has(k) && !(k in EXCLUDED),
    );
    check(`メンバーの ID を持つ列 ${cols.size} 個がすべて仕分け済み`, unclassified, []);
    check("抽出が空でない (検査が壊れていない)", cols.size >= 10, true);
    const missingTargets = [...targets].filter((k) => !cols.has(k));
    check("整理の対象は schema に実在する", missingTargets, []);
    const cascadeOk = [...CASCADES].every((k) => {
      const [table] = k.split(".");
      const block = new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table} \\(([\\s\\S]*?)\\n\\);`).exec(schema);
      return Boolean(block && /REFERENCES public\.native_schedule_members[\s\S]*?ON DELETE CASCADE/.test(block[1]));
    });
    check("CASCADE 扱いの表は実際に ON DELETE CASCADE", cascadeOk, true);
  }

  console.log("2. 純関数とキーの形");
  {
    check("合計 (未指定は 0、負は 0)", md.memberDataTotal({ linkReads: 2, selfNotes: 3, lootWeekly: -1 }), 5);
    check("空なら 0 (2 段目の確認を出さない)", md.memberDataTotal({}), 0);
    check("delete は個人の記録、detach は共有の記録", md.MEMBER_DATA_TARGETS.filter((t) => t.action === "detach").map((t) => t.id).sort(), ["memoAuthor", "teamNotesAuthor"]);
    check("自分用の注釈は scope=self だけ消す", md.MEMBER_DATA_TARGETS.find((t) => t.id === "selfNotes").filter, { column: "scope", value: "self" });
    check("チームの注釈は scope=team だけ ID を外す", md.MEMBER_DATA_TARGETS.find((t) => t.id === "teamNotesAuthor").filter, { column: "scope", value: "team" });
    const actions = readFileSync("src/lib/server/native-schedule-actions.ts", "utf8");
    const src = /const MEMBER_KEY_RE = (\/.*\/);/.exec(actions)?.[1];
    check("メンバーキーの形が削除 Action と同じ", String(md.MEMBER_DATA_KEY_RE), src);
    check("キー: Discord ID", md.MEMBER_DATA_KEY_RE.test("123456789012345678"), true);
    check("キー: ローカルキー", md.MEMBER_DATA_KEY_RE.test("local_abc"), true);
    check("キー: SQL っぽい文字列は弾く", md.MEMBER_DATA_KEY_RE.test("1 or 1=1"), false);
  }

  console.log("3. 配線");
  {
    const ui = readFileSync("src/components/portal/settings/native-members-section.tsx", "utf8");
    const body = ui.slice(ui.indexOf("const onDelete = async"), ui.indexOf("const onDelete = async") + 3000);
    const iCounts = body.indexOf("await getMemberDataCountsAction(");
    const iAbort = body.indexOf("if (!counts.ok) {");
    const iConfirm = body.indexOf("purge = await confirm({");
    const iPurge = body.indexOf("await purgeMemberPersonalDataAction(");
    const iDelete = body.indexOf("await deleteNativeScheduleMemberAction(");
    check("件数 → 確認 → 整理 → 削除 の順", iCounts > 0 && iConfirm > iCounts && iPurge > iConfirm && iDelete > iPurge, true);
    check("件数が読めなければ削除しない", iAbort > iCounts && /if \(!counts\.ok\) \{\s*toast\.error\(counts\.reason\);\s*return;/.test(body), true);
    check("整理は確認で選んだときだけ", /let purge = false;/.test(body) && /if \(purge\) \{/.test(body), true);
    check("整理に失敗したらメンバーは消さない", /if \(!p\.ok\) \{\s*toast\.error\(p\.reason\);\s*return;/.test(body), true);
    check("件数 0 なら 2 段目を出さない", /if \(memberDataTotal\(counts\.counts\) > 0\) \{/.test(body), true);
    const act = readFileSync("src/lib/server/member-data-actions.ts", "utf8");
    check("Action は admin のみ (2 本とも)", (act.match(/const auth = await assertAdminResult\(\);\s*if \(!auth\.ok\) return/g) ?? []).length, 2);
    check("Action はキーを検査する (2 本とも)", (act.match(/if \(!id \|\| !MEMBER_DATA_KEY_RE\.test\(id\)\)/g) ?? []).length, 2);
    check("delete は行を消し、detach は列を NULL に", /t\.action === "delete"\s*\?\s*supabase\.from\(t\.table\)\.delete\(/.test(act) && /\.update\(\{ \[t\.column\]: null \}/.test(act), true);
    check("件数と整理の 2 本とも絞り込み (scope) を掛ける", (act.match(/if \(t\.filter\) q = q\.eq\(t\.filter\.column, t\.filter\.value\);/g) ?? []).length, 2);
  }
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

if (failures > 0) {
  console.log(`\n${failures} 件失敗`);
  process.exit(1);
}
console.log("\nすべて ok");
