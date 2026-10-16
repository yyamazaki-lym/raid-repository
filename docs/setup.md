# セットアップ手順 (詳細)

自分の固定で Raid Repository を動かすまでの手順。**所要 20〜40 分**。
README の「[使い始める](../README.md#使い始める)」を詳しくしたものです。

- 迷ったら **`npm run doctor`**。どこで止まっているかを機械が判定します
- 手で集める値は **6 つだけ** (必須 5 つ + 管理者ロール ID)。それ以外は `npm run setup` が用意します

> このリポジトリの[デモサイト](https://demo-raid-repository.vercel.app)は
> 「動いている様子を見せる」ためのもので、**自分の固定用に作る必要はありません**
> (作り方は [`demo-site.md`](demo-site.md) にありますが、通常は読まなくて大丈夫です)。

---

## 用意するもの

| | アカウント | 用途 | 費用 |
|---|---|---|---|
| 必須 | [GitHub](https://github.com) | リポジトリ | 無料 |
| 必須 | [Supabase](https://supabase.com) | データベース + リアルタイム同期 | 無料枠で足ります |
| 必須 | [Vercel](https://vercel.com) | 公開先 | Hobby 無料枠で足ります |
| 必須 | [Discord Developer](https://discord.com/developers/applications) | ログインの入口 (サーバー会員かの判定) | 無料 |

ローカルで `npm run setup` を使うなら **Node.js 20.9 以上** (推奨は CI と同じ 24)。

> ⚠ **Discord は「使わない」選択ができません。** このポータルは
> 「**指定した Discord サーバーのメンバーだけが入れる**」形で入口を守っています。
> Bot の作成は自動取り込みを使わない場合でも必須です。

---

## 集める値は 6 つ

| # | 値 | どこで取るか |
|---|---|---|
| 1 | Supabase の Project URL | Supabase → Settings → API |
| 2 | Supabase の anon キー | 同上 |
| 3 | Supabase の service_role キー | 同上 (⚠ ブラウザに出さない) |
| 4 | Discord Bot のトークン | Developer Portal → Bot → Reset Token |
| 5 | Discord サーバー ID | Discord (開発者モード) → サーバー右クリック → サーバー ID をコピー |
| 6 | 管理者ロール ID | Discord → サーバー設定 → ロール → 右クリック → ロール ID をコピー (手順 3-5) |

> ⚠ **6 (管理者ロール ID) を入れないと、誰もコンテンツの編集や ⚙️ の設定ができません。**
> 未設定は「全員が非 admin」として扱われます (安全側に倒しています)。自分が持っているロールの ID を入れてください。

以降はこの 6 つを集める手順です。

---

## 1. Fork する (1 分)

1. このリポジトリの右上 **Fork**
2. **Repository name を必ず変える** (例: `pandora-raid`, `tuesday-night-raid`)
   - 既定の `raid-repository` のままだと、他の固定の fork と見分けが付きません
   - Vercel のプロジェクト名の既定値にもなるので、ここで決めておくと後が楽です
3. **Create fork**

---

## 2. Supabase プロジェクトを作る (5 分) — 値 1〜3

1. https://supabase.com にログイン (GitHub ログイン推奨)
2. **New project**

   | 項目 | 推奨 |
   |---|---|
   | Name | 何でも可 (例: `raid-repository`) |
   | Database Password | 自動生成 → **控えておく** (後でスキーマ適用に使えます) |
   | Region | **Northeast Asia (Tokyo)** |
   | Plan | **Free** |

3. 作成後、**Settings → API** から次の 3 つをメモ:
   - **Project URL** (`https://xxxxx.supabase.co`) … 値 1
   - **anon public** … 値 2
   - **service_role** … 値 3

> ⚠ **service_role キーはブラウザに出してはいけません。** RLS を飛び越える
> 全権キーです。`NEXT_PUBLIC_` を付けないこと (付けるとブラウザに配信されます)。
> `npm run doctor` はこの取り違えを検出します。

> 💡 Project URL の `xxxxx` の部分 (project ref) は手順 3 でも使います。

---

## 3. Discord の Application と Bot を作る (10 分) — 値 4〜6

### 3-1. Application

1. https://discord.com/developers/applications → **New Application** → 名前を付けて **Create**

### 3-2. OAuth2 の Client ID / Secret

1. 左メニュー **OAuth2**
2. **CLIENT ID** をコピー
3. **CLIENT SECRET** → **Reset Secret** → 表示された値をコピー (一度しか出ません)

> この 2 つは **Supabase の画面に貼るだけ**の値です。`.env.local` や Vercel の
> 環境変数には入れません (手順 4)。

### 3-3. Redirect URI を登録

同じ **OAuth2** ページの **Redirects** → **Add Redirect**:

```
https://<project ref>.supabase.co/auth/v1/callback
```

`<project ref>` は手順 2 の Project URL のサブドメイン部分。
**これは Supabase 側の固定 URL なので、後で Vercel のドメインが変わっても直す必要はありません。**

### 3-4. Bot を有効化して intent を ON — 値 4

1. 左メニュー **Bot**
2. **Privileged Gateway Intents**
   - **SERVER MEMBERS INTENT** を **ON** ← これが OFF だと**誰もログインできません**
   - **MESSAGE CONTENT INTENT** を **ON** (Discord 自動取り込みを使うなら)
   - **Save Changes**
3. **Token** → **Reset Token** → 表示されたトークンをコピー … 値 4

### 3-5. サーバー ID と管理者ロール ID — 値 5・6

1. Discord 本体 → 設定 → 詳細設定 → **開発者モード** を ON
2. サーバーアイコンを右クリック → **サーバー ID をコピー** … 値 5
3. サーバー設定 → **ロール** → 編集を任せるロール (自分が持っているもの) を右クリック →
   **ロール ID をコピー** … 値 6 (複数ならカンマ区切り)

### 3-6. Bot をサーバーに入れる

1. **OAuth2 → URL Generator**
2. Scopes: **bot**
3. Bot Permissions: **View Channels** / **Read Message History** /
   **Send Messages** (開催通知・出欠の催促を使うなら) /
   **Mention @everyone, @here, and All Roles** (通知でロールをメンションするなら)
4. 生成された URL を開いて、自分のサーバーを選んで認証

> ⚠ Bot がサーバーに**居ない**と、メンバー判定 API が使えずログインが通りません。

---

## 4. Supabase 側で Discord ログインを有効にする (2 分)

1. https://supabase.com/dashboard → 対象プロジェクト
2. **Authentication → Providers → Discord**
3. **Enable** を ON
4. 手順 3-2 の **Client ID** と **Client Secret** を貼る → **Save**
5. 同じ画面の **Email** を開き、**Enable email provider を OFF** → **Save**
   (このポータルは Discord のログインしか使いません。Supabase の新しい
   プロジェクトは Email が ON で始まります。データベースの規則はサーバーの
   メンバーと確認できた人にしか読み書きさせませんが、使わない入口は閉じておきます)

> Site URL / Redirect URLs (Vercel のドメイン側) は、ドメインが決まる手順 6 で登録します。

---

## 5. 設定ファイルとデータベース (5 分)

ここから先は**コマンドが手伝います**。手元にリポジトリを clone して:

```bash
git clone https://github.com/<自分>/<自分のリポジトリ>.git
cd <自分のリポジトリ>
npm install
npm run setup
```

`npm run setup` がすること:

1. 値 1〜5 を順に聞いて、**形が正しいかその場で検証**する
2. 管理者ロール ID (値 6) を聞く (未設定だと誰も編集できません)
3. `CRON_SECRET` と `SECRET_ENCRYPTION_KEY` を**自動生成**する (自分で考えなくてよい)
4. `.env.local` を書く (既にあれば `.env.local.bak` に控えを取ってから。どちらも本人だけが読める権限で書きます)
5. (任意) `supabase/schema.sql` を流してテーブルを作る
6. 最後に **`npm run doctor` と同じ診断**を実行する

> ⚠ **自動化できないもの**: Supabase プロジェクトの作成 / Discord アプリの作成 /
> Supabase の Authentication 設定。この 3 つは Web ダッシュボードにしか操作口が
> ありません (だから手順 2〜4 が手作業です)。

### スキーマ (テーブル) を作る方法

**A. setup から流す** — Supabase の接続文字列が要ります。

- Supabase → **Settings → Database → Connection string** → **Session pooler** タブ
  - ⚠ **Direct connection ではなく Session pooler。** Direct は Free プランだと
    IPv6 のみで、GitHub Actions からも繋がりません
- URI の `[YOUR-PASSWORD]` を手順 2 で控えた DB パスワードに置き換えて貼る
- `psql` が入っていない環境では選べません (B へ)
- パスワードに `@ : / ? #` などの記号が入っていると URL として読めません。
  その部分を URL エンコードする (`@` → `%40` など) か、B を使ってください

**B. SQL Editor に貼る** — psql が無くてもできます。

1. Supabase → **SQL Editor** → **New query**
2. [`supabase/schema.sql`](../supabase/schema.sql) を**全文**貼り付け (GitHub の Raw から Ctrl+A → Ctrl+C)
3. **Run** → `Success. No rows returned` が出れば完了

どちらの場合も、`npm run doctor` の「schema.sql 適用済み」が ✅ になれば成功です。

---

## 6. Vercel にデプロイする (5 分)

1. https://vercel.com/new で fork したリポジトリを **Import**
   - 初回は **Adjust GitHub App Permissions** で fork にアクセス権を与えます
2. **Environment Variables** に `.env.local` の中身を貼る
   - Vercel の入力欄は **`.env` の中身をそのまま貼り付けられます** (キーと値に分解されます)
   - ⚠ `NEXT_PUBLIC_` が付いていない値 (service_role キー / Bot トークン等) に、
     あとから接頭辞を足さないこと
   - ⚠ `DEV_AUTH_BYPASS` / `PUBLIC_DEMO_MODE` の行は**貼らない**こと
     (`PUBLIC_DEMO_MODE` は本番でもログインの入口を外します)
   - 秘密の値 (service_role キー / Bot トークン / `CRON_SECRET` /
     `SECRET_ENCRYPTION_KEY` など) は Vercel で **Sensitive** にしておくと、
     後からダッシュボードで値を読めなくなります
3. **Deploy** → 1〜2 分で `https://<プロジェクト名>.vercel.app` が払い出されます

### 6-1. ログインの戻り先を登録する (ここを忘れると必ず詰まります)

1. Supabase → **Authentication → URL Configuration**
2. **Site URL**: `https://<自分のドメイン>`
3. **Redirect URLs** に 2 つ追加:
   ```
   https://<自分のドメイン>/auth/callback
   http://localhost:3000/auth/callback
   ```
   - `vercel.json` で `main` 以外のデプロイは無効にしてあります。preview デプロイを
     有効にするなら、preview のドメイン (`https://*-<チーム名>.vercel.app/**` など) も足します
4. **Save**

> 💡 ローカルで `npm run dev` したときは、ターミナルに出る `http://127.0.0.1:3000`
> ではなく **`http://localhost:3000`** をブラウザで開いてください。戻り先は
> `localhost` で登録しているので、`127.0.0.1` から始めるとログインが戻れません。

### 6-2. 確認

```bash
npm run doctor -- --url https://<自分のドメイン>
```

そのうえで実際に `https://<自分のドメイン>/` を開き、Discord でログインして
トップに着地すれば完了です。

---

## 7. 最初の設定 (5 分)

デプロイ直後は**空のポータル**です。ヘッダー右上の ⚙️ から設定します。

### 7-1. スケジュールの方式を選ぶ

| 方式 | どんなとき |
|---|---|
| **自前作成式** | ポータル内で候補日の追加・出欠入力・開催確定まで完結させたい |
| **同期式** | すでに [character-sheets](https://character-sheets.appspot.com/schedule/) で日程を回している |
| **使わない** | 日程はポータルで扱わない (コンテンツ管理だけ使う) |

同期式を選んだ場合は、設定の **Schedule Source** に
`https://character-sheets.appspot.com/schedule/list?key=...` を登録します
(この URL は DB に保存され、**全員で共有**されます)。

スケジュールは **複数登録できます**。追加すると元ページからスケジュール名を
取得して一覧に並ぶので、左のラジオで表示するものを選びます。名前が取れない
ページは鉛筆ボタンで自分で付けられます。切り替えは全員に反映され、通知や
スナップショットなどの自動処理も切り替え後のスケジュールを見るようになります。

### 7-2. コンテンツを追加する

**コンテンツ** タブ → **+ コンテンツ追加**。

| 項目 | 説明 |
|---|---|
| 名前 | 表示名 (例: 至天の座アルカディア零式：ヘビー級) |
| URL 識別子 | URL に使う英数字 (例: `arcadion-heavy`) |
| ステータス | 未着手 / 練習中 / クリア済 / 休止中 |
| 軽減表 URL | Google スプレッドシートの URL (任意) |
| ロット管理 URL | 同上 (任意) |
| Discord チャンネル ID | 自動取り込み用 (任意) |

Google スプレッドシートは次のどれでも使えます:

| 種類 | 形 | 出し方 |
|---|---|---|
| ウェブに公開 | `.../pubhtml` | ファイル → 共有 → ウェブに公開 |
| 埋め込み | `.../e/.../pubhtml?widget=true` | 同上 |
| 通常の共有 URL | `.../edit#...` | 「リンクを知っている全員が閲覧可」のとき |

### 7-3. メンバーを登録する

設定 → **Members**。ここに登録した Discord ID が、自分のページ・出席サマリー・
BiS の所有者・欲しい人行列・軽減表の「自分の担当」の**本人判定**に使われます。
**同期式でも登録してください** (同期式ではスケジュール表の出欠列は外部シートのままで、
ここは本人判定にだけ使います)。出席サマリーの突合には各メンバーの「ログ名」も入れます。

---

## 8. (任意) Discord 自動取り込み

指定したチャンネルの直近 100 件から URL を拾って、攻略・動画タブに自動登録します
(毎日 01:00 JST + ボタンでいつでも)。

1. **Bot にチャンネルを見せる**: 対象チャンネルを右クリック → チャンネルの編集 →
   権限 → Bot を追加 → **チャンネルを表示** と **メッセージ履歴を読む** を許可
2. **チャンネル ID を登録**: チャンネル右クリック → ID をコピー → コンテンツ編集
   ダイアログの「Discord 攻略チャンネル ID」「Discord 動画チャンネル ID」に貼る
3. **確認**: コンテンツ一覧の **Discord 取り込み** ボタン

| 出た表示 | 意味 |
|---|---|
| `+N 件取り込み` | 成功 |
| `URL を検出できず` | チャンネルが空 か Bot に権限が無い (1 を見直す) |
| `エラー: discord 401/403` | Bot トークンか権限の問題 |

> `CRON_SECRET` を後から足した場合は、Vercel で **Redeploy** しないと反映されません
> (Vercel の環境変数の変更は、その後に作られたデプロイにだけ反映されます)。

---

## 9. (任意) スキーマ更新を自動にする

このリポジトリを `git pull` して `supabase/schema.sql` が更新されたとき、
**push だけで反映**されるようにできます。

1. 手順 5 の接続文字列 (Session pooler) を用意
2. **fork した直後は GitHub Actions が無効です。** fork の **Actions** タブを開き、
   **I understand my workflows, go ahead and enable them** を押して有効にする
   (押さないと手順 9・10 の workflow が一度も動きません)
3. fork した GitHub リポジトリ → **Settings → Secrets and variables → Actions**
4. **New repository secret** → Name `SUPABASE_DB_URL` / Value に接続文字列

以後、`supabase/schema.sql` を含む main への push で
"Deploy Database (Production)" が自動実行されます。

> `npm run setup` でスキーマを流したとき、`gh` コマンドが入っていれば
> **この secret 登録も一緒にやるか聞かれます**。

> secret を登録しない場合、workflow は `Skipping: SUPABASE_DB_URL not set on this fork.`
> と出して成功終了します (赤くなりません)。手動運用のままで問題ありません。

### スキーマが更新されたとき

`supabase/schema.sql` は**冪等**です (`IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`)。
同じ SQL を何度流しても既存データは壊れません。手順 9 を設定していない場合は、
SQL Editor で新しい `schema.sql` を貼り直してください。

---

## 10. (任意) 開催確定の通知・出欠催促を毎時動かす

自前作成式の「開催確定の 12 時通知」と「出欠の催促」は、Supabase の pg_cron が
**毎時あなたの本番 URL を叩いて**動きます (Vercel Hobby の cron は 1 日 1 回まで
なので、毎時の分は DB 側で起動します)。叩く先は自分で 1 回だけ教える必要があります。

1. **CRON_SECRET を Supabase に預ける**: SQL Editor で 1 回だけ実行
   ```sql
   SELECT vault.create_secret('<.env.local の CRON_SECRET>', 'cron_notify_native_schedule_bearer');
   ```
   - SQL Editor はクエリの履歴を保存します。実行したら、その query を履歴
     (左の一覧) から削除しておいてください
   - あとで `CRON_SECRET` を変えたときは、同じ名前で `create_secret` すると
     重複エラーになります。次で更新します:
     ```sql
     SELECT vault.update_secret(id, '<新しい CRON_SECRET>')
       FROM vault.secrets WHERE name = 'cron_notify_native_schedule_bearer';
     ```
2. **叩く先を渡してスキーマを流し直す** (手順 6 で決まった本番 URL。パスは付けない)
   - 手順 9 を設定済み: GitHub → **Settings → Secrets and variables → Actions →
     Variables** → **New repository variable** → Name `CRON_BASE_URL` /
     Value `https://<project>.vercel.app` → Actions タブで
     "Deploy Database (Production)" を **Run workflow**
   - 手動運用: SQL Editor で `schema.sql` の**先頭に 1 行**足して流す
     ```sql
     SET app.cron_base_url = 'https://<project>.vercel.app';
     ```
3. **確認**: SQL Editor で `SELECT jobname, command FROM cron.job;` を流し、
   `notify-native-schedule-hourly` / `attendance-reminder-hourly` /
   `warmup-portal-function` の 3 本が**自分の URL** を向いていれば完了

一度登録すれば、以後スキーマを流し直しても宛先は引き継がれます (変えたいときだけ
2 をやり直す)。叩く先を渡さずに流すと、ジョブは登録されません (NOTICE に理由が出ます)。

> ⚠ **2026-10-01 より前にスキーマを流した fork** は、ジョブが**上流のサイト**を
> 向いたままです (通知・催促が一度も動かず、CRON_SECRET を上流へ送っています)。
> 上の 2 をやり直してください。

---

## 11. (任意) FFLogs の練習ログを取り込む

ログタブ (練習ログの集計) を使うときの設定です。

1. **API キー (公開ログ用)**: FFLogs にログイン → アカウント設定 → **Web API** で
   v1 のキーを作り、`FFLOGS_API_KEY` に入れる
2. **OAuth (Private / Unlisted のレポートも扱うとき)**:
   1. https://www.fflogs.com/api/clients/ → **Create New Client**
   2. Redirect URLs に次の 2 つを登録 (**完全一致**。ドメインを変えたら更新)
      ```
      https://<自分のドメイン>/api/auth/fflogs/callback
      http://localhost:3000/api/auth/fflogs/callback
      ```
   3. 表示された Client ID / Client Secret を `FFLOGS_OAUTH_CLIENT_ID` /
      `FFLOGS_OAUTH_CLIENT_SECRET` に入れる
   4. `SECRET_ENCRYPTION_KEY` が設定されていることを確認する
      (トークンはこの鍵で暗号化して保存します。未設定だと保存できません)
3. `.env.local` と Vercel の両方に入れて **Redeploy**
4. ポータルの ⚙️ → **FFLogs 連携** のセクションで FFLogs のユーザー名を設定し、
   OAuth を使うなら接続ボタンから認可する (admin 1 人が 1 回だけ)

---

## 困ったとき

まず **`npm run doctor`**。以下は doctor が出す指摘と対応の一覧です。

| doctor の指摘 | 対応 |
|---|---|
| `DISCORD_BOT_TOKEN 未設定` | 手順 3-4 |
| `DISCORD_ADMIN_ROLE_IDS が未設定` | 手順 3-5 の 3 (ロール ID) |
| `Bot トークンが無効` | Reset Token でやり直して `.env.local` と Vercel の両方を更新 |
| `Bot がサーバーに居ません` | 手順 3-6 の招待をやり直す |
| `メンバー一覧を取得できません (403)` | 手順 3-4 の **SERVER MEMBERS INTENT** が OFF |
| `Discord ログインが無効` | 手順 4 (Supabase の Providers) |
| `schema.sql が未適用` | 手順 5 のスキーマ |
| `anon キーが拒否されました` | Supabase → Settings → API から貼り直す |
| `秘密の値に NEXT_PUBLIC_ が付いています` | その変数を消して、接頭辞なしで設定し直す |

doctor で分からないもの:

| 症状 | 原因 / 対応 |
|---|---|
| Discord の画面で `Invalid OAuth2 redirect_uri` | 手順 3-3 の Redirects (`https://<project ref>.supabase.co/auth/v1/callback`) |
| ログイン後に本番のトップ (`/?code=…`) に飛ばされる / 戻れない | 手順 6-1 の Redirect URLs。**完全一致**で入っている必要があります |
| ログイン後すぐ `/auth/denied` | Bot がサーバーに居ない / intent が OFF / サーバー ID 違い のどれか |
| ⚙️ が出ない / 設定ダイアログで保存できない | `DISCORD_ADMIN_ROLE_IDS` が未設定か、自分がそのロールを持っていない (未設定だと誰も admin になりません) |
| コンテンツ追加でエラー | スキーマ未適用の可能性。`npm run doctor` で確認 |
| ホームに案内文しか出ない | スケジュールの方式が未選択 (手順 7-1) |

---

## 参考

- 環境変数の一覧と説明: [`.env.local.example`](../.env.local.example)
- Discord のチャンネル構成の推奨: [`guides/discord-setup.md`](guides/discord-setup.md)
- ログ担当の手引き: [`guides/log-runner.md`](guides/log-runner.md)
- デモサイトの作り方 (通常は不要): [`demo-site.md`](demo-site.md)
