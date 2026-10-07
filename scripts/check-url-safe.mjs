/**
 * URL の安全判定 (src/lib/url-safe.ts) と、外部取得まわりの配線の検証
 * (2026-10-07 セキュリティ精査)。
 * 実行: `node scripts/check-url-safe.mjs`
 *
 *   1. isBlockedIpLiteral: 内部・予約のアドレスを拒否し、公開アドレスは通す
 *      (2026-10-07 に予約帯を足した: 192.0.0.0/24・文書用 3 帯・198.18.0.0/15・
 *      IPv6 の site-local・マルチキャスト・Teredo・文書用・100::/64)
 *   2. isOptimizableImageHost: 画像最適化は自分の Supabase project のホストだけ
 *   3. 配線: safeFetch は redirect を 1 段ずつ追い、各段で IP リテラルを確かめる /
 *      next.config の画像の許可は自分の project だけ / cron のヘッダだけの通過は preview だけ
 *
 * ⚠ tsc は `process.execPath` + `node_modules/typescript/bin/tsc` で起動する
 *   (`npx` 経由は Windows で ENOENT / EINVAL になる)。
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
  if (a === e) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}\n       expected: ${e}\n       actual:   ${a}`);
  }
}
const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

const outDir = mkdtempSync(join(tmpdir(), "url-safe-check-"));
try {
  execFileSync(
    process.execPath,
    [
      "node_modules/typescript/bin/tsc",
      "src/lib/url-safe.ts",
      "--outDir", outDir,
      "--target", "es2022",
      "--module", "es2022",
      "--moduleResolution", "bundler",
      "--strict",
      "--types", "node",
    ],
    { stdio: "inherit" },
  );
  const m = await import(pathToFileURL(join(outDir, "url-safe.js")).href);

  // WHATWG URL が正規化した形 (safeFetch / isPublicHttpUrl が見る形) で判定する。
  const hostOf = (literal) => new URL(`http://${literal}/`).hostname;
  const blocked = (literal) => m.isBlockedIpLiteral(hostOf(literal));

  console.log("[内部・予約のアドレスは拒否]");
  const mustBlock = [
    // 従来から拒否していたもの (回帰の確認)
    "127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255",
    "[::1]", "[::]", "[fe80::1]", "[fc00::1]", "[::ffff:127.0.0.1]", "[64:ff9b::7f00:1]", "[2002:7f00:1::]",
    // 2026-10-07 に足した予約帯
    "192.0.0.1", "192.0.2.1", "198.18.0.1", "198.19.255.254", "198.51.100.1", "203.0.113.1",
    "[fec0::1]", "[feff::1]", "[ff02::1]", "[ff00::]", "[2001:0:4136:e378::1]", "[2001::1]", "[2001:db8::1]", "[100::1]", "[100:0:0:0:1::]",
  ];
  check("拒否すべきアドレスがすべて拒否される", mustBlock.filter((a) => !blocked(a)), []);

  console.log("\n[公開アドレスは通す]");
  const mustPass = [
    "8.8.8.8", "1.1.1.1", "192.0.1.1", "192.1.0.1", "198.17.255.1", "198.20.0.1", "198.51.101.1", "203.0.114.1", "100.63.0.1", "100.128.0.1",
    "[2001:4860:4860::8888]", "[2606:4700:4700::1111]", "[2001:1::1]", "[2001:db9::1]", "[2400::1]", "[101::1]",
  ];
  check("公開アドレスは通る", mustPass.filter((a) => blocked(a)), []);
  check("ホスト名は判定しない (safeFetch の DNS 検査に任せる)", m.isBlockedIpLiteral("example.com"), false);

  console.log("\n[画像最適化のホスト]");
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abcdefghijklmnop.supabase.co";
  const own = "https://abcdefghijklmnop.supabase.co/storage/v1/object/public/category-backgrounds/x.webp";
  check("自分の project の public bucket は最適化", m.isOptimizableImageHost(own), true);
  check("他人の project は最適化しない", m.isOptimizableImageHost("https://zzzzzzzzzzzzzzzz.supabase.co/storage/v1/object/public/b/x.png"), false);
  check("自分の project でも public bucket の外は最適化しない", m.isOptimizableImageHost("https://abcdefghijklmnop.supabase.co/rest/v1/x"), false);
  check("YouTube のサムネイルは最適化", m.isOptimizableImageHost("https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg"), true);
  check("http は最適化しない", m.isOptimizableImageHost("http://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg"), false);
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  check("env が無ければ Supabase は最適化しない", m.isOptimizableImageHost(own), false);
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

console.log("\n[配線]");
const sf = read("src/lib/server/safe-fetch.ts");
const body = sf.slice(sf.indexOf("export async function safeFetch("), sf.indexOf("const SAFE_FETCH_MAX_REDIRECTS"));
check(
  "safeFetch: 各段で IP リテラルを確かめてから、redirect を手で追う形で取りに行く",
  /for \(let hop = 0; ; hop\+\+\) \{\s*assertNotBlockedLiteral\(current\);\s*const res = \(await undiciFetch\(current, \{\s*\.\.\.\(init as UndiciRequestInit\),\s*redirect: "manual",/.test(body),
  true,
);
check("safeFetch: 追う回数に上限がある", /if \(hop >= SAFE_FETCH_MAX_REDIRECTS\)/.test(body) && /const SAFE_FETCH_MAX_REDIRECTS = [1-9];/.test(sf), true);
check("safeFetch: http(s) 以外への redirect は追わない", /if \(next\.protocol !== "http:" && next\.protocol !== "https:"\)/.test(body), true);
const nc = read("next.config.ts");
check("next.config: Supabase の画像は自分の project のホストだけ", !/\*\.supabase\.co/.test(nc.replace(/^\s*(\/\/|\*).*$/gm, "")) && /hostname: SUPABASE_IMAGE_HOST,/.test(nc), true);
const cron = read("src/lib/server/cron-auth.ts");
check("cron: ヘッダだけの通過は Vercel の preview だけ (許可リスト型)", /const allowHeaderOnly =\s*isVercelCron && process\.env\.VERCEL_ENV === "preview";/.test(cron), true);

console.log("");
if (failures > 0) {
  console.error(`${failures} 件失敗`);
  process.exit(1);
}
console.log("すべて成功");
