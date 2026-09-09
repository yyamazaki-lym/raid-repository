/**
 * 出席実績の読み取りが上限で切れないことの検証 (2026-09-09)。
 * 実行: `node scripts/check-attendance-actuals-paging.mjs`
 *
 * ## なぜ要るのか
 *
 * PostgREST は **既定で 1000 行**を上限にする (`.limit()` を足しても超えられ
 * ない。実測は `src/lib/supabase/fflogs-fights.ts` の PAGE_SIZE コメント)。
 * `fflogs_attendance_actuals` は「レポート × メンバー」なので 1 レポート
 * 8 行前後 = **125 レポートで上限に達する**。2026-09-09 まで、この読み取りは
 *
 *   .in("report_code", codes.slice(0, 300))
 *
 * と書かれていて、(a) 301 本目以降のレポートが黙って落ち、(b) 300 本渡せても
 * 行数が 1000 を超えて途中で切れる、の二重の切り捨てになっていた。
 * 切れた行は「その人はその日に来ていない」として集計されるので、
 * **画面はエラーを出さずに出席を間違える**。
 *
 * 同じクラスの穴は #328 (明細が 1000 件で頭打ち) で一度直しており、別経路に
 * 残っていたのがこれ。上限の扱いは実行時にしか現れず tsc も lint も通るので、
 * ここで構造として固定する。
 *
 * ## 何を見るか
 *
 * 偽の取得関数 (塊と窓を受けてページを返すだけ) を渡し、
 *   1. `CODES_PER_QUERY` を超えるレポート数でも全件返るか
 *   2. 1 塊の行数が 1000 を超えてもページングで全件返るか
 *   3. `range()` に順序が付いているか (順序なしのページングは重複し得る)
 *   4. 読み取りエラーを「0 行」に化けさせず error として返すか
 * を見る。DB は要らない (共有 DB を汚さずに走る)。
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

/**
 * 偽の取得関数。`rowsFor(codes)` が「その塊に対する全行」を返し、
 * `from`/`to` の窓で切って渡す (PostgREST と同じ振る舞い)。呼び出しの記録も
 * 残して、塊の大きさとページの繰り方を見る。
 */
function fakeFetch({ rowsFor, failOnCall = -1 }) {
  const calls = [];
  const fetchPage = async ({ codes, from, to }) => {
    calls.push({ codes: codes.length, from, to });
    if (calls.length === failOnCall) {
      return { rows: null, error: { message: "boom" } };
    }
    return { rows: rowsFor(codes).slice(from, to + 1), error: null };
  };
  return { fetchPage, calls };
}

/**
 * 呼び出し側 (`server/attendance-summary-actions.ts`) が `range()` に順序を
 * 付けているかを**コードを見て**確かめる。ページングの制御は純モジュール側に
 * あるが、順序はクエリを組む側にしか書けないため、ここは構造検査で固定する。
 */
function checkCallerHasOrder() {
  const src = readFileSync(
    "src/lib/server/attendance-summary-actions.ts",
    "utf8",
  );
  // ⚠ docstring 内の言及ではなく **クエリ本体**を探す (最初の出現は説明文)。
  const i = src.indexOf('.from("fflogs_attendance_actuals")');
  const block = i < 0 ? "" : src.slice(i, i + 700);
  check("呼び出し側が report_code で order している", /\.order\("report_code"/.test(block), true);
  check("呼び出し側が discord_user_id で order している", /\.order\("discord_user_id"/.test(block), true);
  check("呼び出し側が range を使っている", /\.range\(/.test(block), true);
  check(
    "slice(0, 300) のような固定上限が復活していない",
    /codes\.slice\(0,\s*\d+\)/.test(src),
    false,
  );
}

const outDir = mkdtempSync(join(tmpdir(), "actuals-check-"));
try {
  execFileSync(
    process.execPath,
    [
      "node_modules/typescript/bin/tsc",
      "src/lib/schedule/attendance-actuals-paging.ts",
      "--outDir",
      outDir,
      "--target",
      "es2022",
      "--module",
      "es2022",
      "--moduleResolution",
      "bundler",
      "--skipLibCheck",
    ],
    { stdio: "inherit" },
  );
  // `@/` の相対化と拡張子付与 + server-only / supabase の stub
  // (他の検査スクリプトと同じ手当て)。
  const fix = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        fix(p);
        continue;
      }
      if (!name.endsWith(".js")) continue;
      let src = readFileSync(p, "utf8")
        .replace(/^import "server-only";$/m, "")
        .replace(/^import .*@\/lib\/supabase\/server.*$/m, "")
        .replace(/^import .*@\/lib\/schedule\/attendance-actuals.*$/m, "")
        .replace(/from "(\.\.?\/[^"]+)"/g, (mm, spec) =>
          spec.endsWith(".js") ? mm : `from "${spec}.js"`,
        );
      writeFileSync(p, src);
    }
  };
  fix(outDir);

  const m = await import(
    pathToFileURL(join(outDir, "attendance-actuals-paging.js")).href
  );

  // 1. レポート数が 1 塊 (100) を超えても全件返る
  const codes250 = Array.from({ length: 250 }, (_, i) => `R${i}`);
  const one = (chunk) =>
    chunk.map((c) => ({ report_code: c, discord_user_id: "u1", pulls: 1 }));
  const r1 = await m.fetchAttendanceActualsByReports(
    fakeFetch({ rowsFor: one }).fetchPage,
    codes250,
  );
  console.log("\n[レポート数が塊を超える]");
  check("250 レポートが全部返る", r1.rows.length, 250);
  check("error は null", r1.error, null);

  // 2. 1 塊の行数が 1000 を超えてもページングで全件返る
  //    (100 レポート x 15 メンバー = 1500 行)
  const many = (chunk) =>
    chunk.flatMap((c) =>
      Array.from({ length: 15 }, (_, k) => ({
        report_code: c,
        discord_user_id: `u${k}`,
        pulls: k,
      })),
    );
  const db2 = fakeFetch({ rowsFor: many });
  const r2 = await m.fetchAttendanceActualsByReports(db2.fetchPage, codes250);
  console.log("\n[1 塊が 1000 行を超える]");
  check("250 x 15 = 3750 行が全部返る", r2.rows.length, 3750);
  check(
    "取りこぼしなし (report_code の異なり数)",
    new Set(r2.rows.map((r) => r.report_code)).size,
    250,
  );
  check("重複なし", new Set(r2.rows.map((r) => r.report_code + r.discord_user_id)).size, 3750);

  // 3. ページングの前提 (塊の大きさ / 窓の進み方 / 呼び出し側の順序指定)
  console.log("\n[ページングの前提]");
  check(
    "1 塊あたり 100 レポートまで",
    Math.max(...db2.calls.map((c) => c.codes)),
    100,
  );
  check(
    "窓は 1000 行ずつ進む",
    [...new Set(db2.calls.map((c) => c.to - c.from + 1))],
    [1000],
  );
  checkCallerHasOrder();

  // 4. 読み取りエラーは 0 行に化けさせない
  console.log("\n[エラーの扱い]");
  const r4 = await m.fetchAttendanceActualsByReports(
    fakeFetch({ rowsFor: one, failOnCall: 1 }).fetchPage,
    codes250,
  );
  check("error を返す", r4.error, { message: "boom" });

  // 5. レポートが 0 件なら DB を叩かない
  const db5 = fakeFetch({ rowsFor: one });
  const r5 = await m.fetchAttendanceActualsByReports(db5.fetchPage, []);
  check("0 件なら問い合わせ 0 回", [db5.calls.length, r5.rows.length], [0, 0]);
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
