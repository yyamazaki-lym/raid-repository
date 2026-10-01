/**
 * 1000 行上限で切らずに取り切る部品 (src/lib/fetch-all-pages.ts) の検証
 * (2026-10-01 監査 C-2)。
 * 実行: `node scripts/check-fetch-all-pages.mjs`
 *
 * PostgREST は 1 リクエスト 1000 行しか返さず、超えた分は黙って落ちる。
 * ここでは次を固定する:
 *
 *   1. `fetchAllPages` が 1000 行ちょうど / 超え / 失敗 / 安全弁の各境界で
 *      全行を返す (または失敗を返す)
 *   2. 監査で見つけた 3 箇所 (動画の再リンク候補 / 自前作成式のセッションと
 *      出欠 / 同期台帳) が、順序を付けてページを繰っている
 *
 * 2 は呼び出し側にしか書けない前提なので、ソースを読んで確かめる。
 * ⚠ docstring の言及に当たらないよう、`.from("<表>")` を起点に窓を切る。
 */
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  readdirSync,
  readFileSync,
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

/** PostgREST の振る舞いの偽物: 要求範囲を返すが 1 回 1000 行まで。 */
function fakeTable(total, { failAtFrom = null, cap = 1000 } = {}) {
  const calls = [];
  const fetchPage = async (from, to) => {
    calls.push([from, to]);
    if (failAtFrom !== null && from === failAtFrom) {
      return { data: null, error: { message: "boom" } };
    }
    const end = Math.min(to + 1, total, from + cap);
    const data = [];
    for (let i = from; i < end; i += 1) data.push(i);
    return { data, error: null };
  };
  return { fetchPage, calls };
}

const outDir = mkdtempSync(join(tmpdir(), "fetch-all-pages-check-"));
try {
  execFileSync(
    process.execPath,
    [
      "node_modules/typescript/bin/tsc",
      "src/lib/fetch-all-pages.ts",
      "--outDir", outDir,
      "--target", "es2022",
      "--module", "es2022",
      "--moduleResolution", "bundler",
      "--strict",
    ],
    { stdio: "inherit" },
  );
  for (const f of readdirSync(outDir)) {
    if (!f.endsWith(".js")) continue;
    const fp = join(outDir, f);
    writeFileSync(
      fp,
      readFileSync(fp, "utf8").replace(
        /(from\s+["'])(\.\.?\/[^"']+?)(?<!\.js)(["'])/g,
        "$1$2.js$3",
      ),
    );
  }
  const { fetchAllPages, chunk, PAGE_ROWS } = await import(
    pathToFileURL(join(outDir, "fetch-all-pages.js")).href
  );

  console.log("fetchAllPages");
  check("1 ページの行数は PostgREST の既定と同じ 1000", PAGE_ROWS, 1000);
  for (const total of [0, 1, 999, 1000, 1001, 2500, 3000]) {
    const { fetchPage, calls } = fakeTable(total);
    const r = await fetchAllPages(fetchPage);
    check(
      `${total} 行 → 全行・重複なし`,
      [r.rows.length, new Set(r.rows).size, r.error, r.truncated],
      [total, total, null, false],
    );
    // ちょうど割り切れるときは「空のページ」を 1 回見て止まる。
    check(
      `${total} 行 → ${Math.floor(total / 1000) + 1} 回で止まる`,
      calls.length,
      Math.floor(total / 1000) + 1,
    );
  }
  {
    const { fetchPage } = fakeTable(2500, { failAtFrom: 1000 });
    const r = await fetchAllPages(fetchPage);
    check("2 ページ目で失敗 → error を返す", r.error?.message ?? null, "boom");
    check("  └ それまでの行は部分結果として返す", r.rows.length, 1000);
  }
  {
    const { fetchPage, calls } = fakeTable(10_000);
    const r = await fetchAllPages(fetchPage, 2500);
    check("安全弁で打ち切り → truncated", [r.rows.length, r.truncated], [2500, true]);
    check("  └ 最後のページは安全弁までしか要求しない", calls.at(-1), [2000, 2499]);
  }

  console.log("chunk");
  check("450 件を 200 ずつ", chunk([...Array(450).keys()]).map((c) => c.length), [200, 200, 50]);
  check("0 件 → 空", chunk([]), []);
  let threw = false;
  try {
    chunk([1], 0);
  } catch {
    threw = true;
  }
  check("サイズ 0 は投げる", threw, true);

  console.log("構造 (呼び出し側)");
  const window = (file, marker, size = 700) => {
    const src = readFileSync(file, "utf8");
    const at = src.indexOf(marker);
    return at < 0 ? "" : src.slice(Math.max(0, at - 200), at + size);
  };
  const paged = (w) =>
    /fetchAllPages\(/.test(w) && /\.order\(/.test(w) && /\.range\(from, to\)/.test(w);

  const videos = window(
    "src/lib/server/fflogs.ts",
    '"id, title, posted_at, created_at, logs_url, category:categories(id, name, fflogs_match_keywords)"',
  );
  check("動画の再リンク候補: 順序付きでページを繰る", paged(videos), true);
  check("  └ 順序は id (一意)", /\.order\("id"/.test(videos), true);

  const ledger = window(
    "src/lib/server/fflogs-fights.ts",
    '"report_code, ok, synced_at, session_date, category_id, zone_name, reason"',
  );
  check("同期台帳: 順序付きでページを繰る", paged(ledger), true);
  check("  └ 順序は report_code (主キー)", /\.order\("report_code"/.test(ledger), true);

  const sessions = window("src/lib/schedule/native-fetch.ts", '.from("native_schedule_sessions")');
  check("自前作成式のセッション: 順序付きでページを繰る", paged(sessions), true);
  check(
    "  └ 第 2 キー id で順序を一意にする",
    /\.order\("parsed_date"[^)]*\)\s*\.order\("id"/.test(sessions),
    true,
  );

  const attendances = window("src/lib/schedule/native-fetch.ts", '.from("native_schedule_attendances")');
  check("自前作成式の出欠: 順序付きでページを繰る", paged(attendances), true);
  check(
    "  └ 主キー (session_id, discord_user_id) 順",
    /\.order\("session_id"[^)]*\)\s*\.order\("discord_user_id"/.test(attendances),
    true,
  );
  check("  └ .in() に渡す ID を塊に割る", /chunk\(sessionRows\.map/.test(readFileSync("src/lib/schedule/native-fetch.ts", "utf8")), true);
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

if (failures > 0) {
  console.log(`\n${failures} 件失敗`);
  process.exit(1);
}
console.log("\nすべて ok");
