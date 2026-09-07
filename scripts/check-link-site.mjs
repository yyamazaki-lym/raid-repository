/**
 * リンクのサイト判定 (src/lib/link-site.ts) の検証 (2026-09-07)。
 * 実行: `node scripts/check-link-site.mjs`
 *
 * ホスト一覧は増える一方なので、既知ホストが期待どおりに分類されること
 * (と、他人のドメインを巻き込まないこと) をここで固定する。
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const SRC = "src/lib/link-site.ts";
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

const outDir = mkdtempSync(join(tmpdir(), "link-site-check-"));
try {
  execFileSync(
    "npx",
    ["tsc", SRC, "--outDir", outDir, "--target", "es2022", "--module", "es2022", "--moduleResolution", "bundler", "--strict"],
    { stdio: "inherit" },
  );
  const m = await import(pathToFileURL(join(outDir, "link-site.js")).href);

  console.log("\n[Google フォト]");
  check("短縮共有リンク", m.detectLinkSite("https://photos.app.goo.gl/AbCdEfGh12345"), "googlephotos");
  check("アルバム共有リンク", m.detectLinkSite("https://photos.google.com/share/AF1Qip..."), "googlephotos");
  check("実体 URL (usercontent)", m.detectLinkSite("https://lh3.photos.googleusercontent.com/x"), "googlephotos");
  check("coarse では動画扱い", m.coarseSite("googlephotos"), "video");
  check("ラベル ja / en", [m.linkSiteLabel("googlephotos"), m.linkSiteLabel("googlephotos", "en")], ["Google フォト", "Google Photos"]);
  check("Google の他サービスは巻き込まない", [
    m.detectLinkSite("https://drive.google.com/file/d/x"),
    m.detectLinkSite("https://docs.google.com/spreadsheets/d/x"),
    m.detectLinkSite("https://www.google.com/"),
  ], ["web", "web", "web"]);

  console.log("\n[既存の判定を壊さない]");
  check("YouTube", [m.detectLinkSite("https://www.youtube.com/watch?v=x"), m.detectLinkSite("https://youtu.be/x")], ["youtube", "youtube"]);
  check("Twitch / ニコニコ / X", [
    m.detectLinkSite("https://www.twitch.tv/x"),
    m.detectLinkSite("https://www.nicovideo.jp/watch/sm1"),
    m.detectLinkSite("https://x.com/a/status/1"),
  ], ["twitch", "niconico", "x"]);
  check("未知ホスト / 非 http は web", [
    m.detectLinkSite("https://example.com/"),
    m.detectLinkSite("javascript:alert(1)"),
    m.detectLinkSite("not a url"),
  ], ["web", "web", "web"]);
  check("FF14 リソース判定は無変更", [
    m.detectFf14Resource("https://www.fflogs.com/reports/x"),
    m.detectFf14Resource("https://photos.app.goo.gl/x"),
  ], ["logs", null]);

  console.log("\n[W-32 (2026-09-07) 追加した判定]");
  check("knt-a.com は攻略", m.detectFf14Resource("https://knt-a.com/ff14/x"), "guide");
  check(
    "xivraidplanner.app は作図 (計画共有)",
    m.detectFf14Resource("https://xivraidplanner.app/teams/1"),
    "plan",
  );
  check(
    "xivrecruit.com は募集 (専用の種別)",
    m.detectFf14Resource("https://xivrecruit.com/listings"),
    "recruit",
  );
  check("サブドメインも拾う", m.detectFf14Resource("https://www.knt-a.com/"), "guide");
  check(
    "募集ラベル ja / en",
    [m.ff14ResourceLabel("recruit"), m.ff14ResourceLabel("recruit", "en")],
    ["募集", "Recruit"],
  );
  // 似た名前の別ホストを巻き込まないこと (辞書は完全一致 or サブドメイン)。
  check(
    "似た名前は巻き込まない",
    [
      m.detectFf14Resource("https://knt-a.com.example.com/"),
      m.detectFf14Resource("https://notxivrecruit.com/"),
    ],
    [null, null],
  );
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
