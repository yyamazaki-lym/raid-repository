/**
 * Discord 取り込みの時間予算・新規 URL 上限・共有 limiter (2026-10-01 監査
 * C-6) と、Discord 429 の 1 回だけの再試行 (C-9) の検査。
 * 実行: `node scripts/check-discord-import-budget.mjs`
 *
 *   1. 純関数 (src/lib/discord-import-budget.ts / discord-rate-limit.ts) の
 *      境界: 新しい方を残す上限、締切ちょうど、limiter の同時数と失敗の扱い、
 *      retry_after の読み取りと再試行の可否、バケット残り 0 の待ち、
 *      自動処理の記録に載せる成否と理由 (次回へ回した件数・持ち時間切れ)
 *   2. 締切 220s が maxDuration 300s に対して余裕を持つこと (根拠の数字)
 *   3. 呼び出し側の配線 (ソースを読んで確かめる):
 *      - 取り込みはページ取得の前と enrichment の前で締切を見る
 *      - enrichment は takeNewest で上限を掛け、共有 limiter を通す
 *      - Discord への fetch は 4 本とも discordFetch 経由 (429 再試行)
 *      - cron route は自分の開始時刻から締切を数えて渡し、記録の成否と
 *        理由は summarizeDiscordImportRun で作る
 *      - ギルドのロール取得に timeout がある
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

const outDir = mkdtempSync(join(tmpdir(), "discord-import-budget-check-"));
try {
  execFileSync(
    process.execPath,
    [
      "node_modules/typescript/bin/tsc",
      "src/lib/discord-import-budget.ts",
      "src/lib/discord-rate-limit.ts",
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
  const budget = await import(
    pathToFileURL(join(outDir, "discord-import-budget.js")).href
  );
  const rl = await import(
    pathToFileURL(join(outDir, "discord-rate-limit.js")).href
  );

  console.log("takeNewest (新しい方を残す)");
  const urls = Array.from({ length: 7 }, (_, i) => `u${i}`); // u0 が最古
  check("上限以下はそのまま", budget.takeNewest(urls, 7), { kept: urls, deferred: 0 });
  check("超えたら新しい方 3 件 (古い順のまま)", budget.takeNewest(urls, 3), {
    kept: ["u4", "u5", "u6"],
    deferred: 4,
  });
  check("上限 0 は全部持ち越し", budget.takeNewest(urls, 0), { kept: [], deferred: 7 });
  check("負の上限も 0 扱い", budget.takeNewest(urls, -2), { kept: [], deferred: 7 });
  check("空配列", budget.takeNewest([], 50), { kept: [], deferred: 0 });
  check("元の配列を書き換えない", urls.length, 7);

  console.log("isPastDeadline");
  check("手前", budget.isPastDeadline(1000, 999), false);
  check("ちょうどは過ぎた扱い", budget.isPastDeadline(1000, 1000), true);
  check("過ぎた", budget.isPastDeadline(1000, 1001), true);
  check("NaN の now は過ぎた扱い (安全側)", budget.isPastDeadline(1000, Number.NaN), true);

  console.log("createLimiter");
  {
    const limit = budget.createLimiter(2);
    let active = 0;
    let peak = 0;
    const order = [];
    const release = [];
    const tasks = [0, 1, 2, 3, 4].map((i) =>
      limit(async () => {
        active += 1;
        peak = Math.max(peak, active);
        order.push(i);
        await new Promise((r) => release.push(r));
        active -= 1;
        if (i === 1) throw new Error("boom");
        return i;
      }),
    );
    // 失敗する呼び出しに先に受け手を付けておく (未処理の reject で落ちない)
    const all = Promise.allSettled(tasks);
    // 少しずつ解放して、常に 2 件までしか走らないことを見る
    for (let k = 0; k < 5; k++) {
      await new Promise((r) => setTimeout(r, 5));
      release.shift()?.();
    }
    const settled = await all;
    check("同時数は 2 まで", peak, 2);
    check("渡した順に始まる", order, [0, 1, 2, 3, 4]);
    check(
      "失敗はその呼び出しにだけ返り、後続は走る",
      settled.map((s) => s.status),
      ["fulfilled", "rejected", "fulfilled", "fulfilled", "fulfilled"],
    );
    check(
      "値はそれぞれに返る",
      settled.filter((s) => s.status === "fulfilled").map((s) => s.value),
      [0, 2, 3, 4],
    );
  }
  {
    const limit = budget.createLimiter(0);
    check("同時数 0 は 1 扱い (止まらない)", await limit(async () => "ran"), "ran");
    const sync = await limit(() => {
      throw new Error("sync");
    }).then(
      () => "resolved",
      (e) => e.message,
    );
    check("同期で投げた失敗も Promise の失敗になる", sync, "sync");
  }

  console.log("予算の根拠");
  check("締切は 220 秒", budget.DISCORD_IMPORT_BUDGET_MS, 220_000);
  check("1 チャンネル新規 URL 上限 50", budget.DISCORD_IMPORT_MAX_NEW_URLS_PER_CHANNEL, 50);
  check("共有の同時数 8", budget.DISCORD_IMPORT_ENRICH_CONCURRENCY, 8);
  {
    // 締切直前に始まった処理の最長: ページ 15s + 429 待ち + 再送 15s、
    // または enrichment 1 件 ~32s。どちらでも 300s から 30s 以上残る。
    const page = 15_000 + rl.DISCORD_RETRY_MAX_WAIT_MS + 15_000;
    const enrich = 32_000;
    const worst = budget.DISCORD_IMPORT_BUDGET_MS + Math.max(page, enrich);
    check("締切直後の最長処理を足しても 270s 以内", worst <= 270_000, true);
  }

  console.log("retryAfterMsFrom429");
  check("本文の retry_after (小数秒) を ms に切り上げ", rl.retryAfterMsFrom429(1.234, null), 1234);
  check("本文を優先", rl.retryAfterMsFrom429(0.5, "9"), 500);
  check("本文が無ければヘッダ", rl.retryAfterMsFrom429(undefined, "2"), 2000);
  check("本文が文字列ならヘッダ", rl.retryAfterMsFrom429("3", "2"), 2000);
  check("負の値は読めない扱い", rl.retryAfterMsFrom429(-1, null), null);
  check("どちらも無ければ null", rl.retryAfterMsFrom429(null, null), null);
  check("ヘッダが空白だけなら null", rl.retryAfterMsFrom429(null, "  "), null);
  check("ヘッダが日付形式なら null (Discord は秒で返す)", rl.retryAfterMsFrom429(null, "Wed, 21 Oct 2015 07:28:00 GMT"), null);
  check("0 秒は 0", rl.retryAfterMsFrom429(0, null), 0);

  console.log("shouldRetryAfter429");
  const MAX = rl.DISCORD_RETRY_MAX_WAIT_MS;
  check("上限は 10 秒", MAX, 10_000);
  check("読めないなら送り直さない", rl.shouldRetryAfter429(null, { maxWaitMs: MAX, remainingMs: 1e9 }), false);
  check("上限ちょうどは送り直す", rl.shouldRetryAfter429(MAX, { maxWaitMs: MAX, remainingMs: 1e9 }), true);
  check("上限超え (global 制限) は諦める", rl.shouldRetryAfter429(MAX + 1, { maxWaitMs: MAX, remainingMs: 1e9 }), false);
  check("待つと締切を越えるなら諦める", rl.shouldRetryAfter429(3000, { maxWaitMs: MAX, remainingMs: 3000 }), false);
  check("締切の手前で待ち終わるなら送り直す", rl.shouldRetryAfter429(3000, { maxWaitMs: MAX, remainingMs: 3001 }), true);
  check("締切なし (Infinity) なら送り直す", rl.shouldRetryAfter429(3000, { maxWaitMs: MAX, remainingMs: Infinity }), true);

  console.log("preemptiveWaitMs");
  const CAP = rl.DISCORD_PREEMPTIVE_WAIT_CAP_MS;
  check("残りがあれば待たない", rl.preemptiveWaitMs("3", "4.5", CAP), 0);
  check("残り 0 なら reset-after だけ待つ", rl.preemptiveWaitMs("0", "1.5", CAP), 1500);
  check("上限で頭打ち", rl.preemptiveWaitMs("0", "60", CAP), CAP);
  check("ヘッダが無ければ待たない", rl.preemptiveWaitMs(null, null, CAP), 0);
  check("reset-after が読めなければ待たない", rl.preemptiveWaitMs("0", "x", CAP), 0);

  console.log("summarizeDiscordImportRun (自動処理の記録)");
  const sum = budget.summarizeDiscordImportRun;
  const ch = (o) => ({ category: "c", kind: "video", ok: true, ...o });
  check("空なら ok・理由なし", sum([]), { outcome: "ok", reason: null });
  check("取り込みと停止中だけなら ok", sum([ch({ inserted: 3 }), ch({ skipped: "disabled" })]), { outcome: "ok", reason: null });
  check("deferred 0 は数えない", sum([ch({ deferred: 0 })]), { outcome: "ok", reason: null });
  check("次回へ回した件数は合計して一部", sum([ch({ deferred: 4 }), ch({ deferred: 8 })]), { outcome: "partial", reason: "deferred 12 new URL(s)" });
  check("持ち時間切れのチャンネルも一部", sum([ch({ skipped: "deadline" })]), { outcome: "partial", reason: "1 channel(s) stopped at the deadline" });
  check("件数と持ち時間切れを両方書く", sum([ch({ skipped: "deadline" }), ch({ skipped: "deadline", deferred: 5 })]), { outcome: "partial", reason: "deferred 5 new URL(s); 2 channel(s) stopped at the deadline" });
  check(
    "失敗は error で、最初の 1 つと次回へ回した件数",
    sum([
      ch({ deferred: 3 }),
      { category: "a", kind: "strategy", ok: false, reason: "discord api 403 (page 1)" },
      { category: "b", kind: "video", ok: false, reason: "x" },
    ]),
    { outcome: "error", reason: "2 channel(s) failed: a/strategy discord api 403 (page 1); deferred 3 new URL(s)" },
  );
  check("失敗の理由が無くても末尾に空白を残さない", sum([{ category: "a", kind: "video", ok: false }]), { outcome: "error", reason: "1 channel(s) failed: a/video" });

  console.log("呼び出し側: discord-import.ts");
  const imp = readFileSync("src/lib/server/discord-import.ts", "utf8");
  const loopAt = imp.indexOf("for (let page = 0; page < MAX_MESSAGE_PAGES; page++)");
  const loop = imp.slice(loopAt, imp.indexOf("messages = all;", loopAt));
  check("ページ取得の前に締切を見る", /for \(let page[^\n]*\n(?:\s*\/\/[^\n]*\n)*\s*if \(isPastDeadline\(ctx\.deadlineAt, Date\.now\(\)\)\)/.test(loop), true);
  check("1 ページ目で締切なら deadline で返す", /if \(page === 0\) \{\s*return \{ category: cat\.slug, kind, ok: true, skipped: "deadline" \};/.test(loop), true);
  check("メッセージ取得は discordFetch (429 再試行)", /const res = await discordFetch\(/.test(loop), true);
  check("メッセージ取得に締切を渡す", /deadlineAt: ctx\.deadlineAt,/.test(loop), true);
  check("取り込みに素の fetch( が残っていない", /[^.\w]fetch\(/.test(imp), false);
  check("バケット残り 0 で次ページ前に待つ", /preemptiveWaitMs\(\s*res\.headers\.get\("x-ratelimit-remaining"\)/.test(loop), true);
  check("新規 URL に上限を掛ける", /takeNewest\(\s*fresh,\s*DISCORD_IMPORT_MAX_NEW_URLS_PER_CHANNEL,?\s*\)/.test(imp), true);
  check("enrichment は上限後の kept だけ", /await pmap\(kept, FETCH_CONCURRENCY,/.test(imp), true);
  check("enrichment は共有 limiter を通す", /ctx\.limit\(async \(\) => \{\s*if \(isPastDeadline\(ctx\.deadlineAt, Date\.now\(\)\)\) return null;/.test(imp), true);
  check("fresh 全件の pmap が残っていない", /pmap\(fresh,/.test(imp), false);
  check("limiter は実行全体で 1 つ (runDiscordImport で作る)", (imp.match(/createLimiter\(/g) ?? []).length, 1);
  check("各チャンネルに ctx を渡す", (imp.match(/botToken,\s*ctx,\s*\)/g) ?? []).length, 2);
  check("返り値の 3 箇所に deferred", (imp.match(/^\s+deferred,$/gm) ?? []).length, 3);

  console.log("呼び出し側: 通知 3 本と route / ロール");
  for (const f of [
    "src/lib/server/native-schedule-discord.ts",
    "src/lib/server/attendance-reminder.ts",
    "src/lib/server/logs-notify.ts",
  ]) {
    const src = readFileSync(f, "utf8");
    check(`${f}: 投稿は discordFetch`, /const res = await discordFetch\(\s*`https:\/\/discord\.com\/api\/v10\/channels\/\$\{input\.channelId\}\/messages`/.test(src), true);
    check(`${f}: 素の fetch( が残っていない`, /[^.\w]fetch\(\s*`https:\/\/discord\.com/.test(src), false);
  }
  const route = readFileSync("src/app/api/cron/import-discord/route.ts", "utf8");
  check("route: 開始時刻を認証より前に取る", route.indexOf("const startedAt = Date.now();") > 0 && route.indexOf("const startedAt = Date.now();") < route.indexOf("assertCronAuth(req"), true);
  check("route: 開始時刻から締切を渡す", /runDiscordImport\(\{\s*deadlineAt: startedAt \+ DISCORD_IMPORT_BUDGET_MS,?\s*\}\)/.test(route), true);
  check("route: maxDuration は 300 のまま", /export const maxDuration = 300;/.test(route), true);
  check("route: 次回へ回した分を含めて記録する", /const run = summarizeDiscordImportRun\(result\.results\);\s*await recordCronRun\("import-discord", run\.outcome, run\.reason\);/.test(route), true);
  check("route: 成否を route で組み立て直していない", /recordCronRun\(\s*"import-discord",\s*failed/.test(route), false);
  const roles = readFileSync("src/lib/server/discord-roles.ts", "utf8");
  check("ロール取得に timeout", /signal: AbortSignal\.timeout\(10_000\)/.test(roles), true);
  check("ロール取得の失敗は空配列", /catch \(err\) \{\s*console\.warn\("\[discord-roles\] fetch error", String\(err\)\);\s*return \[\];/.test(roles), true);

  console.log("結果パネル");
  const panel = readFileSync("src/components/portal/maintenance/discord-panel.tsx", "utf8");
  check("持ち時間切れを出す", /it\.skipped === "deadline"\) return t\.discordDeadline\(/.test(panel), true);
  check("残りは次回を書き添える", /deferred > 0 \? base \+ t\.discordDeferred\(deferred\) : base/.test(panel), true);
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

if (failures > 0) {
  console.log(`\n${failures} 件失敗`);
  process.exit(1);
}
console.log("\nすべて ok");
