/**
 * 対話式セットアップ (L-23、2026-09-09)。実行: `npm run setup`
 *
 * 「README を上から読みながら 10 ステップ」を、**手で集める値は 5 つだけ**に
 * 減らすためのスクリプト。聞いた値を検証して `.env.local` に書き、続けて
 * スキーマの適用と診断まで走らせる。
 *
 * ## 自動化できないもの (ここは人がブラウザでやる)
 *
 *   - Supabase プロジェクトの作成
 *   - Discord Application / Bot の作成と intent の ON
 *   - Supabase の Authentication 設定 (Discord provider / URL Configuration)
 *
 * どれも Web ダッシュボードにしか口が無い。**「自動でやります」と書いて
 * 実際にはやらない**ことをしないよう、この 3 つは画面で明示して案内する。
 *
 * ## 方針
 *
 * ⚠ **既存の `.env.local` を黙って上書きしない。** 既存値は既定値として出し、
 *   Enter で維持できるようにする。
 * ⚠ **秘密の値を画面に出さない** (`mask`)。入力中の表示も伏せる。
 * ⚠ **コメントごとテンプレを引き継ぐ。** `.env.local.example` の説明文は
 *   後から読み返す資料なので、値だけ差し替えて残す。
 * ⚠ 対話できない環境 (CI・パイプ) では**何も書かずに**使い方だけ出して終わる。
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { REQUIRED, OPTIONAL, mask, parseEnvText } from "./setup-env-spec.mjs";

const ENV_PATH = ".env.local";
const EXAMPLE_PATH = ".env.local.example";

if (!stdin.isTTY) {
  console.log(
    [
      "npm run setup は対話式です。ターミナルから直接実行してください。",
      "",
      "自動化したい場合は .env.local を手で用意して、",
      "  npm run doctor",
      "で設定が正しいか確認できます。",
    ].join("\n"),
  );
  process.exit(0);
}

const rl = createInterface({ input: stdin, output: stdout });

/**
 * 1 行読む。
 *
 * ⚠ **`rl.question()` を使わない。** Node 24 では **パイプで渡した入力だと
 * 2 回目以降が永久に解決しない** (最小再現あり: 3 問聞くスクリプトに
 * `printf 'a\nb\nc\n' |` で流すと 1 問目で止まる)。行イテレータなら端末
 * でもパイプでも同じように読めるので、こちらに統一する。**これは検証の
 * ためだけの選択ではなく**、手順を流し込んで確かめられる形にしておくための
 * 選択でもある。
 *
 * 入力が尽きたら `null` を返す (呼び出し側が既定値に倒す)。
 */
const lines = rl[Symbol.asyncIterator]();
async function readLine(promptText) {
  stdout.write(promptText);
  const { value, done } = await lines.next();
  if (done) {
    stdout.write("\n");
    return null;
  }
  return value;
}

function hr(title) {
  console.log(`\n${"─".repeat(60)}\n${title}\n${"─".repeat(60)}`);
}

/** はい / いいえ。既定は yes。入力が尽きたら既定値。 */
async function confirm(question, defaultYes = true) {
  const suffix = defaultYes ? "[Y/n]" : "[y/N]";
  const raw = await readLine(`${question} ${suffix} `);
  if (raw === null) return defaultYes;
  const a = raw.trim().toLowerCase();
  if (a === "") return defaultYes;
  return a === "y" || a === "yes";
}

/**
 * 1 つの変数を聞く。空 Enter は「既定値のまま」。
 * 検証に落ちたら理由を出して聞き直す (3 回で諦めて空のまま進む)。
 */
async function ask(spec, current) {
  console.log(`\n▸ ${spec.label}`);
  console.log(`  ${spec.hint}`);
  console.log(`  取得元: ${spec.where}`);
  if (spec.example) console.log(`  例: ${spec.example}`);
  const shown = current ? (spec.secret ? mask(current) : current) : "";
  for (let i = 0; i < 3; i += 1) {
    const prompt = shown ? `  値 (Enter で「${shown}」のまま): ` : "  値: ";
    const line = await readLine(prompt);
    if (line === null) return current ?? "";
    const raw = line.trim();
    if (raw === "") return current ?? "";
    const err = spec.validate?.(raw);
    if (!err) return raw;
    console.log(`  ⚠️  ${err}`);
  }
  console.log("  → 3 回とも形が合わなかったので空のままにします (あとで直せます)");
  return current ?? "";
}

/** コマンドがあるか (Windows でも動くよう spawnSync で素直に試す)。 */
function has(cmd) {
  const r = spawnSync(cmd, ["--version"], { stdio: "ignore", shell: true });
  return r.status === 0;
}

/** `.env` の 1 行として安全な形にする (空白 / # を含む値は引用する)。 */
function envLine(key, value) {
  if (value === "") return `${key}=`;
  return /[\s#"']/.test(value) ? `${key}="${value.replace(/"/g, '\\"')}"` : `${key}=${value}`;
}

// ---------------------------------------------------------------------------

hr("Raid Repository セットアップ");
console.log(
  [
    "手で集める値は 5 つだけです。先に次の 3 つをブラウザで済ませてください:",
    "",
    "  1. Supabase でプロジェクトを作る         https://supabase.com/dashboard",
    "  2. Discord で Application + Bot を作る   https://discord.com/developers/applications",
    "     - Bot → Privileged Gateway Intents の SERVER MEMBERS INTENT を ON",
    "       (MESSAGE CONTENT INTENT も ON にすると Discord 自動取り込みが使えます)",
    "  3. Supabase → Authentication → Providers → Discord を ON にして",
    "     Discord の Client ID / Client Secret を貼る",
    "",
    "詳しい画面の場所は docs/setup.md にあります。",
  ].join("\n"),
);

if (!(await confirm("\n続けますか?"))) {
  rl.close();
  process.exit(0);
}

/** 既存値 (あれば既定値として使う)。 */
const current = existsSync(ENV_PATH) ? parseEnvText(readFileSync(ENV_PATH, "utf8")) : {};
if (existsSync(ENV_PATH)) {
  console.log(`\n既存の ${ENV_PATH} を読みました。Enter を押すと今の値を残します。`);
}

hr("必須の 5 つ");
/** @type {Record<string,string>} */
const values = {};
for (const spec of REQUIRED) {
  values[spec.key] = await ask(spec, current[spec.key]);
}

hr("任意の設定");

const adminSpec = OPTIONAL.find((o) => o.key === "DISCORD_ADMIN_ROLE_IDS");
console.log(
  "\n管理者ロールを設定しないと、**サーバーのメンバー全員がコンテンツを編集できます**。",
);
if (await confirm("管理者ロールを設定しますか?", false)) {
  values.DISCORD_ADMIN_ROLE_IDS = await ask(adminSpec, current.DISCORD_ADMIN_ROLE_IDS);
} else {
  values.DISCORD_ADMIN_ROLE_IDS = current.DISCORD_ADMIN_ROLE_IDS ?? "";
}

// ランダムで良いものは、その場で作る (人が考える必要が無い)
for (const [key, gen, label] of [
  ["CRON_SECRET", () => randomBytes(24).toString("base64url"), "定期実行の合言葉"],
  [
    "SECRET_ENCRYPTION_KEY",
    () => randomBytes(32).toString("hex"),
    "保存する秘密の暗号化キー",
  ],
]) {
  if ((current[key] ?? "").trim() !== "") {
    values[key] = current[key];
    console.log(`\n▸ ${label} — 既存の値を残します (${mask(current[key])})`);
    continue;
  }
  if (await confirm(`\n▸ ${label} (${key}) を自動生成しますか?`)) {
    values[key] = gen();
    console.log(`  生成しました: ${mask(values[key])}`);
  } else {
    values[key] = "";
  }
}

// 残りの任意項目は既存値をそのまま引き継ぐ (ここで全部聞くと長すぎる)
for (const spec of OPTIONAL) {
  if (!(spec.key in values)) values[spec.key] = current[spec.key] ?? "";
}

// ⚠ **表に無い変数も必ず引き継ぐ。** `PUBLIC_DEMO_MODE` や `DEV_AUTH_BYPASS`
// のように、テンプレではコメントアウトされている切替スイッチを自分で
// 書き足している場合がある。ここで拾わないと上書き時に消える。
for (const [key, value] of Object.entries(current)) {
  if (!(key in values)) values[key] = value;
}

// ---- .env.local を書く -----------------------------------------------------
hr(`${ENV_PATH} を書きます`);

if (!existsSync(EXAMPLE_PATH)) {
  console.log(`❌ ${EXAMPLE_PATH} が見つかりません。リポジトリのルートで実行してください。`);
  rl.close();
  process.exit(1);
}

if (existsSync(ENV_PATH)) {
  if (!(await confirm(`${ENV_PATH} は既にあります。上書きしますか?`, false))) {
    console.log("→ 中止しました。既存のファイルはそのままです。");
    rl.close();
    process.exit(0);
  }
  // 上書き前に控えを残す (取り返しがつくようにする)
  const backup = `${ENV_PATH}.bak`;
  writeFileSync(backup, readFileSync(ENV_PATH));
  console.log(`  控えを ${backup} に残しました`);
}

// テンプレのコメントを保ったまま、値の行だけ差し替える
const written = new Set();
const body = readFileSync(EXAMPLE_PATH, "utf8")
  .split(/\r?\n/)
  .map((line) => {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=/);
    if (!m) return line;
    const key = m[1];
    if (!(key in values)) return line;
    written.add(key);
    return envLine(key, values[key]);
  })
  .join("\n");

const extra = Object.entries(values)
  .filter(([k, v]) => !written.has(k) && v !== "")
  .map(([k, v]) => envLine(k, v));

writeFileSync(
  ENV_PATH,
  extra.length > 0 ? `${body}\n# --- setup が追加 ---\n${extra.join("\n")}\n` : `${body}\n`,
  "utf8",
);
console.log(`✅ ${ENV_PATH} を書きました`);

// ---- スキーマ適用 ----------------------------------------------------------
hr("データベースのスキーマ");

console.log(
  [
    "テーブルを作る方法は 2 つあります。",
    "",
    "  A. このスクリプトから流す — Supabase の接続文字列 (Session pooler) が要ります",
    "  B. あとで Supabase の SQL Editor に supabase/schema.sql を貼る",
    "",
    "A は psql が入っている必要があります。",
  ].join("\n"),
);

const hasPsql = has("psql");
if (!hasPsql) {
  console.log(
    "\nℹ️  psql が見つかりませんでした → B (SQL Editor に貼る) で進めてください。",
  );
  console.log("   Supabase → SQL Editor → New query に supabase/schema.sql を全文貼って Run。");
} else if (await confirm("\nA (ここから流す) にしますか?", false)) {
  console.log(
    [
      "",
      "接続文字列の取り方:",
      "  Supabase → Settings → Database → Connection string → **Session pooler** タブ",
      "  (Direct connection は IPv6 のみで GitHub Actions から繋がらないので Session pooler)",
      "  URI の [YOUR-PASSWORD] をプロジェクト作成時の DB パスワードに置き換えてください",
    ].join("\n"),
  );
  const dbUrl = ((await readLine("\n  接続文字列: ")) ?? "").trim();
  if (dbUrl === "") {
    console.log("  → 空だったので飛ばします。");
  } else {
    console.log("  適用中…");
    const r = spawnSync(
      "psql",
      [dbUrl, "-v", "ON_ERROR_STOP=1", "--single-transaction", "-f", "supabase/schema.sql"],
      { stdio: "inherit", shell: true },
    );
    if (r.status === 0) {
      console.log("✅ スキーマを適用しました");
      // 以後の更新を自動化する導線 (gh があるときだけ提案する)
      if (has("gh") && (await confirm("\n今後の schema 更新を GitHub Actions に任せますか?"))) {
        const g = spawnSync("gh", ["secret", "set", "SUPABASE_DB_URL", "--body", dbUrl], {
          stdio: "inherit",
          shell: true,
        });
        if (g.status === 0) {
          console.log(
            "✅ GitHub secret SUPABASE_DB_URL を登録しました (以後 main への push で自動反映されます)",
          );
        } else {
          console.log(
            "⚠️  登録に失敗しました。GitHub → Settings → Secrets and variables → Actions から手動で登録できます。",
          );
        }
      }
    } else {
      console.log("❌ 適用に失敗しました。上のエラーを確認してください。");
      console.log("   接続文字列 (特にパスワード) と、Session pooler を選んでいるかを見直してください。");
    }
  }
}

// ---- 診断 ------------------------------------------------------------------
hr("設定を確認します (npm run doctor と同じ)");

// ⚠ **診断を子プロセスで呼ばない。** `stdio: "inherit"` で spawn すると
// Windows で libuv が `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`
// を吐いた (実測)。同じプロセス内で関数として呼べばその問題自体が無くなる。
rl.close();

const { runDoctor } = await import("./doctor.mjs");
const { bad } = await runDoctor({ envPath: ENV_PATH });

console.log(
  [
    "",
    "次にやること:",
    "  1. Vercel にデプロイする (README の「使い始める」を参照)",
    "  2. デプロイ後、Supabase → Authentication → URL Configuration に",
    "     Site URL と Redirect URLs を登録する (ここを忘れるとログイン後に戻れません)",
    "  3. `npm run doctor -- --url https://<自分のドメイン>` でもう一度確認する",
    "",
    "ローカルで動かすなら: npm install && npm run dev",
  ].join("\n"),
);

// ⚠ **`process.exit()` で落とさない。** stdin を閉じている最中に強制終了すると
// Windows で libuv のアサーションを踏む (実測)。終了コードだけ立てて、
// ハンドルが片付いてから自然に終わらせる。
process.exitCode = bad > 0 ? 1 : 0;
