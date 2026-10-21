/**
 * safeFetch が Brotli を展開しないことの検証 (2026-10-21、src/lib/server/refuse-brotli.ts)。
 * 実行: `node scripts/check-refuse-brotli.mjs`
 *
 *   1. br を返す手元のサーバーに、本物の undici の fetch と refuseBrotliInterceptor を
 *      向け、展開する前に断れること (zlib.createBrotliDecompress が呼ばれない) を見る
 *   2. 対照: interceptor 無しの Agent では、同じ応答が展開される
 *      (= サーバーと数え方が効いていて、1 が空振りしていない)
 *   3. gzip・無圧縮・HEAD・304 は断らない / Accept-Encoding は br を求めない
 *   4. 配線: safeAgent が interceptor を組み込み、safeFetch が withSafeAcceptEncoding を通す
 *
 * safeFetch そのものは 127.0.0.1 への接続を断るので手元のサーバーに向けられない。
 * そのため 1〜3 は interceptor を直接使い、safeFetch へのつなぎ方は 4 で見る。
 *
 * ⚠ tsc は `process.execPath` + `node_modules/typescript/bin/tsc` で起動する
 *   (`npx` 経由は Windows で ENOENT / EINVAL になる)。
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import zlib from "node:zlib";
import { Agent, fetch } from "undici";

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
const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

// undici の fetch は zlib.createBrotliDecompress をその都度モジュールから引くので、
// 差し替えて「Brotli の展開処理が作られた回数」を数える。Node 24 では代入できない
// (writable: false) が configurable なので defineProperty で差し替え、最後に戻す。
let brotliDecoders = 0;
const originalDescriptor = Object.getOwnPropertyDescriptor(zlib, "createBrotliDecompress");
const originalCreateBrotliDecompress = zlib.createBrotliDecompress;
Object.defineProperty(zlib, "createBrotliDecompress", {
  ...originalDescriptor,
  value: (...args) => {
    brotliDecoders += 1;
    return originalCreateBrotliDecompress(...args);
  },
});

const TEXT = "<html><head><title>brotli</title></head></html>";
const brBody = zlib.brotliCompressSync(TEXT);
const gzipBody = zlib.gzipSync(TEXT);
const seenAcceptEncoding = [];

const server = createServer((req, res) => {
  seenAcceptEncoding.push(req.headers["accept-encoding"] ?? null);
  const path = new URL(req.url, "http://localhost").pathname;
  const send = (status, encoding, body) => {
    res.writeHead(status, {
      "content-type": "text/html",
      ...(encoding ? { "content-encoding": encoding } : {}),
    });
    res.end(req.method === "HEAD" || status === 304 ? undefined : body);
  };
  if (path === "/br") return send(200, "br", brBody);
  if (path === "/br-upper") return send(200, "BR", brBody);
  if (path === "/gzip-br") return send(200, "gzip, br", brBody);
  if (path === "/br-redirect") return send(302, "br", brBody);
  if (path === "/br-304") return send(304, "br", null);
  if (path === "/gzip") return send(200, "gzip", gzipBody);
  return send(200, null, TEXT);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;

const outDir = mkdtempSync(join(tmpdir(), "refuse-brotli-check-"));
const plainAgent = new Agent();
let guarded = null;
try {
  execFileSync(
    process.execPath,
    [
      "node_modules/typescript/bin/tsc",
      "src/lib/server/refuse-brotli.ts",
      "--outDir", outDir,
      "--target", "es2022",
      "--module", "es2022",
      "--moduleResolution", "bundler",
      "--lib", "es2022,dom",
      "--strict",
      "--types", "node",
    ],
    { stdio: "inherit" },
  );
  const m = await import(pathToFileURL(join(outDir, "refuse-brotli.js")).href);
  guarded = new Agent().compose(m.refuseBrotliInterceptor);

  /** 取得を試み、結果と「その間に作られた Brotli の展開処理の数」を返す。 */
  async function attempt(path, dispatcher, init = {}) {
    const before = brotliDecoders;
    try {
      const res = await fetch(base + path, {
        ...init,
        dispatcher,
        redirect: "manual",
        signal: AbortSignal.timeout(5000),
      });
      const text = init.method === "HEAD" || res.status === 304 ? "" : await res.text();
      return { ok: true, status: res.status, text, decoders: brotliDecoders - before };
    } catch (e) {
      return { ok: false, cause: e?.cause?.name ?? e?.name, decoders: brotliDecoders - before };
    }
  }

  console.log("[対照: interceptor 無しの Agent は br を展開する]");
  const control = await attempt("/br", plainAgent);
  check(
    "interceptor 無し: br を展開して本文を返す (展開処理 1 回)",
    [control.ok, control.text, control.decoders],
    [true, TEXT, 1],
  );

  console.log("\n[br の応答は展開する前に断る]");
  for (const path of ["/br", "/br-upper", "/gzip-br", "/br-redirect"]) {
    const r = await attempt(path, guarded);
    check(
      `${path}: BrotliRefusedError で失敗し、展開処理を作らない`,
      [r.ok, r.cause, r.decoders],
      [false, "BrotliRefusedError", 0],
    );
  }

  console.log("\n[br 以外と、本文を展開しない応答は断らない]");
  const gzip = await attempt("/gzip", guarded);
  check("gzip: 展開して本文を返す", [gzip.ok, gzip.text, gzip.decoders], [true, TEXT, 0]);
  const plain = await attempt("/plain", guarded);
  check("無圧縮: そのまま返す", [plain.ok, plain.text], [true, TEXT]);
  const head = await attempt("/br", guarded, { method: "HEAD" });
  check("HEAD (本文を展開しない): br でも断らない", [head.ok, head.status, head.decoders], [true, 200, 0]);
  const notModified = await attempt("/br-304", guarded);
  check("304 (本文を展開しない): br でも断らない", [notModified.ok, notModified.status], [true, 304]);

  console.log("\n[Accept-Encoding は br を求めない]");
  seenAcceptEncoding.length = 0;
  const headers = m.withSafeAcceptEncoding({ "accept-encoding": "br, gzip", "x-check": "1" });
  await attempt("/plain", guarded, { headers });
  check("呼び出し側の br を上書きして gzip, deflate を送る", seenAcceptEncoding, ["gzip, deflate"]);
  check("ほかのヘッダはそのまま残す", headers.get("x-check"), "1");
  check("定数", m.SAFE_ACCEPT_ENCODING, "gzip, deflate");

  console.log("\n[hasBrotliCoding]");
  const cases = [
    [undefined, false],
    ["br", true],
    [" gzip , BR ", true],
    [["gzip", "br"], true],
    ["gzip", false],
    ["brotli", false],
    ["", false],
  ];
  for (const [value, expected] of cases) {
    check(`hasBrotliCoding(${JSON.stringify(value)})`, m.hasBrotliCoding(value), expected);
  }

  console.log("\n[配線]");
  const sf = read("src/lib/server/safe-fetch.ts");
  check("safeAgent が refuseBrotliInterceptor を組み込む", /\}\)\.compose\(refuseBrotliInterceptor\);/.test(sf), true);
  check(
    "safeFetch が br を求めない Accept-Encoding を付ける",
    /let headers: HeadersInit = withSafeAcceptEncoding\(init\.headers\);/.test(sf),
    true,
  );
  check(
    "safeFetch の取得は safeAgent を通し、ヘッダは呼び出し側の init より後で渡す",
    /\.\.\.\(init as UndiciRequestInit\),\s*redirect: "manual",\s*dispatcher: safeAgent,\s*headers: headers as UndiciRequestInit\["headers"\],/.test(sf),
    true,
  );
} finally {
  Object.defineProperty(zlib, "createBrotliDecompress", originalDescriptor);
  await Promise.allSettled([plainAgent.close(), guarded?.close()]);
  await new Promise((resolve) => server.close(resolve));
  rmSync(outDir, { recursive: true, force: true });
}

console.log("");
if (failures > 0) {
  console.error(`${failures} 件失敗`);
  process.exit(1);
}
console.log("すべて成功");
