/**
 * レポート発見元 (src/lib/fflogs-report-source.ts) の検証
 * (2026-09-07 W-5 / 2026-09-08 L-4 で 3 択 → 経路ごとの集合に変更)。
 * 実行: `node scripts/check-fflogs-report-source.mjs`
 *
 * 「どこからレポートを見つけるか」は固定の運用で変わる (FFLogs 上に
 * static = guild を作っているか、計測担当が個人アカウントで上げているか、
 * その両方か)。排他 3 択から独立トグルの集合に変えたので、
 *
 *   - **旧 3 択の保存値からの移行で設定が変わらない**こと
 *     (`links` → 空集合 / `guild` → guild だけ / `user` → user だけ)
 *   - 未設定 / 未知の値が必ず「自動発見なし」= 従来の挙動に倒れること
 *   - 保存形が並びまで一意 (同じ集合が 2 通りで保存されない) であること
 *   - ON にしたのに条件が足りていない経路 (guild を ON にして guild ID が
 *     空、OAuth 未接続) を**経路ごとに**検出できること
 *   - 2 経路 ON のとき 1 回の取り込み枠を分け合うこと
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
    parseFflogsReportSource, serializeFflogsReportSource,
    isFflogsAutoRoute, isFflogsAutoRoutes, reportSourceReadiness,
    usesAutoDiscovery, FFLOGS_AUTO_ROUTES, FFLOGS_AUTO_ROUTES_NONE,
    FFLOGS_REPORT_SOURCE_KEY, AUTO_DISCOVERY_LIMIT, autoDiscoveryLimitPerRoute,
  } = v;

  const NONE = { guild: false, user: false };
  const GUILD = { guild: true, user: false };
  const USER = { guild: false, user: true };
  const BOTH = { guild: true, user: true };

  console.log("経路と既定");
  check("経路は 2 本 (貼られた URL は含めない)", [...FFLOGS_AUTO_ROUTES], ["guild", "user"]);
  check("既定は自動発見なし", FFLOGS_AUTO_ROUTES_NONE, NONE);
  check("設定キーは 3 択時代から変えない", FFLOGS_REPORT_SOURCE_KEY, "fflogs_report_source");
  check("経路の判定関数", [isFflogsAutoRoute("guild"), isFflogsAutoRoute("links"), isFflogsAutoRoute("x")],
    [true, false, false]);

  console.log("\n未設定 / 未知の値は自動発見なしに倒れる");
  check("未設定 (null)", parseFflogsReportSource(null), NONE);
  check("未設定 (undefined)", parseFflogsReportSource(undefined), NONE);
  check("空文字", parseFflogsReportSource(""), NONE);
  check("空白のみ", parseFflogsReportSource("   "), NONE);
  check("未知の値", parseFflogsReportSource("everything"), NONE);
  check("大文字は別扱い", parseFflogsReportSource("GUILD"), NONE);
  check("カンマだけ", parseFflogsReportSource(",,"), NONE);
  check("未知のトークンは無視して既知だけ拾う", parseFflogsReportSource("guild,everything"), GUILD);

  console.log("\n旧 3 択の保存値から移行しても設定が変わらない");
  check("旧 links は自動発見なし", parseFflogsReportSource("links"), NONE);
  check("旧 guild は guild だけ", parseFflogsReportSource("guild"), GUILD);
  check("旧 user は user だけ", parseFflogsReportSource("user"), USER);
  check("旧値に混ざった links は無視される", parseFflogsReportSource("links,user"), USER);

  console.log("\n集合の読み書き");
  check("両方 ON", parseFflogsReportSource("guild,user"), BOTH);
  check("並びが逆でも同じ集合", parseFflogsReportSource("user,guild"), BOTH);
  check("トークン前後の空白は落とす", parseFflogsReportSource("  guild ,  user  "), BOTH);
  check("重複しても 1 件", parseFflogsReportSource("user,user"), USER);
  check("保存形 (なし)", serializeFflogsReportSource(NONE), "");
  check("保存形 (guild)", serializeFflogsReportSource(GUILD), "guild");
  check("保存形 (user)", serializeFflogsReportSource(USER), "user");
  check("保存形は並びまで一意", serializeFflogsReportSource(BOTH), "guild,user");
  check("読んで書いても同じ (guild,user)",
    serializeFflogsReportSource(parseFflogsReportSource("user,guild")), "guild,user");
  check("旧 links は空文字へ正規化される",
    serializeFflogsReportSource(parseFflogsReportSource("links")), "");

  console.log("\nServer Action の入力検査 (欠けた経路を false と解釈しない)");
  check("そろっていれば通る", isFflogsAutoRoutes(BOTH), true);
  check("経路が欠けていたら弾く", isFflogsAutoRoutes({ guild: true }), false);
  check("boolean 以外は弾く", isFflogsAutoRoutes({ guild: "true", user: false }), false);
  check("null / 配列 / 文字列は弾く",
    [isFflogsAutoRoutes(null), isFflogsAutoRoutes(["guild"]), isFflogsAutoRoutes("guild")],
    [false, false, false]);
  check("余分なキーがあっても経路がそろっていれば通る",
    isFflogsAutoRoutes({ guild: false, user: true, links: true }), true);

  console.log("\n自動発見するか");
  check("空集合はしない", usesAutoDiscovery(NONE), false);
  check("guild だけならする", usesAutoDiscovery(GUILD), true);
  check("user だけならする", usesAutoDiscovery(USER), true);
  check("両方ならする", usesAutoDiscovery(BOTH), true);

  console.log("\n条件の足りていない経路を経路ごとに検出する");
  check("空集合は何も動かず何も詰まらない",
    reportSourceReadiness({ routes: NONE, guildId: "", oauthConnected: false }),
    { usable: [], blocked: [] });
  check("guild + guild ID + OAuth",
    reportSourceReadiness({ routes: GUILD, guildId: "12345", oauthConnected: true }),
    { usable: ["guild"], blocked: [] });
  check("guild を ON にしたのに guild ID が空",
    reportSourceReadiness({ routes: GUILD, guildId: "", oauthConnected: true }),
    { usable: [], blocked: [{ route: "guild", missing: "guildId" }] });
  check("guild ID が空白のみでも足りない",
    reportSourceReadiness({ routes: GUILD, guildId: "   ", oauthConnected: true }),
    { usable: [], blocked: [{ route: "guild", missing: "guildId" }] });
  check("guild ID が null でも足りない",
    reportSourceReadiness({ routes: GUILD, guildId: null, oauthConnected: true }),
    { usable: [], blocked: [{ route: "guild", missing: "guildId" }] });
  check("OAuth 未接続は guild ID より先に出す",
    reportSourceReadiness({ routes: GUILD, guildId: "", oauthConnected: false }),
    { usable: [], blocked: [{ route: "guild", missing: "oauth" }] });
  check("user は OAuth だけで足りる",
    reportSourceReadiness({ routes: USER, guildId: "", oauthConnected: true }),
    { usable: ["user"], blocked: [] });
  check("user + OAuth 未接続",
    reportSourceReadiness({ routes: USER, guildId: "12345", oauthConnected: false }),
    { usable: [], blocked: [{ route: "user", missing: "oauth" }] });
  check("両方 ON で guild ID だけ無い = user は動く",
    reportSourceReadiness({ routes: BOTH, guildId: "", oauthConnected: true }),
    { usable: ["user"], blocked: [{ route: "guild", missing: "guildId" }] });
  check("両方 ON で条件そろい",
    reportSourceReadiness({ routes: BOTH, guildId: "12345", oauthConnected: true }),
    { usable: ["guild", "user"], blocked: [] });
  check("両方 ON で OAuth 未接続 = 2 本とも詰まる",
    reportSourceReadiness({ routes: BOTH, guildId: "12345", oauthConnected: false }),
    { usable: [], blocked: [
      { route: "guild", missing: "oauth" }, { route: "user", missing: "oauth" }] });
  check("usable の並びは経路の定義順",
    reportSourceReadiness({ routes: BOTH, guildId: "1", oauthConnected: true }).usable,
    ["guild", "user"]);

  console.log("\n1 回の発見件数は経路で分け合う");
  check("枠は直近 1 ページ分", AUTO_DISCOVERY_LIMIT, 25);
  check("1 経路なら枠まるごと", autoDiscoveryLimitPerRoute(1), 25);
  check("2 経路なら切り上げで半分ずつ", autoDiscoveryLimitPerRoute(2), 13);
  check("経路が 0 なら 0", autoDiscoveryLimitPerRoute(0), 0);
  check("経路が増えても 0 件の経路を作らない (切り上げ)",
    [autoDiscoveryLimitPerRoute(3), autoDiscoveryLimitPerRoute(26)], [9, 1]);
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
