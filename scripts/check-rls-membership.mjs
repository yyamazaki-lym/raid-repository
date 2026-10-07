/**
 * RLS がギルドのメンバーであること (と、書き込みでは確認の鮮度) を要求している
 * ことの検証 (2026-10-07 セキュリティ精査 H-1 / H-2)。
 * 実行: `node scripts/check-rls-membership.mjs`
 *
 * authenticated のトークンは Supabase Auth に直接ログインすれば誰でも取れるので、
 * RLS は「authenticated であること」や素の claim だけを信じてはいけない。
 * schema.sql 1 章の判定関数を全ポリシーが通すこと・アプリの TTL が DB の鮮度を
 * 超えないこと・失効を見つけたときに印を書き戻す配線・CI の表明を固定する。
 * 実行しての確認 (ロール別の読み書き・旧版からの流し直し・2 回流しての同一性) は
 * PR 本文に残す。
 */
import { readFileSync } from "node:fs";

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
const schema = read("supabase/schema.sql");
/** `CREATE OR REPLACE FUNCTION public.<name>()` から本文の終わり ("$$;") まで。 */
function fnText(name) {
  const at = schema.indexOf(`CREATE OR REPLACE FUNCTION public.${name}()`);
  if (at < 0) return { at, text: "" };
  const body = schema.indexOf("AS $$", at);
  return { at, text: schema.slice(at, schema.indexOf("$$;", body + 5) + 3) };
}

console.log("1. 判定の関数 (schema.sql 1 章)");
const member = fnText("is_portal_member");
const verified = fnText("is_portal_verified_member");
const admin = fnText("is_portal_admin");
check("3 つの関数がある", [member.at >= 0, verified.at >= 0, admin.at >= 0], [true, true, true]);
check(
  "読み取り (is_portal_member) は所属の印と discord_id を要求し、鮮度は見ない",
  [
    /'discord_guild_member'\) = 'true'/.test(member.text),
    /coalesce\(auth\.jwt\(\) -> 'app_metadata' ->> 'discord_id', ''\) <> ''/.test(member.text),
    /interval|verified_at/.test(member.text),
  ],
  [true, true, false],
);
check(
  "書き込み (is_portal_verified_member) はメンバーであることと確認時刻を要求する",
  [
    /IF NOT public\.is_portal_member\(\) THEN\s*RETURN false;/.test(verified.text),
    /'discord_member_verified_at'/.test(verified.text),
    /IF verified IS NULL THEN\s*RETURN false;/.test(verified.text),
  ],
  [true, true, true],
);
check("壊れた時刻は例外にせず false", /EXCEPTION WHEN others THEN\s*RETURN false;/.test(verified.text), true);
const reval = read("src/lib/server/membership-revalidation.ts");
const hours = Number(verified.text.match(/now\(\) - interval '(\d+) hours'/)?.[1]);
const freshnessHours = Number(reval.match(/export const RLS_WRITE_FRESHNESS_MS = (\d+) \* 60 \* 60 \* 1000;/)?.[1]);
check("鮮度はアプリの RLS_WRITE_FRESHNESS_MS と同じ時間", [hours, hours === freshnessHours], [freshnessHours, true]);
check(
  "is_portal_admin は確認済みのメンバーであることも要求する",
  /SELECT public\.is_portal_verified_member\(\)\s*AND coalesce\(\(auth\.jwt\(\) -> 'app_metadata' ->> 'is_admin'\) = 'true', false\)/.test(admin.text),
  true,
);
check(
  "関数は 1 章 (最初のポリシーより前) に定義する",
  [member.at, verified.at, admin.at].every((a) => a >= 0 && a < schema.indexOf("CREATE POLICY")),
  true,
);
check(
  "anon には配らない",
  ["is_portal_member", "is_portal_verified_member", "is_portal_admin"].map((f) =>
    schema.includes(`REVOKE EXECUTE ON FUNCTION public.${f}() FROM PUBLIC, anon;`),
  ),
  [true, true, true],
);

console.log("\n2. アプリの TTL が DB の鮮度を超えない");
check(
  "hard TTL は RLS_WRITE_FRESHNESS_MS を上限に抑える",
  /return Math\.min\(Math\.max\(hard, soft\), RLS_WRITE_FRESHNESS_MS\);/.test(reval),
  true,
);
check(
  "soft TTL は鮮度の 3 分の 1 を上限に抑える (DB が閉じる前に確かめ直す)",
  /envMs\("DISCORD_MEMBERSHIP_TTL_MS", DEFAULT_SOFT_TTL_MS\),\s*RLS_WRITE_FRESHNESS_MS \/ 3,/.test(reval),
  true,
);

console.log("\n3. ポリシー");
const rawAdmin = (schema.match(/'app_metadata' ->> 'is_admin'\) = 'true'/g) ?? []).length;
check("素の is_admin claim を見るのは is_portal_admin の中だけ", rawAdmin, 1);
check(
  "素の discord_id claim で本人を判定する箇所は、どれも確認済みのメンバー判定と組で使う",
  (() => {
    const lines = schema.split("\n");
    const bad = [];
    lines.forEach((l, i) => {
      if (!/\(\(SELECT auth\.jwt\(\)\) -> 'app_metadata' ->> 'discord_id'\)/.test(l)) return;
      const ctx = lines.slice(Math.max(0, i - 3), i + 1).join("\n");
      if (!/is_portal_verified_member\(\)/.test(ctx)) bad.push(i + 1);
    });
    return bad;
  })(),
  [],
);
check("SELECT の USING (true) は残っていない", /FOR SELECT TO %s USING \(true\)/.test(schema), false);
const selectBlocks = (schema.match(/select_using text := CASE\s*WHEN coalesce\(current_setting\('app\.public_demo', true\), ''\) = 'true'\s*THEN 'true'\s*ELSE '\(SELECT public\.is_portal_member\(\)\)'\s*END;/g) ?? []).length;
check("SELECT の 3 ブロックは本番でメンバー確認、公開デモだけ全行", selectBlocks, 3);
check("SELECT のポリシー 3 本が select_using を使う", (schema.match(/FOR SELECT TO %s USING \(%s\)',\s*[^)]*select_roles, select_using/g) ?? []).length, 3);
// 直書きの CREATE POLICY (コメントは除く)
const direct = schema
  .split("\n")
  .map((l, i) => ({ l, i }))
  .filter(({ l }) => /^\s*(EXECUTE format\(\s*)?'?\$?\$?(sql\$)?CREATE POLICY/.test(l) || /^\s*CREATE POLICY/.test(l));
const stmts = [...schema.matchAll(/^[ \t]*CREATE POLICY[\s\S]*?;/gm)].map((m) => m[0]);
check("直書きのポリシーは全部 TO 句でロールを絞る (TO 句なし = public 向けにしない)", stmts.filter((s) => !/\bTO\b/.test(s)).map((s) => s.split("\n")[0].trim().slice(0, 80)), []);
const unguarded = stmts.filter((s) => /TO (anon, )?authenticated/.test(s) && !/is_portal_/.test(s) && !/USING \(false\)/.test(s));
check("直書きの authenticated 向けポリシーは全部確認を通す", unguarded.map((s) => s.split("\n")[0].trim().slice(0, 80)), []);
check("(参考) 直書きのポリシー行が見つかる", direct.length > 0, true);
// 変数で組む書き込みポリシー (出欠・日付メモ)
for (const v of ["admin_or_self", "owner_or_admin", "owner_only"]) {
  const at = schema.indexOf(`  ${v} text :=`);
  const body = at < 0 ? "" : schema.slice(at, schema.indexOf(")$expr$;", at));
  check(
    `${v} の式は確認済みのメンバー判定を通す`,
    /is_portal_verified_member\(\)/.test(body) && !/is_portal_member\(\)/.test(body) && !/'is_admin'\) = 'true'/.test(body),
    true,
  );
}
const loopWrites = schema.match(/\$sql\$CREATE POLICY %I ON public\.%I FOR (INSERT|UPDATE|DELETE)[^$]*\$sql\$/g) ?? [];
check("ループの書き込み 3 本は is_portal_admin", loopWrites.map((s) => /\(SELECT public\.is_portal_admin\(\)\)/.test(s)), [true, true, true]);
check("Storage の書き込み 4 本は is_portal_admin", (schema.match(/AND \(SELECT public\.is_portal_admin\(\)\)/g) ?? []).length, 4);
check("DEFINER 関数の admin ゲートも is_portal_admin", /AND NOT public\.is_portal_admin\(\) THEN\s*RAISE EXCEPTION 'update_native_placeholder_raid_times: admin only'/.test(schema), true);

console.log("\n4. 失効の書き戻し");
const membership = read("src/lib/server/discord-membership.ts");
const markAt = membership.indexOf("export async function markGuildMembershipRevoked(");
const markBody = markAt < 0 ? "" : membership.slice(markAt, membership.indexOf("\n}\n", markAt));
check("印を false に書き戻す", /discord_guild_member: false,/.test(markBody) && /is_admin: false,/.test(markBody) && /discord_roles: \[\],/.test(markBody), true);
check("失敗しても例外を投げない (失効処理を止めない)", /catch \(e\) \{\s*console\.error\(/.test(markBody), true);
check("再確認: ギルドにいないと確定したときに書き戻す", /if \(membership\.reason === "not_in_guild"\) \{\s*\/\/[^\n]*\n\s*await markGuildMembershipRevoked\(userId, discordId\);\s*return \{ status: "revoked", reason: "not_in_guild" \};/.test(reval), true);
check("再確認: 一時障害では書き戻さない", (reval.match(/markGuildMembershipRevoked\(/g) ?? []).length, 1);
const callback = read("src/app/auth/callback/route.ts");
check("ログイン処理: ギルドにいないと確定したときに書き戻してから signOut", /if \(membership\.reason === "not_in_guild"\) \{\s*await markGuildMembershipRevoked\(data\.user\.id, discordId\);\s*\}\s*await supabase\.auth\.signOut\(\);/.test(callback), true);
const proxy = read("src/proxy.ts");
check("proxy: 確かめ直した後の refreshSession の失敗を記録する", /const \{ error: refreshError \} = await supabase\.auth\.refreshSession\(\);\s*if \(refreshError\) \{/.test(proxy), true);

console.log("\n5. CI の表明");
const wf = read(".github/workflows/deploy-database.yml");
check("本番のデプロイで、確認を通らない authenticated (と public) 向けのポリシーを 0 本と表明する", /name: Assert authenticated policies require guild membership/.test(wf) && /roles && '\{authenticated,public\}'::name\[\]/.test(wf) && /NOT LIKE '%is_portal_%'/.test(wf), true);
check("anon の表明も public 向けを数える", /roles && '\{anon,public\}'::name\[\]/.test(wf), true);

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
