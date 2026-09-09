/**
 * セットアップの環境変数表の検証 (L-23、2026-09-09)。
 * 実行: `node scripts/check-setup-env.mjs`
 *
 * `scripts/setup-env-spec.mjs` (対話式セットアップと診断が見る表) と
 * `.env.local.example` (人が読むテンプレ) は**同じ変数を指していないと
 * いけない**。片方だけに変数が足されると:
 *
 *   - example にだけある → setup が聞かないので、fork した人が存在に気付けない
 *   - spec にだけある   → setup が書いた行がテンプレのコメントから外れて、
 *                         何のための値か分からなくなる
 *
 * どちらも「動かないわけではないが、後から誰も気付けない」ズレなので、
 * ここで固定する。値の検証関数 (URL / キー / snowflake の形) も、
 * 実際に落ちる入力で確かめる。
 */
import { readFileSync } from "node:fs";
import { ALL, REQUIRED, OPTIONAL, mask, parseEnvText } from "./setup-env-spec.mjs";

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

console.log(".env.local.example との突き合わせ");

const exampleText = readFileSync(".env.local.example", "utf8");
const exampleKeys = [
  ...exampleText.matchAll(/^([A-Za-z_][A-Za-z0-9_]*)=/gm),
].map((m) => m[1]);
const specKeys = ALL.map((s) => s.key);

// example にしか無い変数 (setup が聞かない)
const onlyExample = exampleKeys.filter((k) => !specKeys.includes(k));
// spec にしか無い変数 (テンプレに置き場が無い)
const onlySpec = specKeys.filter((k) => !exampleKeys.includes(k));

check("example にしか無い変数は無い", onlyExample, []);
check("spec にしか無い変数は無い", onlySpec, []);
check("重複した key が無い", specKeys.length, new Set(specKeys).size);

console.log("\n表の中身");
check("必須は 5 つ", REQUIRED.length, 5);
check(
  "必須は全部そろっている",
  REQUIRED.map((s) => s.key),
  [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "DISCORD_BOT_TOKEN",
    "DISCORD_GUILD_ID",
  ],
);
check(
  "説明と取得元が全部埋まっている",
  ALL.filter((s) => !s.label || !s.hint || !s.where).map((s) => s.key),
  [],
);
// ⚠ 秘密の値に NEXT_PUBLIC_ が付いていたら、ブラウザのバンドルに載る。
check(
  "秘密の値に NEXT_PUBLIC_ が付いていない",
  ALL.filter((s) => s.secret && s.key.startsWith("NEXT_PUBLIC_")).map((s) => s.key),
  [],
);
check(
  "service_role / Bot トークンは秘密扱い",
  ["SUPABASE_SERVICE_ROLE_KEY", "DISCORD_BOT_TOKEN"].map(
    (k) => ALL.find((s) => s.key === k)?.secret === true,
  ),
  [true, true],
);
check(
  "anon キーは秘密扱いではない (公開前提)",
  OPTIONAL.concat(REQUIRED).find((s) => s.key === "NEXT_PUBLIC_SUPABASE_ANON_KEY")
    ?.secret === true,
  false,
);

console.log("\n値の検証");
const v = (key, value) => ALL.find((s) => s.key === key)?.validate?.(value) === null;
check(
  "Supabase URL",
  [
    v("NEXT_PUBLIC_SUPABASE_URL", "https://abcdefg.supabase.co"),
    v("NEXT_PUBLIC_SUPABASE_URL", "https://abcdefg.supabase.co/"),
    v("NEXT_PUBLIC_SUPABASE_URL", "http://abcdefg.supabase.co"),
    v("NEXT_PUBLIC_SUPABASE_URL", "abcdefg.supabase.co"),
    v("NEXT_PUBLIC_SUPABASE_URL", "https://example.com"),
  ],
  [true, true, false, false, false],
);
check(
  "Supabase キー (JWT と新形式の両方)",
  [
    v("NEXT_PUBLIC_SUPABASE_ANON_KEY", "eyJhbGciOiJIUzI1NiJ9.x.y"),
    v("NEXT_PUBLIC_SUPABASE_ANON_KEY", "sb_publishable_abc"),
    v("SUPABASE_SERVICE_ROLE_KEY", "sb_secret_abc"),
    v("SUPABASE_SERVICE_ROLE_KEY", "not-a-key"),
  ],
  [true, true, true, false],
);
check(
  "Discord のサーバー ID (snowflake)",
  [
    v("DISCORD_GUILD_ID", "123456789012345678"),
    v("DISCORD_GUILD_ID", "12345"),
    v("DISCORD_GUILD_ID", "12345678901234567a"),
  ],
  [true, false, false],
);
check(
  "Bot トークン (ドット 3 分割)",
  [v("DISCORD_BOT_TOKEN", "aaa.bbb.ccc"), v("DISCORD_BOT_TOKEN", "aaa.bbb")],
  [true, false],
);
check(
  "ロール ID はカンマ区切り (空も可)",
  [
    v("DISCORD_ADMIN_ROLE_IDS", ""),
    v("DISCORD_ADMIN_ROLE_IDS", "123456789012345678,123456789012345679"),
    v("DISCORD_ADMIN_ROLE_IDS", "123456789012345678, abc"),
  ],
  [true, true, false],
);
check(
  "暗号化キーは 64 文字の 16 進",
  [
    v("SECRET_ENCRYPTION_KEY", "a".repeat(64)),
    v("SECRET_ENCRYPTION_KEY", "A".repeat(64)),
    v("SECRET_ENCRYPTION_KEY", "a".repeat(63)),
    v("SECRET_ENCRYPTION_KEY", ""),
  ],
  [true, false, false, true],
);

console.log("\n.env の読み取り");
check(
  "引用符と export を剥がす",
  parseEnvText(
    ['export FOO="bar baz"', "QUX='1'", "# comment", "", "EMPTY=", "BAD LINE"].join("\n"),
  ),
  { FOO: "bar baz", QUX: "1", EMPTY: "" },
);
check(
  "値の中の = を落とさない",
  parseEnvText("URL=https://x.co/?a=1&b=2").URL,
  "https://x.co/?a=1&b=2",
);

console.log("\n伏せ字");
check("短い値は全部伏せる", mask("abcd"), "****");
check("空は未設定と出す", mask(""), "(未設定)");
check(
  "長い値は先頭 4 文字だけ",
  mask("abcdefghijklmn"),
  "abcd…mn (14 文字)",
);

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
