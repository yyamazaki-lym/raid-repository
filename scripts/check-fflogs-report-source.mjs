/**
 * レポート発見元の選択 (src/lib/fflogs-report-source.ts) の検証
 * (2026-09-07、W-5)。
 * 実行: `node scripts/check-fflogs-report-source.mjs`
 *
 * 「どこからレポートを見つけるか」は固定の運用で変わる (FFLogs 上に
 * static = guild を作っているか、計測担当の個人アカウントで上げているか)。
 * 設定で選べるようにしたので、
 *
 *   - 未設定 / 未知の値が必ず従来の挙動 (`links`) に倒れること
 *   - 選んだのに条件が足りていない状態 (guild を選んで guild ID が空、
 *     OAuth 未接続) を検出できること
 *
 * を固定する。既定が自動発見に倒れると、guild で他コンテンツも回している
 * 固定で無関係なレポートが台帳に大量に入る。
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
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

const outDir = mkdtempSync(join(tmpdir(), "report-source-check-"));
try {
  execFileSync(
    "npx",
    ["tsc", "src/lib/fflogs-report-source.ts", "--outDir", outDir, "--target", "es2022",
     "--module", "es2022", "--moduleResolution", "bundler", "--strict"],
    { stdio: "inherit" },
  );
  for (const f of readdirSync(outDir)) {
    if (!f.endsWith(".js")) continue;
    const fp = join(outDir, f);
    writeFileSync(fp, readFileSync(fp, "utf8").replace(
      /(from\s+["'])(\.\.?\/[^"']+?)(?<!\.js)(["'])/g, "$1$2.js$3"));
  }
  const v = await import(pathToFileURL(join(outDir, "fflogs-report-source.js")).href);
  const {
    parseFflogsReportSource, isFflogsReportSource, reportSourceReadiness,
    usesAutoDiscovery, FFLOGS_REPORT_SOURCE_DEFAULT, FFLOGS_REPORT_SOURCES,
    FFLOGS_REPORT_SOURCE_KEY, AUTO_DISCOVERY_LIMIT,
  } = v;

  console.log("既定は従来の挙動");
  check("既定は links", FFLOGS_REPORT_SOURCE_DEFAULT, "links");
  check("3 モード", [...FFLOGS_REPORT_SOURCES], ["links", "guild", "user"]);
  check("設定キー", FFLOGS_REPORT_SOURCE_KEY, "fflogs_report_source");
  check("未設定 (null)", parseFflogsReportSource(null), "links");
  check("未設定 (undefined)", parseFflogsReportSource(undefined), "links");
  check("空文字", parseFflogsReportSource(""), "links");
  check("空白のみ", parseFflogsReportSource("   "), "links");
  check("未知の値", parseFflogsReportSource("everything"), "links");
  check("大文字は別扱い", parseFflogsReportSource("GUILD"), "links");
  check("前後の空白は落とす", parseFflogsReportSource("  guild  "), "guild");
  check("guild", parseFflogsReportSource("guild"), "guild");
  check("user", parseFflogsReportSource("user"), "user");
  check("判定関数", [isFflogsReportSource("user"), isFflogsReportSource("x")], [true, false]);

  console.log("\n自動発見するモードか");
  check("links はしない", usesAutoDiscovery("links"), false);
  check("guild はする", usesAutoDiscovery("guild"), true);
  check("user はする", usesAutoDiscovery("user"), true);

  console.log("\n条件の足りていない状態を検出する");
  check("links は無条件で動く",
    reportSourceReadiness({ source: "links", guildId: "", oauthConnected: false }),
    { ready: true, missing: null });
  check("guild + guild ID + OAuth",
    reportSourceReadiness({ source: "guild", guildId: "12345", oauthConnected: true }),
    { ready: true, missing: null });
  check("guild なのに guild ID が空",
    reportSourceReadiness({ source: "guild", guildId: "", oauthConnected: true }),
    { ready: false, missing: "guildId" });
  check("guild ID が空白のみでも足りない",
    reportSourceReadiness({ source: "guild", guildId: "   ", oauthConnected: true }),
    { ready: false, missing: "guildId" });
  check("guild ID が null でも足りない",
    reportSourceReadiness({ source: "guild", guildId: null, oauthConnected: true }),
    { ready: false, missing: "guildId" });
  check("OAuth 未接続は guild ID より先に出す",
    reportSourceReadiness({ source: "guild", guildId: "", oauthConnected: false }),
    { ready: false, missing: "oauth" });
  check("user は OAuth だけで足りる",
    reportSourceReadiness({ source: "user", guildId: "", oauthConnected: true }),
    { ready: true, missing: null });
  check("user + OAuth 未接続",
    reportSourceReadiness({ source: "user", guildId: "12345", oauthConnected: false }),
    { ready: false, missing: "oauth" });

  console.log("\n1 回の発見件数");
  check("直近 1 ページ分", AUTO_DISCOVERY_LIMIT, 25);
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
