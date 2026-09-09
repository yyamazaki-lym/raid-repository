/**
 * セットアップで扱う環境変数の一覧 (L-23、2026-09-09)。
 *
 * `scripts/setup.mjs` (対話式セットアップ) と `scripts/doctor.mjs` (診断) が
 * **同じ表**を見るための唯一の出どころ。`.env.local.example` との食い違いは
 * `scripts/check-setup-env.mjs` が CI で検出する。
 *
 * ⚠ **値の説明はここに 1 回だけ書く。** setup と doctor と README の 3 箇所に
 * 同じ説明を書くと、必ずどれかが古くなる (実際、旧 README の環境変数の表は
 * `.env.local.example` と既にずれていた)。
 *
 * ⚠ **`NEXT_PUBLIC_` を付けてよいのは公開してよい値だけ。** `secret: true` の
 * 変数に付けるとブラウザのバンドルに入る。doctor がそれを検出する。
 */

/** @typedef {{key: string, label: string, hint: string, where: string, secret?: boolean, example?: string, validate?: (v: string) => string | null}} EnvVar */

/** URL が `https://<ref>.supabase.co` の形か。 */
function validateSupabaseUrl(v) {
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(v)) {
    return "https://<プロジェクト ref>.supabase.co の形で入れてください";
  }
  return null;
}

/** Supabase の API キーは JWT (`eyJ...`) か、新形式の `sb_publishable_` / `sb_secret_`。 */
function validateSupabaseKey(v) {
  if (/^eyJ[A-Za-z0-9_-]/.test(v) || /^sb_(publishable|secret)_/.test(v)) return null;
  return "Supabase の API キー (eyJ… または sb_… で始まる) を入れてください";
}

/** Discord の ID は 17〜20 桁の数字 (snowflake)。 */
function validateSnowflake(v) {
  if (!/^\d{17,20}$/.test(v)) return "Discord の ID は 17〜20 桁の数字です";
  return null;
}

/** Bot トークンは `<base64 の app id>.<6 文字>.<残り>` の 3 部構成。 */
function validateBotToken(v) {
  if (v.split(".").length !== 3) {
    return "Bot トークンの形ではありません (ドット区切りで 3 つ)";
  }
  return null;
}

/** カンマ区切りの snowflake (空文字は許可)。 */
function validateRoleIds(v) {
  if (v.trim() === "") return null;
  const bad = v
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "" && !/^\d{17,20}$/.test(s));
  return bad.length > 0 ? `ロール ID の形ではない値: ${bad.join(", ")}` : null;
}

/** 必須 5 つ。これが揃っていないとログインすら通らない。 */
/** @type {EnvVar[]} */
export const REQUIRED = [
  {
    key: "NEXT_PUBLIC_SUPABASE_URL",
    label: "Supabase の Project URL",
    hint: "DB への接続先。ブラウザからも使うので公開されます",
    where: "Supabase → Settings → API → Project URL",
    example: "https://abcdefghijklm.supabase.co",
    validate: validateSupabaseUrl,
  },
  {
    key: "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    label: "Supabase の anon キー",
    hint: "読み取り用。書き込みは RLS で止まるので公開されて問題ありません",
    where: "Supabase → Settings → API → anon public",
    validate: validateSupabaseKey,
  },
  {
    key: "SUPABASE_SERVICE_ROLE_KEY",
    label: "Supabase の service_role キー",
    hint: "RLS を飛び越える全権キー。ログイン時に Discord の所属をユーザーに書き込むために使います",
    where: "Supabase → Settings → API → service_role",
    secret: true,
    validate: validateSupabaseKey,
  },
  {
    key: "DISCORD_BOT_TOKEN",
    label: "Discord Bot のトークン",
    hint: "「この Discord サーバーのメンバーか」を判定する入口。これが無いと誰もログインできません",
    where: "Discord Developer Portal → Bot → Reset Token",
    secret: true,
    validate: validateBotToken,
  },
  {
    key: "DISCORD_GUILD_ID",
    label: "Discord サーバー ID",
    hint: "このサーバーのメンバーだけがポータルに入れます",
    where: "Discord (開発者モード ON) → サーバーアイコンを右クリック → サーバー ID をコピー",
    example: "123456789012345678",
    validate: validateSnowflake,
  },
];

/** 任意。無くても動くが、入れると機能が増えるもの。 */
/** @type {EnvVar[]} */
export const OPTIONAL = [
  {
    key: "DISCORD_ADMIN_ROLE_IDS",
    label: "管理者にする Discord ロール ID (カンマ区切り)",
    hint: "未設定だと**メンバー全員が編集できます**。幹部だけに絞るなら入れてください",
    where: "Discord → サーバー設定 → ロール → 右クリック → ロール ID をコピー",
    validate: validateRoleIds,
  },
  {
    key: "CRON_SECRET",
    label: "定期実行の合言葉 (32 文字以上のランダム)",
    hint: "Discord 自動取り込みなどの定期実行に必要。setup で自動生成できます",
    where: "自分で決める (setup が生成します)",
    secret: true,
  },
  {
    key: "SECRET_ENCRYPTION_KEY",
    label: "保存する秘密の暗号化キー (64 文字の 16 進)",
    hint: "FFLogs のトークンを暗号化して保管します。未設定だと平文で保存されます",
    where: "自分で決める (setup が生成します)",
    secret: true,
    validate: (v) =>
      v.trim() === "" || /^[0-9a-f]{64}$/.test(v.trim())
        ? null
        : "64 文字の 16 進 (0-9a-f) で入れてください",
  },
  {
    key: "YOUTUBE_API_KEY",
    label: "YouTube Data API v3 のキー",
    hint: "限定公開動画の長さ・投稿日を取るのに使います",
    where: "Google Cloud Console → API とサービス",
    secret: true,
  },
  {
    key: "FFLOGS_API_KEY",
    label: "FFLogs API v1 のキー",
    hint: "練習ログの取り込みと、レポートと動画の自動突き合わせに使います",
    where: "FFLogs → アカウント → Web API",
    secret: true,
  },
  {
    key: "FFLOGS_OAUTH_CLIENT_ID",
    label: "FFLogs OAuth の Client ID",
    hint: "Private / Unlisted のレポートを扱うときだけ必要",
    where: "https://www.fflogs.com/api/clients/",
  },
  {
    key: "FFLOGS_OAUTH_CLIENT_SECRET",
    label: "FFLogs OAuth の Client Secret",
    hint: "同上 (サーバー側だけで使います)",
    where: "https://www.fflogs.com/api/clients/",
    secret: true,
  },
];

/**
 * 診断・セットアップで扱う全変数。
 *
 * ⚠ **ここに無い変数も `.env.local` には入りうる** (`PUBLIC_DEMO_MODE` /
 * `DEV_AUTH_BYPASS` / `NEXT_PUBLIC_SPLASH_SW` のような、既定では書かない
 * 切替スイッチ)。`setup.mjs` は既存ファイルの**知らない行もそのまま残す**。
 */
export const ALL = [...REQUIRED, ...OPTIONAL];

/**
 * `.env` 形式のテキストを `{key: value}` に読む。
 *
 * ⚠ **`export ` 前置きと引用符を剥がす。** Vercel からコピーした値や
 * `vercel env pull` の出力は `KEY="value"` の形で来ることがあり、剥がさないと
 * 引用符ごと値として扱ってしまう。
 */
export function parseEnvText(text) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (
      (v.startsWith('"') && v.endsWith('"') && v.length >= 2) ||
      (v.startsWith("'") && v.endsWith("'") && v.length >= 2)
    ) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return out;
}

/** 画面に出してよい形に潰す (先頭 4 文字だけ残す)。 */
export function mask(value) {
  if (!value) return "(未設定)";
  if (value.length <= 8) return "****";
  return `${value.slice(0, 4)}…${value.slice(-2)} (${value.length} 文字)`;
}
