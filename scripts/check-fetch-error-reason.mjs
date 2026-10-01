/**
 * `fetch` の失敗理由に秘密を載せない (2026-10-01 監査の要確認項目の確定)。
 * 実行: `node scripts/check-fetch-error-reason.mjs`
 *
 *   1. `fetchErrorReason` (src/lib/fetch-error-reason.ts) は例外のメッセージを
 *      使わない。**実際に不正なヘッダで fetch を投げさせ** (送信前に例外に
 *      なるのでネットワークには出ない)、値が理由に載らないことを確かめる
 *   2. FFLogs の session cookie を載せる取得 2 本の catch が、`e.message` /
 *      `String(e)` ではなく `fetchErrorReason(e)` を使う
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

const outDir = mkdtempSync(join(tmpdir(), "fetch-error-reason-check-"));
try {
  execFileSync(
    process.execPath,
    [
      "node_modules/typescript/bin/tsc",
      "src/lib/fetch-error-reason.ts",
      "--outDir", outDir,
      "--target", "es2022",
      "--module", "es2022",
      "--moduleResolution", "bundler",
      "--strict",
    ],
    { stdio: "inherit" },
  );
  const { fetchErrorReason } = await import(
    pathToFileURL(join(outDir, "fetch-error-reason.js")).href
  );

  console.log("1. 理由に秘密を載せない");
  for (const [label, cookie] of [
    ["改行入り", "session=SECRETVALUE\nx"],
    ["NUL 入り", "session=SECRET\u0000VALUE"],
  ]) {
    let reason = null;
    let rawMessage = "";
    try {
      await fetch("http://127.0.0.1:9/", { headers: { cookie } });
    } catch (e) {
      rawMessage = String(e?.message ?? "");
      reason = fetchErrorReason(e);
    }
    check(`${label}: 生のメッセージには値が載る (前提の確認)`, /SECRET/.test(rawMessage), true);
    check(`${label}: 理由には載らない`, reason, "invalid request header");
  }
  const timeout = new Error("The operation was aborted due to timeout");
  timeout.name = "TimeoutError";
  check("timeout", fetchErrorReason(timeout), "timeout");
  const abort = new Error("aborted");
  abort.name = "AbortError";
  check("abort", fetchErrorReason(abort), "aborted");
  const net = new TypeError("fetch failed");
  net.cause = { code: "ECONNRESET", message: "socket hang up SECRET" };
  check("ネットワーク層のコードだけ載せる", fetchErrorReason(net), "fetch failed (ECONNRESET)");
  const weird = new TypeError("fetch failed");
  weird.cause = { code: "x; Cookie: SECRET" };
  check("コードの形でなければ載せない", fetchErrorReason(weird), "fetch failed");
  check("Error でないものは fetch failed", fetchErrorReason("session=SECRET"), "fetch failed");
  check("任意のメッセージは載せない", fetchErrorReason(new Error("session=SECRET")), "fetch failed");

  console.log("2. cookie を載せる取得の catch");
  const cases = [
    ["src/lib/server/fflogs-fights.ts", "async function fetchFightsJsonDirect("],
    ["src/lib/server/fflogs.ts", "async function fetchScrapePageDirect("],
  ];
  for (const [file, fn] of cases) {
    // Windows の作業ツリー (core.autocrlf) では CRLF になるので揃える。
    const src = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
    const at = src.indexOf(fn);
    const body = src.slice(at, src.indexOf("\n}\n", at));
    check(`${file}: ${fn} がある`, at > 0, true);
    check(`${file}: cookie を載せている (検査の前提)`, /sessionCookie/.test(body), true);
    // コメント (「e.message を使わない」の説明) は除いて調べる。
    const catchBody = body
      .slice(body.lastIndexOf("} catch (e) {"))
      .replace(/\/\/[^\n]*/g, "");
    check(`${file}: catch は fetchErrorReason(e)`, /fetchErrorReason\(e\)/.test(catchBody), true);
    check(`${file}: catch で e.message / String(e) を使わない`, /e\.message|String\(e\)/.test(catchBody), false);
  }
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

if (failures > 0) {
  console.log(`\n${failures} 件失敗`);
  process.exit(1);
}
console.log("\nすべて ok");
