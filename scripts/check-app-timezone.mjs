/**
 * アプリの基準タイムゾーンの一本化 (2026-10-01 監査 U-9) と、時刻まわりの
 * 修正 (U-11 / U-12 / U-13 / U-14) の検査。
 * 実行: `node scripts/check-app-timezone.mjs`
 *
 *   1. `src/lib/app-timezone.ts` の 3 つの値が互いに一致し、DST の無い TZ
 *      であること (Intl で 1 年分のオフセットを測る)
 *   2. src のほかの場所で TZ を再定義していないこと (`9 * 60 * 60 * 1000` /
 *      `9 * HOUR_MS` / `"Asia/Tokyo"` / `+09:00` / `+0900`)。コメントは見ない
 *   3. U-11: 年なしタイトル日付の年ヒントに UTC 年を使っていない
 *      (`toJstYmd` / `jstCalendarDate` の境界も実行して確かめる)
 *   4. U-12: 診断表示の日付に `toISOString().slice(0, 10)` (UTC 暦日) を
 *      使っていない
 *   5. U-13: 閲覧端末の TZ に依存する表示 (`getFullYear` 等 /
 *      `toLocaleString` に timeZone なし) が無い
 *   6. U-14: 次回開催カード・予定表・過去チップは描画中に `Date.now()` を
 *      読まず、page が 1 回だけ読んだ時刻を `useHydrationSafeNow` で使う
 */
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
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

/** コメントを空白に置き換える (行番号は保つ)。`https://` の `//` は残す。 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (m, pre) => pre + " ".repeat(m.length - pre.length));
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const outDir = mkdtempSync(join(tmpdir(), "app-timezone-check-"));
try {
  execFileSync(
    process.execPath,
    [
      "node_modules/typescript/bin/tsc",
      "src/lib/app-timezone.ts",
      "src/lib/jst-date.ts",
      "src/lib/schedule/jst-cutoff.ts",
      "--outDir", outDir,
      "--rootDir", "src/lib",
      "--target", "es2022",
      "--module", "es2022",
      "--moduleResolution", "bundler",
      "--strict",
    ],
    { stdio: "inherit" },
  );
  for (const f of readdirSync(outDir, { recursive: true })) {
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
  const tz = await import(pathToFileURL(join(outDir, "app-timezone.js")).href);
  const jstDate = await import(pathToFileURL(join(outDir, "jst-date.js")).href);
  const cutoff = await import(
    pathToFileURL(join(outDir, "schedule", "jst-cutoff.js")).href
  );

  console.log("1. app-timezone.ts の値");
  {
    // Intl で各月 1 日の UTC からのずれを測る (DST があれば月によって変わる)
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz.APP_TIME_ZONE,
      hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit",
    });
    const offsets = new Set();
    for (let mo = 0; mo < 12; mo++) {
      const t = Date.UTC(2026, mo, 1, 12, 0);
      const p = Object.fromEntries(
        fmt.formatToParts(new Date(t)).map((x) => [x.type, x.value]),
      );
      const wall = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
      offsets.add(wall - t);
    }
    check("TZ のずれは 1 年を通して 1 種類 (DST なし)", offsets.size, 1);
    check("APP_UTC_OFFSET_MS が APP_TIME_ZONE と一致", [...offsets][0], tz.APP_UTC_OFFSET_MS);
    const sign = tz.APP_UTC_OFFSET_MS >= 0 ? "+" : "-";
    const abs = Math.abs(tz.APP_UTC_OFFSET_MS) / 60000;
    const iso = `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
    check("APP_UTC_OFFSET_ISO が APP_UTC_OFFSET_MS と一致", tz.APP_UTC_OFFSET_ISO, iso);
    check(
      "ISO 表記で解釈した時刻が ms と一致",
      Date.parse(`2026-01-01T00:00:00${tz.APP_UTC_OFFSET_ISO}`),
      Date.UTC(2026, 0, 1) - tz.APP_UTC_OFFSET_MS,
    );
    check(
      "英語表記 (+0900 形式) でも同じ時刻",
      // fflogs.ts の英語表記の解釈と同じ形 (時刻つき。V8 は日付だけ + "+0900" を読めない)
      Date.parse("January 1, 2026 00:00 " + tz.APP_UTC_OFFSET_ISO.replace(":", "")),
      Date.UTC(2026, 0, 1) - tz.APP_UTC_OFFSET_MS,
    );
  }

  console.log("2. ほかの場所で TZ を再定義していない");
  {
    const FORBIDDEN = [
      [/\b9\s*\*\s*60\s*\*\s*60\s*\*\s*1000\b/, "9 * 60 * 60 * 1000"],
      [/\b9\s*\*\s*HOUR_MS\w*/, "9 * HOUR_MS"],
      [/\b(?:32_?400_?000|32400000)\b/, "32400000"],
      [/["'`]Asia\/Tokyo["'`]/, '"Asia/Tokyo"'],
      [/\+09:?00/, "+09:00 / +0900"],
    ];
    const hits = [];
    for (const file of walk("src")) {
      const rel = relative(".", file).replace(/\\/g, "/");
      if (rel === "src/lib/app-timezone.ts") continue;
      const lines = stripComments(readFileSync(file, "utf8")).split("\n");
      lines.forEach((line, i) => {
        for (const [re, label] of FORBIDDEN) {
          if (re.test(line)) hits.push(`${rel}:${i + 1} ${label}`);
        }
      });
    }
    check("再定義 0 件 (src/lib/app-timezone.ts から import すること)", hits, []);
    // 検出の自己確認: コメント内は無視し、コード内は拾う
    {
      const sample = '// "Asia/Tokyo"\n/* 9 * 60 * 60 * 1000 */\nconst u = "https://x";';
      const stripped = stripComments(sample);
      check(
        "検出器: コメントは無視 (行数と URL は保つ)",
        [FORBIDDEN.some(([re]) => re.test(stripped)), stripped.split("\n").length, stripped.endsWith('const u = "https://x";')],
        [false, 3, true],
      );
    }
    check(
      "検出器: コードは拾う",
      FORBIDDEN.map(([re]) => re.test(stripComments('const a = 9 * 60 * 60 * 1000; const z = "Asia/Tokyo"; const s = "+09:00"; const h = 9 * HOUR_MS;'))),
      [true, true, false, true, true],
    );
  }

  console.log("3. U-11 年ヒントはアプリの TZ の年");
  {
    // 2025-12-31 15:30 UTC = 2026-01-01 00:30 JST
    const t = new Date(Date.UTC(2025, 11, 31, 15, 30));
    check("jstYmd: 元日 0:30 JST は 2026 年", jstDate.jstYmd(t).y, 2026);
    check("jstYmdString: 元日 0:30 JST", jstDate.jstYmdString(t), "2026-01-01");
    check("jstWeekday: 2026-01-01 は木曜 (4)", jstDate.jstWeekday(t), 4);
    const ca = readFileSync("src/lib/server/categories-actions.ts", "utf8");
    const ff = readFileSync("src/lib/server/fflogs.ts", "utf8");
    check("categories-actions: 年ヒントに getUTCFullYear を使わない", /(?:fallbackYear|youtubeYear|existingYear)[\s\S]{0,160}?getUTCFullYear\(\)/.test(ca), false);
    // 2026-10-08: 一覧カードの集計 (fetchTimeToClearByCategory) は category-aggregates.ts へ移した。
    const agg = readFileSync("src/lib/server/category-aggregates.ts", "utf8");
    check("categories-actions + category-aggregates: 年ヒントに getUTCFullYear を使わない", /(?:fallbackYear|youtubeYear|existingYear)[\s\S]{0,160}?getUTCFullYear\(\)/.test(agg), false);
    check("categories-actions + category-aggregates: 年ヒントは toJstYmd の年 (3 箇所 + resolvePostedAt 2 つ)", ((ca + agg).match(/toJstYmd\(\s*new Date\([^)]*\)\.getTime\(\),?\s*\)\.y/g) ?? []).length, 4);
    check("fflogs: 年ヒントは jstCalendarDate の年", /const fallbackYear = jstCalendarDate\(postedTMs \?\? Date\.now\(\)\)\.y;/.test(ff), true);
    check("fflogs: 年ヒントに getUTCFullYear を使わない", /fallbackYear[\s\S]{0,160}?getUTCFullYear\(\)/.test(ff), false);
  }

  console.log("4. U-12 診断表示の日付");
  {
    const ff = readFileSync("src/lib/server/fflogs.ts", "utf8");
    check("fflogs: toISOString().slice(0, 10) (UTC 暦日) を使わない", /toISOString\(\)\.slice\(0,\s*10\)/.test(ff), false);
    check("fflogs: レポート見本の日付は jstYmdString", /date: jstYmdString\(new Date\(r\.startMs\)\),/.test(ff), true);
    check("fflogs: 動画の posted_at 日付は jstYmdString", /\? jstYmdString\(new Date\(pair\.video\.tMs\)\) \+/.test(ff), true);
  }

  console.log("5. U-13 閲覧端末の TZ に依存しない");
  {
    const fc = readFileSync("src/components/portal/maintenance/first-clear-panel.tsx", "utf8");
    const at = fc.indexOf("function formatLong(");
    const body = fc.slice(at, fc.indexOf("\n}\n", at));
    check("first-clear: formatLong がある", at > 0, true);
    check("first-clear: getFullYear / getMonth / getDate / getDay を使わない", /\.get(FullYear|Month|Date|Day)\(\)/.test(body), false);
    check("first-clear: JST の暦日と曜日で出す", /jstWeekday\(d\)/.test(body) && /jstYmdString\(d\)/.test(body), true);
    const fs = readFileSync("src/components/portal/settings/fflogs-sync-section.tsx", "utf8");
    check("fflogs-sync: 期限は jstDateTimeString", /jstDateTimeString\(new Date\(oauthStatus\.expiresAt\)\)/.test(fs), true);
    // 日時の toLocale*String は timeZone を必ず渡す。数値の toLocaleString
    // (桁区切り) は対象外: toLocaleString は同じ行に `Date(` があるときだけ見る。
    const noTz = [];
    for (const file of walk("src")) {
      const src = stripComments(readFileSync(file, "utf8"));
      for (const m of src.matchAll(/\.toLocale(String|DateString|TimeString)\(/g)) {
        const lineStart = src.lastIndexOf("\n", m.index) + 1;
        const receiver = src.slice(lineStart, m.index);
        if (m[1] === "String" && !/Date\(/.test(receiver)) continue;
        // 対応する閉じ括弧までを引数として読む
        let depth = 0;
        let end = m.index + m[0].length - 1;
        for (; end < src.length; end++) {
          if (src[end] === "(") depth += 1;
          else if (src[end] === ")" && --depth === 0) break;
        }
        const args = src.slice(m.index + m[0].length, end);
        if (!/timeZone/.test(args)) {
          const line = src.slice(0, m.index).split("\n").length;
          noTz.push(`${relative(".", file).replace(/\\/g, "/")}:${line}`);
        }
      }
    }
    check("日時の toLocale*String は timeZone つき", noTz, []);
    // 端末の TZ で暦日・時刻を読む getter (getFullYear / getMonth / getDate /
    // getDay / getHours / getMinutes) は使わない。例外は「年月日から作った
    // Date の曜日を読む」形 (`new Date(y, m, d).getDay()`) で、作るのも読む
    // のも同じ TZ なので、どの TZ でも正しい曜日になる。
    const localGetters = [];
    for (const file of walk("src")) {
      const lines = stripComments(readFileSync(file, "utf8")).split("\n");
      lines.forEach((line, i) => {
        for (const m of line.matchAll(/\.get(FullYear|Month|Date|Day|Hours|Minutes)\(\)/g)) {
          const before = line.slice(0, m.index);
          if (/new Date\([^()]*,[^()]*\)$/.test(before)) continue;
          localGetters.push(`${relative(".", file).replace(/\\/g, "/")}:${i + 1} ${m[0]}`);
        }
      });
    }
    check("端末の TZ で読む getter を使わない", localGetters, []);
  }

  console.log("6. U-14 描画中の Date.now() をやめる");
  {
    check("jstTodayStartMs(now): 元日 0:00 JST ちょうど", cutoff.jstTodayStartMs(Date.UTC(2025, 11, 31, 15, 0)), Date.UTC(2025, 11, 31, 15, 0));
    check("jstTodayStartMs(now): 23:59:59 JST は前日の 0:00", cutoff.jstTodayStartMs(Date.UTC(2025, 11, 31, 14, 59, 59)), Date.UTC(2025, 11, 30, 15, 0));
    check("jstTodayStartMs(): 引数なしは今", cutoff.jstTodayStartMs() <= Date.now() && Date.now() - cutoff.jstTodayStartMs() < 86_400_000, true);
    for (const f of [
      "src/components/portal/next-session-card.tsx",
      "src/components/portal/schedule-list.tsx",
      "src/components/portal/schedule-past-simple.tsx",
    ]) {
      const src = stripComments(readFileSync(f, "utf8"));
      check(`${f}: Date.now() を読まない`, /Date\.now\(\)/.test(src), false);
      check(`${f}: useHydrationSafeNow(renderedAtMs)`, /const nowMs = useHydrationSafeNow\(renderedAtMs\);/.test(src), true);
      check(`${f}: 引数なしの jstTodayStartMs() を呼ばない`, /jstTodayStartMs\(\)/.test(src), false);
    }
    const list = readFileSync("src/components/portal/schedule-list.tsx", "utf8");
    check("schedule-list: splitSessions に nowMs を渡す", /splitSessions\(sessions, limit, nowMs\)/.test(list), true);
    const body = readFileSync("src/components/portal/schedule-page-body.tsx", "utf8");
    check("schedule-page-body: 3 つの子に renderedAtMs を渡す", (body.match(/renderedAtMs=\{renderedAtMs\}/g) ?? []).length, 3);
    const page = readFileSync("src/app/(portal)/page.tsx", "utf8");
    check("page: 時刻は 1 回だけ読む", (stripComments(page).match(/Date\.now\(\)/g) ?? []).length, 1);
    check("page: 2 つの SchedulePageBody に渡す", (page.match(/renderedAtMs=\{renderedAtMs\}/g) ?? []).length, 2);
    const hook = readFileSync("src/lib/use-hydration-safe-now.ts", "utf8");
    check("hook: getServerSnapshot はサーバー描画の時刻", /useSyncExternalStore\(subscribe, getSnapshot, \(\) => serverNowMs\)/.test(hook), true);
  }
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

if (failures > 0) {
  console.log(`\n${failures} 件失敗`);
  process.exit(1);
}
console.log("\nすべて ok");
