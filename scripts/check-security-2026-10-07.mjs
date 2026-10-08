/**
 * 2026-10-07 セキュリティ精査 (アプリ側) の回帰ガード。
 * 実行: `node scripts/check-security-2026-10-07.mjs`
 *
 * どれも呼び出し側のソースにしか書けない前提なので、ソースを読んで確かめる。
 * データベースの規則 (RLS) は check-rls-membership.mjs、日付メモの上限は
 * check-memo-permissions.mjs が見る。
 *
 *   M-1 Discord のロール一覧 (bot token で Discord を叩く) は admin だけ
 *   M-2 ミス注釈は実在する pull にだけ付け、カテゴリは pull の行から取る。1 人 1 日の上限
 *   L   URL の値 (`/auth/denied?reason=`・`/login?error=`・`?fflogs_oauth_error=`)
 *       をそのまま画面に出さない (2026-08-05 の L-7 の残り)
 *   L   Server Action: 更新は書いてよい列だけ (L-12 の回帰)・admin に生のエラー文を
 *       返さない・失敗を握りつぶさない・cookie を返さない・デモの匿名ゲスト・
 *       メンバーの Action で再検証しない・YouTube リンクと取り込みの URL は http(s)
 *   L   DB: ポリシー 0 本の表の権限を外す (デプロイ時の表明も)・fflogs_report_days の anon /
 *       開発サーバーは 127.0.0.1 だけ
 *   L   公開デモの匿名ゲストの出席サマリーは IP ごとに 1 分 10 回 (2026-10-08)
 *
 * URL の安全判定・safeFetch の redirect・画像最適化のホスト・cron のヘッダは
 * check-url-safe.mjs、書き出しの backpressure は check-data-export.mjs が見る。
 *
 * Discord に流す文の無害化は check-discord-text.mjs が見る。
 */
import { readdirSync, readFileSync } from "node:fs";

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
const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
/** 行コメント (`// ...`) を落とす。経緯の説明に旧い書き方が出てくるため。 */
const code = (s) => s.replace(/^\s*\/\/.*$/gm, "");
/** `export async function name(` から次の top-level の "\n}\n" まで。 */
function fnBody(src, name) {
  const start = src.indexOf(`export async function ${name}(`);
  if (start < 0) return "";
  const end = src.indexOf("\n}\n", start);
  return end < 0 ? src.slice(start) : src.slice(start, end);
}

console.log("M-1 Discord のロール一覧");
const categories = read("src/lib/server/categories-actions.ts");
const roles = fnBody(categories, "fetchAvailableGuildRoles");
check(
  "admin を確かめてから bot token で取りに行く",
  /const auth = await assertAdminResult\(\);\s*if \(!auth\.ok\) return \[\];\s*return fetchGuildRoles\(\);/.test(roles),
  true,
);

console.log("\nM-2 ミス注釈の追加");
const notes = read("src/lib/server/pull-notes-actions.ts");
const add = code(fnBody(notes, "addPullNoteAction"));
check(
  "pull の実在を確かめる (無ければ付けない)",
  /\.from\("fflogs_fights"\)\s*\.select\("category_id"\)\s*\.eq\("report_code", code\)\s*\.eq\("fight_id", input\.fightId\)\s*\.maybeSingle\(\);/.test(add) &&
    /if \(!fight\) \{\s*return \{ ok: false, reason: "その pull が見つかりません" \};/.test(add),
  true,
);
check(
  "カテゴリは pull の行から取り、呼び出し側の値を使わない",
  /const categoryId = \(fight\.category_id as string \| null\) \?\? null;/.test(add) &&
    /category_id: categoryId,/.test(add) &&
    !/input\.categoryId/.test(add),
  true,
);
check(
  "1 人 24 時間の上限を、書き込む前に数える",
  /\.eq\("created_by_id", user\.discordId\)\s*\.gte\("created_at", since\);/.test(add) &&
    add.indexOf("NOTES_PER_DAY_LIMIT") < add.indexOf('.from("fflogs_pull_notes").insert('),
  true,
);
check("上限の値は export しない (\"use server\" のファイル)", /^const NOTES_PER_DAY_LIMIT = \d+;/m.test(notes) && !/export const NOTES_PER_DAY_LIMIT/.test(notes), true);

console.log("\nL URL の値をそのまま画面に出さない");
{
  // /auth/denied: 出してよい reason の集合と、サイト自身が付ける reason の突き合わせ。
  const denied = read("src/app/auth/denied/page.tsx");
  const setBody = denied.match(/const KNOWN_REASONS = new Set\(\[([\s\S]*?)\]\);/)?.[1] ?? "";
  const known = new Set([...setBody.matchAll(/"([a-z_]+)"/g)].map((x) => x[1]));
  const produced = new Set();
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name)) {
        const s = read(p);
        for (const x of s.matchAll(/\/auth\/denied\?reason=([a-z_]+)/g)) produced.add(x[1]);
        for (const x of s.matchAll(/"\/auth\/denied", \{ reason: "([a-z_]+)" \}/g)) produced.add(x[1]);
      }
    }
  };
  walk("src");
  // callback が素通しする Discord の判定の理由 (union 型) と、proxy の失効の理由。
  const membership = read("src/lib/server/discord-membership.ts");
  for (const x of (membership.match(/reason: ("[a-z_]+"(?: \| "[a-z_]+")*);/)?.[1] ?? "").matchAll(/"([a-z_]+)"/g)) produced.add(x[1]);
  const proxy = read("src/proxy.ts");
  const proxyBlock = proxy.slice(proxy.indexOf('deniedUrl.searchParams.set('), proxy.indexOf('const revoked = NextResponse.redirect(deniedUrl);'));
  for (const x of proxyBlock.matchAll(/"([a-z_]+)"/g)) if (x[1] !== "not_in_guild" && x[1] !== "reason") produced.add(x[1]);
  check("denied: サイト自身が付ける reason を 8 種類以上拾えている", produced.size >= 8, true);
  check("denied: サイト自身が付ける reason はすべて許可リストにある", [...produced].filter((r) => !known.has(r)).sort(), []);
  check("denied: 許可リストに無い値は出さない", /KNOWN_REASONS\.has\(rawReason\)/.test(denied) && /reason: \{reason\}/.test(denied) && !/reason: \{rawReason\}/.test(denied), true);

  const login = read("src/app/login/page.tsx");
  const core = read("src/lib/i18n/dict/core.ts");
  check("login: 知らないコードは固定の文言 (コードを出さない)", /default:[\s\S]{0,200}return m\.login\.errorGeneric;/.test(login) && !/errorGeneric\(/.test(login), true);
  check("login: 辞書の errorGeneric は文字列 (差し込みが無い)", (core.match(/errorGeneric: "[^"$]+",/g) ?? []).length, 2);

  const callback = read("src/app/api/auth/fflogs/callback/route.ts");
  const start = read("src/app/api/auth/fflogs/start/route.ts");
  const setsInCallback = [...callback.matchAll(/searchParams\.set\("fflogs_oauth_error", ([^)]+)\)/g)].map((x) => x[1]);
  check("FFLogs OAuth (callback): URL にはコードだけを載せる", setsInCallback, ["errorCode"]);
  check("FFLogs OAuth (callback): 失敗はすべて fail(コード, 詳細) を通る", (callback.match(/return fail\(/g) ?? []).length, 4);
  check("FFLogs OAuth (start): URL にはコードだけを載せる", [...start.matchAll(/searchParams\.set\("fflogs_oauth_error", ([^)]+)\)/g)].map((x) => x[1]), ["result.code"]);

  const codesSrc = read("src/lib/fflogs-oauth-error.ts");
  const codes = [...(codesSrc.match(/FFLOGS_OAUTH_ERROR_CODES = \[([\s\S]*?)\] as const;/)?.[1] ?? "").matchAll(/^\s*"([a-z_]+)",$/gm)].map((x) => x[1]);
  const dict = read("src/lib/i18n/dict/settings.ts");
  const blocks = [...dict.matchAll(/oauthErrors: \{([\s\S]*?)\n    \},/g)].map((x) => x[1]);
  check("FFLogs OAuth: コードは 9 種類", codes.length, 9);
  check("FFLogs OAuth: 辞書 (ja / en) にすべてのコードの文言がある", blocks.map((b) => codes.filter((c) => !new RegExp(`^\\s*${c}: "`, "m").test(b))), [[], []]);
  const dialog = read("src/components/portal/settings-dialog.tsx");
  check("FFLogs OAuth: 画面は既知のコードだけを辞書の文言に変える", /isFflogsOauthErrorCode\(errParam\)\s*\?\s*m\.settingsDialog\.oauthErrors\[errParam\]\s*:\s*m\.settingsDialog\.oauthErrorUnknown;/.test(dialog) && !/toastOauthError\(errParam\)/.test(dialog), true);
}

console.log("\nL Server Action の入力と返す値");
{
  // L-12 の回帰: 受け取った patch をそのまま update に渡さない。
  for (const [file, fn, cols] of [
    ["src/lib/server/category-macros-actions.ts", "updateCategoryMacroAction", ["label", "body"]],
    ["src/lib/server/category-waymarks-actions.ts", "updateCategoryWaymarkAction", ["label", "body", "note"]],
  ]) {
    const body = code(fnBody(read(file), fn));
    const picked = [...body.matchAll(/if \(patch\.(\w+) !== undefined\) dbPatch\.(\w+) = patch\.\1;/g)].map((x) => x[1]);
    check(`${fn}: 書いてよい列だけを拾う (${cols.join(" / ")})`, picked, cols);
    check(`${fn}: update には拾った列だけを渡す`, /\.update\(dbPatch\)/.test(body) && !/\.update\(patch\)/.test(body), true);
  }

  // admin に返す失敗の理由に、例外や DB の生の文を載せない。
  const reminder = code(read("src/lib/server/attendance-reminder-actions.ts"));
  check("出欠催促: 例外の中身 (String(e)) を返さない", /String\(e\)/.test(reminder), false);
  const categories = code(read("src/lib/server/categories-actions.ts"));
  check("動画の長さの補完: DB の生のエラー文を返さない", /"video links fetch failed: " \+ msg/.test(categories), false);
  check("Google フォト: 例外は describeGphotoFetchError で直してから返す (2 か所)", (categories.match(/const msg = describeGphotoFetchError\(err\);/g) ?? []).length, 2);
  check("Google フォト: 例外の message をそのまま使わない", /err instanceof Error \? err\.message/.test(categories), false);
  const gphoto = read("src/lib/server/google-photos.ts");
  check("Google フォト: 自分で投げる失敗は GphotoFetchError (それ以外は fetchErrorReason)", !/throw new Error\(/.test(gphoto) && /e instanceof GphotoFetchError \? e\.message : fetchErrorReason\(e\)/.test(gphoto), true);

  // 出席の実績の削除の失敗を握りつぶさない。
  const actuals = read("src/lib/server/attendance-actuals.ts");
  check("出席の実績の削除: { error } を見て失敗を返す", /const \{ error \} = await db\s*\.from\("fflogs_attendance_actuals"\)\s*\.delete\(\)/.test(actuals) && /if \(error\) return \{ ok: false, error \};/.test(actuals), true);
  const fights = code(read("src/lib/server/fflogs-fights-actions.ts"));
  check("レポートの削除: 出席の実績を消せなければ台帳の前で止める", /const actuals = await deleteAttendanceActualsForReport\(code\);\s*if \(!actuals\.ok\) \{\s*return \{ ok: false, reason: dbError\(/.test(fights), true);

  // FFLogs の session cookie はクライアントへ一部も返さない。
  const cookie = code(fnBody(categories, "getFflogsSessionCookieStatus"));
  check("FFLogs cookie の状態: 有無だけを返す (先頭の文字を返さない)", /preview|\.slice\(/.test(cookie) || !/return \{ set: Boolean\(value\) \};/.test(cookie), false);

  // 公開デモの匿名ゲストと、予定の ID の形。
  const native = read("src/lib/server/native-schedule-actions.ts");
  const upsert = code(fnBody(native, "upsertNativeScheduleAttendanceAction"));
  check("出欠の回答: デモの匿名ゲストを先に弾く", upsert.indexOf("if (member.isDemoGuest)") > 0 && upsert.indexOf("if (member.isDemoGuest)") < upsert.indexOf("createClient()"), true);
  check("出欠の回答: 予定の ID は UUID の形だけ", /if \(!\/\^\[0-9a-f-\]\{36\}\$\/i\.test\(sessionId\)\)/.test(upsert), true);

  // メンバーが連打できる Action で再検証しない (外部取得・Data Cache を捨てさせない)。
  const memberActions = [
    ["src/lib/server/native-schedule-actions.ts", "upsertNativeScheduleAttendanceAction"],
    ["src/lib/server/native-schedule-actions.ts", "updateNativeScheduleMemberCommentAction"],
    ["src/lib/server/pull-notes-actions.ts", "addPullNoteAction"],
    ["src/lib/server/pull-notes-actions.ts", "deletePullNoteAction"],
    ["src/lib/server/category-link-actions.ts", "setCategoryLinkReadAction"],
    ["src/lib/server/bis-slots-actions.ts", "setCategoryBisSlotAction"],
    ["src/lib/server/loot-weekly-actions.ts", "setMyLootWeeklyStatusAction"],
  ];
  check(
    "メンバーの Action 7 本は revalidatePath / revalidateQuietly を呼ばない",
    memberActions.filter(([f, fn]) => {
      const body = code(fnBody(read(f), fn));
      return body === "" || /revalidatePath\(|revalidateQuietly\(/.test(body);
    }).map(([, fn]) => fn),
    [],
  );
  const footer = read("src/components/portal/link-card-footer.tsx");
  check("既読の切り替え: 画面が router.refresh() で取り直す", /await setCategoryLinkReadAction\(linkId, next\);[\s\S]{0,400}router\.refresh\(\);/.test(footer), true);

  // YouTube リンクは http(s) だけ。
  const yt = read("src/lib/youtube.ts");
  check("parseYouTubeId: http(s) 以外は ID を返さない", /if \(parsed\.protocol !== "https:" && parsed\.protocol !== "http:"\) return null;/.test(yt), true);
  const videos = read("src/app/(portal)/category/[slug]/videos/videos-list.tsx");
  check("動画の「YouTube で開く」: href は safeHref を通す", /href=\{url\}/.test(videos), false);

  // 取り込みもリンクの URL を http(s) に限る。
  const importer = code(read("src/lib/server/data-import-actions.ts"));
  check(
    "取り込み: リンクの URL 列を確かめてから書く",
    /if \(input\.table === "category_links"\) \{\s*const bad = rows\.filter\(\(r\) => !linkRowUrlsAreSafe\(r\)\)\.length;/.test(importer) &&
      importer.indexOf("linkRowUrlsAreSafe(r)") < importer.indexOf(".upsert(rows,"),
    true,
  );
}

console.log("\nL DB の権限と開発サーバー");
{
  const schema = read("supabase/schema.sql");
  // RLS 有効でポリシーが 0 本の表 (service role 専用) を静的に洗い出す。
  const rls = new Set([...schema.matchAll(/ALTER TABLE (?:IF EXISTS )?public\.(\w+)\s+ENABLE ROW LEVEL SECURITY/g)].map((x) => x[1]));
  const withPolicy = new Set([
    ...[...schema.matchAll(/CREATE POLICY\s+(?:"[^"]+"|\w+)\s+ON\s+public\.(\w+)/g)].map((x) => x[1]),
    ...[...schema.matchAll(/'CREATE POLICY [^']*? ON public\.(\w+)/g)].map((x) => x[1]),
  ]);
  // DO ブロックのループ (unnest(ARRAY[...]) / FOREACH ... IN ARRAY ARRAY[...]) で %I に入る表。
  for (const m of schema.matchAll(/(?:unnest\(ARRAY|IN ARRAY\s+ARRAY)\[([^\]]*)\]/g)) {
    const tail = schema.slice(m.index + m[0].length, m.index + m[0].length + 3000);
    if (/CREATE POLICY/.test(tail)) for (const t of m[1].matchAll(/'(\w+)'/g)) withPolicy.add(t[1]);
  }
  const policyless = [...rls].filter((t) => !withPolicy.has(t)).sort();
  const revokeAt = schema.indexOf("REVOKE ALL ON TABLE\n  public.category_link_reads,");
  const revoked = new Set(
    [...schema.slice(revokeAt, schema.indexOf("FROM anon, authenticated;", revokeAt)).matchAll(/public\.(\w+)/g)].map((x) => x[1]),
  );
  check("ポリシー 0 本の表を拾えている (7 表以上)", policyless.length >= 7, true);
  check("ポリシー 0 本の表はすべて anon / authenticated の権限を外す", policyless.filter((t) => !revoked.has(t)), []);
  check("fflogs_report_days は anon も名指しで外す", /REVOKE EXECUTE ON FUNCTION public\.fflogs_report_days\(bigint\) FROM PUBLIC, anon;/.test(schema), true);
  const wf = read(".github/workflows/deploy-database.yml");
  check("デプロイ時に、ポリシーの無い表に権限が残っていないことを確かめる", /name: Assert no client privileges on policy-less tables[\s\S]{0,1500}NOT EXISTS \(SELECT 1 FROM pg_policy p WHERE p\.polrelid = c\.oid\)[\s\S]{0,200}has_table_privilege\(r\.rolname, c\.oid, 'SELECT,INSERT,UPDATE,DELETE'\)/.test(wf), true);

  // 全データ初期化: 権限を外した表は service role で消す (cookie のクライアントだと permission denied で止まる)。
  const init = code(fnBody(read("src/lib/server/admin-actions.ts"), "initializeAllDataAction"));
  const initTables = [...init.matchAll(/\{ table: "(\w+)", pk:/g)].map((x) => x[1]);
  const viaService = [...(init.match(/const SERVICE_ROLE_ONLY = new Set<keyof DataInitCounts>\(\[([\s\S]*?)\]\);/)?.[1] ?? "").matchAll(/"(\w+)"/g)].map((x) => x[1]);
  check("全データ初期化: 権限を外した表は service role で消す", initTables.filter((t) => revoked.has(t) && !viaService.includes(t)), []);
  check("全データ初期化: 表ごとに client を選ぶ", /const client = SERVICE_ROLE_ONLY\.has\(step\.table\) \? serviceRole : supabase;/.test(init), true);

  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  check("開発サーバーはこのパソコンからだけ (127.0.0.1)", pkg.scripts.dev, "next dev -H 127.0.0.1");
}

console.log("\nL 公開デモの匿名ゲストの出席サマリー (2026-10-08)");
{
  const src = read("src/lib/server/attendance-summary-actions.ts");
  const body = code(fnBody(src, "fetchAttendanceSummaryAction"));
  const iGuard = body.indexOf("if (user.isDemoGuest) {");
  check(
    "匿名ゲストは IP ごとに回数を確かめる",
    /if \(user\.isDemoGuest\) \{\s*const rl = await checkRateLimit\(\s*"action-attendance-summary",\s*`ip:\$\{clientIpFromHeaders\(await headers\(\)\)\}`,\s*DEMO_GUEST_SUMMARY_LIMIT\.limit,\s*DEMO_GUEST_SUMMARY_LIMIT\.windowMs,\s*\);\s*if \(!rl\.allowed\) \{/.test(body),
    true,
  );
  check(
    "回数の確認は重い読み取り (service role・設定の読み取り) より前",
    iGuard > 0 && iGuard < body.indexOf("createSupabaseServiceRoleClient()") && iGuard < body.indexOf("getScheduleSourceMode()"),
    true,
  );
  check("上限は 1 分 10 回 (export しない)", /^const DEMO_GUEST_SUMMARY_LIMIT = \{ limit: 10, windowMs: 60_000 \};/m.test(src) && !/export const DEMO_GUEST_SUMMARY_LIMIT/.test(src), true);
  // 回数の器 (scope) が他の制限と混ざらない。
  const scopes = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name)) for (const x of read(p).matchAll(/"action-attendance-summary"/g)) scopes.push(p + x.index);
    }
  };
  walk("src");
  check("scope \"action-attendance-summary\" を使うのはこの 1 か所だけ", scopes.length, 1);
  // guardExternalFetch は `action-${scope}` をテンプレートで作るので、文字列の
  // 一致だけでは重なりを見落とす。上限表のキーに "attendance-summary" が無いこと
  // も確かめる (足すと、メンバーの user: とゲストの ip: が同じ器を使う)。
  const guard = read("src/lib/server/external-fetch-guard.ts");
  const guardScopes = [...(guard.match(/EXTERNAL_FETCH_LIMITS: Record<[\s\S]*?> = \{([\s\S]*?)\n\};/)?.[1] ?? "").matchAll(/^\s*"?([a-z-]+)"?: \{/gm)].map((x) => x[1]);
  check("guardExternalFetch の scope を拾えている (4 つ以上)", guardScopes.length >= 4, true);
  check("guardExternalFetch の scope に attendance-summary が無い (器が重ならない)", guardScopes.includes("attendance-summary"), false);
  check("guardExternalFetch は `action-${scope}` の形で器を作る (上の確かめの前提)", /checkRateLimit\(`action-\$\{scope\}`/.test(guard), true);
}

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
