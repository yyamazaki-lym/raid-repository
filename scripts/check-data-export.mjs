/**
 * データの書き出し (2026-10-01 監査 F-3) の検査。
 * 実行: `node scripts/check-data-export.mjs`
 *
 *   1. **schema の網羅**: schema.sql の全テーブルが、どれか 1 つの種類か
 *      除外 (`secrets`) に入っている。新しい表を足したら、書き出すか除くかを
 *      決めないとここで落ちる。並びに使う列は表に実在する
 *   2. 純関数: 秘密になり得る設定キーの判定・ファイル名・種類の解決
 *   3. route の配線: 別サイトからは拒否 → admin 判定 → 種類の検査 → 流す。
 *      ページ送り・秘密のキーの除外・no-store / attachment・最後の errors
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

const outDir = mkdtempSync(join(tmpdir(), "data-export-check-"));
try {
  execFileSync(
    process.execPath,
    [
      "node_modules/typescript/bin/tsc",
      "src/lib/data-export.ts",
      "--outDir", outDir,
      "--target", "es2022",
      "--module", "es2022",
      "--moduleResolution", "bundler",
      "--strict",
    ],
    { stdio: "inherit" },
  );
  const de = await import(pathToFileURL(join(outDir, "data-export.js")).href);

  console.log("1. schema の網羅");
  {
    const schema = readFileSync("supabase/schema.sql", "utf8");
    const tables = new Map(); // name -> 列名の集合
    for (const m of schema.matchAll(/CREATE TABLE IF NOT EXISTS (?:public\.)?(\w+) \(([\s\S]*?)\n\);/g)) {
      const cols = new Set([...m[2].matchAll(/^\s+(\w+)\s+(?:text|uuid|integer|bigint|boolean|timestamptz|date|jsonb|smallint|numeric|real|double)/gm)].map((c) => c[1]));
      tables.set(m[1], cols);
    }
    for (const m of schema.matchAll(/ALTER TABLE (?:public\.)?(\w+)\s+ADD COLUMN IF NOT EXISTS (\w+)/g)) {
      tables.get(m[1])?.add(m[2]);
    }
    const inParts = de.EXPORT_PARTS.flatMap((p) => p.tables.map((t) => t.table));
    const excluded = Object.keys(de.EXPORT_EXCLUDED_TABLES);
    const uncovered = [...tables.keys()].filter((t) => !inParts.includes(t) && !excluded.includes(t));
    check(`schema の ${tables.size} 表がすべて種類か除外に入っている`, uncovered, []);
    check("抽出が空でない (検査が壊れていない)", tables.size >= 36, true);
    check("種類に無い表名が無い", inParts.filter((t) => !tables.has(t)), []);
    const dup = inParts.filter((t, i) => inParts.indexOf(t) !== i);
    check("同じ表を 2 つの種類に入れていない", dup, []);
    check("除外は秘密の表だけ", excluded, ["secrets"]);
    const badOrder = de.EXPORT_PARTS.flatMap((p) =>
      p.tables.flatMap((t) => t.order.filter((c) => !tables.get(t.table)?.has(c)).map((c) => `${t.table}.${c}`)),
    );
    check("並びに使う列は表に実在する", badOrder, []);
    check("練習ログの明細は単独の種類", de.EXPORT_PARTS.find((p) => p.id === "fights").tables.map((t) => t.table), ["fflogs_fights"]);
  }

  console.log("2. 純関数");
  {
    for (const k of ["fflogs_session_cookie", "fflogs_oauth_state", "discord_bot_token", "SOME_SECRET", "admin_password"]) {
      check(`秘密になり得るキー: ${k}`, de.isSensitiveSettingKey(k), true);
    }
    for (const k of ["schedule_url", "native_schedule_discord_notify_channel_id", "cron_status:fflogs-sync", "loot_window_weeks"]) {
      check(`書き出すキー: ${k}`, de.isSensitiveSettingKey(k), false);
    }
    check("ファイル名", de.exportFileName("logs", "2026-10-01"), "raid-repository-logs-2026-10-01.json");
    check("種類の解決", de.findExportPart("loot")?.id, "loot");
    check("知らない種類は null", de.findExportPart("../secrets"), null);
    check("ページは 1000 行", de.EXPORT_PAGE_SIZE, 1000);
  }

  console.log("3. route の配線");
  {
    const src = readFileSync("src/app/api/admin/export/route.ts", "utf8");
    const iCross = src.indexOf('req.headers.get("sec-fetch-site") === "cross-site"');
    const iAuth = src.indexOf("await assertAdminResult()");
    const iPart = src.indexOf("findExportPart(req.nextUrl.searchParams.get(\"part\"))");
    const iStream = src.indexOf("new ReadableStream");
    check("別サイト拒否 → admin 判定 → 種類の検査 → 流す の順", iCross > 0 && iAuth > iCross && iPart > iAuth && iStream > iPart, true);
    check("admin でなければ 403", /if \(!auth\.ok\) \{\s*return NextResponse\.json\(\{ error: "admin role required" \}, \{ status: 403 \}\);/.test(src), true);
    check("service role で読む", /createSupabaseServiceRoleClient\(\)/.test(src), true);
    check("ページ送り (range)", /q\.range\(from, from \+ EXPORT_PAGE_SIZE - 1\)/.test(src), true);
    check("並びを付ける (ページの取りこぼし防止)", /for \(const col of t\.order\) q = q\.order\(col/.test(src), true);
    check("秘密のキーを除く", /t\.table === "app_settings" && isSensitiveSettingKey\(String\(row\.key \?\? ""\)\)/.test(src), true);
    check("no-store", /"Cache-Control": "no-store"/.test(src), true);
    check("ダウンロード (attachment)", /"Content-Disposition": `attachment; filename="\$\{exportFileName\(/.test(src), true);
    check("途中の失敗は errors に入れて JSON を閉じる", /yield `\$\{inArray \? "\]" : ""\}\},"errors":\$\{JSON\.stringify\(errors\)\}\}`;/.test(src), true);
    // 2026-10-07 セキュリティ精査: 受け手が読んだら次のページを読む (backpressure)。
    check(
      "受け手が読んだ分だけ読む (pull で 1 塊ずつ・切断したら止める・start で全部読まない)",
      /async pull\(controller\) \{\s*const \{ value, done \} = await source\.next\(\);/.test(src) &&
        /async cancel\(\) \{[\s\S]{0,120}await source\.return\(undefined\);/.test(src) &&
        !/async start\(/.test(src),
      true,
    );
    const dialog = readFileSync("src/components/portal/settings-dialog.tsx", "utf8");
    check("設定ダイアログに節がある (初期化の直前)", /<DataExportSection canEdit=\{canEdit\} \/>\s*\{canEdit && \(\s*<DangerZoneSection/.test(dialog), true);
    const sec = readFileSync("src/components/portal/settings/data-export-section.tsx", "utf8");
    check("節は admin のみ", /if \(!canEdit\) return null;/.test(sec), true);
    check("全種類のリンクを出す", /EXPORT_PARTS\.map\(\(part\) =>/.test(sec) && /href=\{`\/api\/admin\/export\?part=\$\{part\.id\}`\}/.test(sec), true);
  }
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

if (failures > 0) {
  console.log(`\n${failures} 件失敗`);
  process.exit(1);
}
console.log("\nすべて ok");
