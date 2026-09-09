/**
 * セットアップ診断 (L-23、2026-09-09)。実行: `npm run doctor`
 *
 * 「設定したのにログインできない」を**推測ではなく実測で切り分ける**ための
 * スクリプト。README の手順を上から見直す代わりに、実際に Supabase と
 * Discord を叩いて、どこで止まっているかを 1 画面に出す。
 *
 * ## 見るもの
 *
 *   1. 必須の環境変数が揃っているか / 形が正しいか
 *   2. 公開してはいけない値に `NEXT_PUBLIC_` が付いていないか
 *   3. Supabase に届くか (anon キー) + Discord ログインが有効か
 *   4. schema.sql が流れているか (主要テーブルの有無)
 *   5. Bot トークンが生きているか / Bot がサーバーに居るか
 *   6. SERVER MEMBERS INTENT が ON か (メンバー一覧を実際に 1 件引く)
 *   7. (任意) 公開済みサイトが応答するか (`--url https://…`)
 *
 * ## 方針
 *
 * ⚠ **秘密の値は画面に出さない。** 先頭 4 文字だけ見せる (`mask`)。
 * ⚠ **「たぶん大丈夫」を ✅ にしない。** 確かめられないものは ⚠ (要確認) に
 *   落として、何を見れば分かるかを書く。
 * ⚠ 1 つ落ちても最後まで走る (最初の失敗で止まると 2 周目が必要になる)。
 * ⚠ **関数として export する。** `setup.mjs` から子プロセスで呼ぶと、
 *   Windows で stdin の受け渡しに失敗して libuv が
 *   `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` を吐いた (実測)。
 *   同じプロセス内で呼べばその問題自体が無くなる。
 *
 * 使い方:
 *   node scripts/doctor.mjs                     # .env.local を見る
 *   node scripts/doctor.mjs --env .env.prod     # 別のファイル
 *   node scripts/doctor.mjs --url https://xxx   # 公開済みサイトも叩く
 */
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { REQUIRED, OPTIONAL, mask, parseEnvText } from "./setup-env-spec.mjs";

/** 10 秒で打ち切る fetch (ネットワークが死んでいるときに固まらせない)。 */
async function get(url, headers) {
  try {
    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    let body = null;
    try {
      body = await res.json();
    } catch {
      // JSON でない応答 (HTML のエラーページ等) は body なしで扱う
    }
    return { status: res.status, body };
  } catch (e) {
    return {
      status: 0,
      body: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * 診断本体。`{ bad, warn }` を返す (bad > 0 なら設定に問題あり)。
 * 画面出力はここで完結させる (呼び出し側は終了コードだけ決めればよい)。
 */
export async function runDoctor({ envPath = ".env.local", siteUrl } = {}) {
  let bad = 0;
  let warn = 0;
  const ok = (label, detail) =>
    console.log(`  ✅ ${label}${detail ? ` — ${detail}` : ""}`);
  const ng = (label, detail, fix) => {
    bad += 1;
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`);
    if (fix) console.log(`     → ${fix}`);
  };
  const warning = (label, detail, fix) => {
    warn += 1;
    console.log(`  ⚠️  ${label}${detail ? ` — ${detail}` : ""}`);
    if (fix) console.log(`     → ${fix}`);
  };

  // ---- 1. 環境変数 ---------------------------------------------------------
  console.log("\n環境変数");

  /** @type {Record<string,string>} */
  let env = {};
  if (existsSync(envPath)) {
    env = parseEnvText(readFileSync(envPath, "utf8"));
    ok(`${envPath} を読みました`, `${Object.keys(env).length} 件`);
  } else {
    // Vercel / CI では process.env に入っている
    env = { ...process.env };
    warning(
      `${envPath} がありません`,
      "process.env を見ます",
      "ローカルで設定するなら `npm run setup` を実行してください",
    );
  }

  for (const spec of REQUIRED) {
    const v = (env[spec.key] ?? "").trim();
    if (v === "") {
      ng(spec.key, "未設定", `${spec.where} から取得して設定してください`);
      continue;
    }
    const err = spec.validate?.(v);
    if (err) ng(spec.key, err, spec.where);
    // 公開してよい値でも、長いもの (anon キーは 200 文字超) はそのまま出すと
    // 画面が埋まって他の行が読めなくなるので潰す。
    else ok(spec.key, spec.secret || v.length > 60 ? mask(v) : v);
  }

  // 公開してはいけない値に NEXT_PUBLIC_ が付いていないか (バンドルに載る)
  for (const spec of [...REQUIRED, ...OPTIONAL]) {
    if (!spec.secret) continue;
    const leaked = `NEXT_PUBLIC_${spec.key}`;
    if ((env[leaked] ?? "").trim() !== "") {
      ng(
        leaked,
        "秘密の値に NEXT_PUBLIC_ が付いています",
        "この変数はブラウザに配信されます。削除して、接頭辞なしの名前で設定し直してください",
      );
    }
  }

  const supabaseUrl = (env.NEXT_PUBLIC_SUPABASE_URL ?? "")
    .trim()
    .replace(/\/$/, "");
  const anonKey = (env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();
  const serviceKey = (env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  const botToken = (env.DISCORD_BOT_TOKEN ?? "").trim();
  const guildId = (env.DISCORD_GUILD_ID ?? "").trim();

  if (anonKey !== "" && anonKey === serviceKey) {
    ng(
      "anon キーと service_role キーが同じ",
      "貼り間違いです",
      "Supabase → Settings → API で 2 つの行を見比べて、別々の値を設定してください",
    );
  }

  if ((env.DISCORD_ADMIN_ROLE_IDS ?? "").trim() === "") {
    warning(
      "DISCORD_ADMIN_ROLE_IDS が未設定",
      "サーバーのメンバー全員が編集できます",
      "幹部だけに絞るならロール ID を設定してください (後からでも可)",
    );
  }

  // ---- 2. Supabase ---------------------------------------------------------
  console.log("\nSupabase");

  if (supabaseUrl === "" || anonKey === "") {
    ng("接続確認", "URL か anon キーが無いので試せません");
  } else {
    // ⚠ **`/rest/v1/` のルートで疎通確認をしない。** anon キーでは 401 になる
    // (Supabase の応答: "Only the `service_role` API key can be used for this")。
    // 実測せずにここを疎通確認に使うと、正しい設定を「キーが違う」と誤診する
    // (実際に一度そう出た)。`/auth/v1/settings` は anon キーで 200 が返り、
    // Discord ログインの有効・無効も同じ応答に入っているので 1 回で 2 つ分かる。
    const settings = await get(`${supabaseUrl}/auth/v1/settings`, {
      apikey: anonKey,
    });
    if (settings.status === 200) {
      ok("API に届きました", supabaseUrl);
      if (settings.body?.external?.discord === true) {
        ok("Discord ログインが有効");
      } else {
        ng(
          "Discord ログインが無効",
          "Supabase 側で Discord provider が OFF です",
          "Supabase → Authentication → Providers → Discord を ON にし、Client ID / Secret を貼ってください",
        );
      }
    } else if (settings.status === 401) {
      ng(
        "anon キーが拒否されました",
        "HTTP 401",
        "Settings → API の anon public をもう一度コピーしてください",
      );
    } else if (settings.status === 0) {
      ng(
        "API に届きません",
        settings.error,
        "URL の綴りと、プロジェクトが一時停止していないかを確認してください",
      );
    } else {
      warning(
        "ログイン設定を読めません",
        `HTTP ${settings.status}`,
        "Supabase → Authentication → Providers を目視で確認してください",
      );
    }

    // schema.sql が流れているか (主要テーブルを service_role で 1 行だけ引く)
    const tables = [
      "app_settings",
      "categories",
      "category_links",
      "native_schedule_sessions",
      "schedule_session_memos",
    ];
    if (serviceKey === "") {
      ng("スキーマ確認", "service_role キーが無いので試せません");
    } else if (settings.status === 0) {
      // 届いていないので「未適用」とは言えない (原因を取り違えない)
      warning("スキーマ確認", "Supabase に届かないので試せません");
    } else {
      const missing = [];
      let failed = null;
      for (const t of tables) {
        const r = await get(`${supabaseUrl}/rest/v1/${t}?select=*&limit=1`, {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
        });
        if (r.status === 200) continue;
        // PostgREST は未作成のテーブルを 404 (PGRST205) で返す
        if (r.status === 404) missing.push(t);
        else failed = `${t}: HTTP ${r.status}`;
      }
      if (failed) {
        ng(
          "スキーマ確認",
          failed,
          "service_role キーが正しいか確認してください",
        );
      } else if (missing.length > 0) {
        ng(
          "schema.sql が未適用",
          `見つからないテーブル: ${missing.join(", ")}`,
          "Supabase → SQL Editor で supabase/schema.sql を実行 (または `npm run setup` のスキーマの手順)",
        );
      } else {
        ok("schema.sql 適用済み", `${tables.length} 個の主要テーブルを確認`);
      }
    }
  }

  // ---- 3. Discord ----------------------------------------------------------
  console.log("\nDiscord");

  if (botToken === "") {
    ng("Bot の確認", "DISCORD_BOT_TOKEN が無いので試せません");
  } else {
    const headers = { Authorization: `Bot ${botToken}` };
    const me = await get("https://discord.com/api/v10/users/@me", headers);
    if (me.status === 200) {
      ok(
        "Bot トークンは有効",
        `${me.body?.username ?? "?"} (id ${me.body?.id ?? "?"})`,
      );
    } else if (me.status === 401) {
      ng(
        "Bot トークンが無効",
        "HTTP 401",
        "Developer Portal → Bot → Reset Token で作り直して設定し直してください",
      );
    } else {
      ng(
        "Bot トークンの確認に失敗",
        `HTTP ${me.status}${me.error ? ` (${me.error})` : ""}`,
      );
    }

    if (guildId === "") {
      ng("サーバー在籍の確認", "DISCORD_GUILD_ID が無いので試せません");
    } else if (me.status === 200) {
      const g = await get(
        `https://discord.com/api/v10/guilds/${guildId}`,
        headers,
      );
      if (g.status === 200) {
        ok("Bot はサーバーに居ます", g.body?.name ?? guildId);
      } else if (g.status === 403 || g.status === 404) {
        ng(
          "Bot がサーバーに居ません",
          `HTTP ${g.status}`,
          "Developer Portal → OAuth2 → URL Generator で scope=bot の招待 URL を作り、サーバーに入れてください",
        );
      } else {
        ng("サーバー確認に失敗", `HTTP ${g.status}`);
      }

      // SERVER MEMBERS INTENT: 実際にメンバーを 1 件引いて確かめる
      const mem = await get(
        `https://discord.com/api/v10/guilds/${guildId}/members?limit=1`,
        headers,
      );
      if (mem.status === 200) {
        ok("SERVER MEMBERS INTENT が有効", "メンバー一覧を取得できました");
      } else if (mem.status === 403) {
        ng(
          "メンバー一覧を取得できません",
          "HTTP 403",
          "Developer Portal → Bot → Privileged Gateway Intents の SERVER MEMBERS INTENT を ON にしてください (ここが OFF だと誰もログインできません)",
        );
      } else if (mem.status !== 0) {
        warning("メンバー一覧の確認が不明", `HTTP ${mem.status}`);
      }
    }
  }

  // ---- 4. 公開済みサイト (任意) --------------------------------------------
  if (siteUrl) {
    console.log("\n公開済みサイト");
    const base = siteUrl.replace(/\/$/, "");
    const res = await get(`${base}/login`);
    if (res.status === 200) ok("ログイン画面が表示できます", `${base}/login`);
    else if (res.status === 0)
      ng(
        "サイトに届きません",
        res.error,
        "URL とデプロイの状態を確認してください",
      );
    else warning("ログイン画面の応答が想定外", `HTTP ${res.status}`);

    console.log(
      "  ℹ️  ログイン後の戻り先 (Supabase → Authentication → URL Configuration) は\n" +
        "     API から確認できません。次の 2 つが入っているか目視で確認してください:\n" +
        `       Site URL:      ${base}\n` +
        `       Redirect URLs: ${base}/auth/callback と http://localhost:3000/auth/callback`,
    );
  }

  // ---- まとめ --------------------------------------------------------------
  console.log("");
  if (bad > 0) {
    console.log(
      `❌ ${bad} 件の問題があります${warn > 0 ? ` (ほかに要確認 ${warn} 件)` : ""}。上の → を順に潰してください。`,
    );
  } else if (warn > 0) {
    console.log(`✅ 必須の設定は揃っています (要確認 ${warn} 件)。`);
  } else {
    console.log("✅ すべて問題ありません。");
  }

  return { bad, warn };
}

// CLI として直接呼ばれたときだけ走らせる (import されたときは何もしない)。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const argValue = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const { bad } = await runDoctor({
    envPath: argValue("--env") ?? ".env.local",
    siteUrl: argValue("--url"),
  });
  process.exit(bad > 0 ? 1 : 0);
}
