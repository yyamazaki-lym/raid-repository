# Raid Repository

FF14 レイド固定向けポータル — スケジュール / 軽減表 / ロット管理 / 攻略情報 / 動画 を一箇所に。

「1グループ = 1デプロイ」前提で作られた、自分の固定で fork して使うシングルテナントアプリです。

## Live demo

実際の使用感を確認できる公開モックサイト (read-only):

🔗 **https://demo-raid-repository.vercel.app**

サンプルデータ (5 カテゴリ + 過去 8 週分のスケジュール + 軽減表 / ロット表 / 攻略リンク / 動画リンク / マクロ / 募集文等) が seed 済。`PUBLIC_DEMO_MODE=true` で Discord OAuth gate を skip しつつ、書き込みは admin gate で全件弾く 4 層防御 (proxy / app / RLS) で閲覧専用にしています。

## Deploy

ワンクリックで自分の Vercel + GitHub に fork → デプロイできます (Supabase / Discord Bot は先に作っておく必要あり、詳細は [Setup for your raid group](#setup-for-your-raid-group)):

> ## ⚠️ デプロイ前に必ず確認
>
> Deploy Button / Fork ボタンを押した先の画面で、**プロジェクト名 / リポジトリ名のデフォルト `my-raid-repository` は必ず変更してください**。
>
> - そのまま確定すると、本リポジトリを使う他の固定と同じ名前になり、Vercel ダッシュボードや URL で見分けがつかなくなります
> - 自分の固定を識別できる名前を推奨 (例: `pandora-raid`, `phoenix-fixed-portal`, `tuesday-night-raid` 等)
> - **GitHub repo 名 / Vercel project 名 の両方に反映されます** (片方だけ変えるのは NG)
> - 後から rename も可能ですが、URL や OAuth callback の整合を取り直す必要があるので**最初に決める方が楽**です

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/yyamazaki-lym/raid-repository&env=NEXT_PUBLIC_SUPABASE_URL,NEXT_PUBLIC_SUPABASE_ANON_KEY,SUPABASE_SERVICE_ROLE_KEY,DISCORD_BOT_TOKEN,DISCORD_GUILD_ID&envDescription=Supabase%20%2B%20Discord%20OAuth%20%E5%BF%85%E9%A0%88%20%28%E8%A9%B3%E7%B4%B0%20%3A%20envLink%29&envLink=https://github.com/yyamazaki-lym/raid-repository/blob/main/.env.local.example&project-name=my-raid-repository&repository-name=my-raid-repository)

任意の env (DISCORD_ADMIN_ROLE_IDS / YOUTUBE_API_KEY / FFLOGS_API_KEY / FFLogs OAuth / SECRET_ENCRYPTION_KEY / CRON_SECRET) はデプロイ後に Vercel ダッシュボード → Settings → Environment Variables から追加。

## What it does

### スケジュール
- character-sheets.appspot.com の予定一覧を取り込み
- 「日程確定」(`DECISION`) 行を抽出して**次回開催日**を強調表示
- メンバー名のホバー（PC）/ タップ（モバイル）でその人の一言コメントをポップアップ
- 名前クリックで character-sheets の自分の入力画面に直行
- 過去日程トグル（デフォルト非表示）
- スケジュール URL は **Supabase の `app_settings` テーブルで全員共有**
  （誰かが登録すれば全員に反映 / リロードで取得）

### カテゴリー
- レイドコンテンツ単位で **ステータス**（未着手 / 練習中 / クリア済 / 休止中）を切替
- ドラッグで並び替え（マウス + 長押しタッチ + キーボード対応）
- 編集ダイアログから名前 / Slug / ステータス + 各種URL + Discord チャンネルIDを設定
- 削除確認ダイアログ付き
- Supabase Realtime でメンバー全員に即時同期

### サブタブ（カテゴリーごと）
- **軽減表 / ロット管理**: 既存 Google Sheets を iframe で全幅表示（80% スケール）
- **攻略情報**: wiki/記事リンクの一覧、DnD 並べ替え、URL からタイトル自動取得
- **動画**: YouTube はサムネ + クリック再生（lazy embed）、他の動画サイトはリンクカード
  - オプションで FFLogs URL を登録可能（ワンタップで報告ページへ）

### Discord 自動取り込み
- カテゴリーごとに「攻略チャンネルID」「動画チャンネルID」を設定可能
- Vercel Cron が**毎日 09:00 JST** に各チャンネルの直近100件を pull
- URL 抽出 + 重複排除 + ページタイトル自動取得 → 該当サブタブに自動投入
- カテゴリー単位で**取り込みの一時停止**トグル
- カテゴリー一覧の「**Discord 取り込み**」ボタンで**手動即時実行**
  （カテゴリーごとに `+件数 / 重複 / 失敗 / scanned 0` を表示）
- 取り込まれたリンクには**指紋アイコン**が付与され、手動登録分と区別可能
- カテゴリーカードに**過去7日の取り込み件数バッジ** (`+N/wk`)

### テーマ
7つの FF14 拡張テーマ（拡張ごとに専用エフェクト）：

| テーマ | エフェクト |
|---|---|
| ARR (新生) | 遠くにかすかな流星と微細な星屑 |
| Heavensward (蒼天) | ステンドグラスの格子 + 黄金の光柱 |
| Stormblood (紅蓮) | 砂漠の地層 + 横に流れる砂塵 |
| Shadowbringers (漆黒) | 虚無に降り注ぐシンイーターの光 + 漂うエーテル粒子 |
| Endwalker (暁月) | 月の輪 + 星々 + オーロラ帯 |
| Dawntrail (黄金) | 太陽ディスク + 下方からの光線 |
| Evercold (白銀) | 二層の降雪（小・速 + 大・遅） |

## Tech

- Next.js 16 + React 19 + Tailwind CSS v4
- Supabase (Postgres + Realtime; RLS は SELECT 開放 / 書き込みは admin ロール限定 + Discord OAuth ゲート)
- shadcn/ui + Base UI primitives
- @dnd-kit (DnD 並べ替え)
- motion (タブアニメーション)
- Vercel auto-deploy from GitHub `main`
- Vercel Cron Jobs (Discord 取り込み)

### セキュリティ防御層

2.1 で 4 段の多重防御を導入済:

1. **proxy.ts**: Discord OAuth gate — guild メンバー以外を `/login` / `/auth/denied` にリダイレクト
2. **ページ単位**: `categories.required_role_ids` で個別カテゴリへのロール制限
3. **Server Action 入口**: `assertAdminResult()` で admin ロール限定 (categories CRUD / app_settings / FFLogs / 動画メタ系すべて)
4. **DB 層 (RLS)**: INSERT/UPDATE/DELETE は `auth.jwt()->'app_metadata'->>'is_admin' = 'true'` を要求。SELECT は anon + authenticated 全開 (公開読み取り温存)

その他: CSP / HSTS / X-Frame-Options / Referrer-Policy / Permissions-Policy 全付与、`/auth/callback` + `/api/cron/*` に rate limit、FFLogs token は AES-256-GCM 暗号化保管 (`secrets` テーブル)、Server Action の DB エラー文言は汎用化済 (生 PG エラー漏洩防止)。

## Setup for your raid group

このリポジトリを自分の固定で使う手順。所要時間は 30〜60分（うち Discord Bot 設定は任意で +20分）。

### 必要なもの

| 必須 | アカウント / ツール | 用途 |
|---|---|---|
| ✅ | [GitHub](https://github.com) | リポジトリ管理（無料） |
| ✅ | [Supabase](https://supabase.com) | DB + Realtime（無料枠で十分） |
| ✅ | [Vercel](https://vercel.com) | ホスティング（Hobby 無料枠で十分） |
| 任意 | [Discord Developer](https://discord.com/developers/applications) | 自動取り込みを使う場合のみ |

ローカル開発するなら追加で **Node.js 20+** と **npm**。

---

### 1. Fork (1分)

> ⚠️ **デフォルト名のまま fork しないでください**
> 何も考えずに進めると、他の固定が fork した repo と完全に同じ `raid-repository` という名前になり、自分の Vercel ダッシュボード上でも他の固定と区別がつかなくなります。下記 step 3 で**必ず**自分の固定を識別できる名前に変更してください。

1. このリポジトリの右上 **Fork** ボタン
2. 自分のアカウントを選択
3. **Repository name** をデフォルト (`raid-repository`) から自分の固定を識別できる名前に**必ず変更** (例: `pandora-raid`, `phoenix-fixed-portal`, `tuesday-night-raid` 等)。Vercel に import する時の project 名 default にもなるので、ここで変えておくとあとが楽
4. **Create fork**

---

### 2. Supabase プロジェクト作成 (5分)

#### 2-1. プロジェクト作成

1. https://supabase.com にログイン（GitHubログイン推奨）
2. **New project** クリック
3. 入力項目：
   | 項目 | 推奨値 |
   |---|---|
   | Name | `raid-repository` など任意 |
   | Database Password | 自動生成 → コピーして保管（普段は使わない） |
   | Region | **Northeast Asia (Tokyo)** |
   | Pricing Plan | **Free** |
4. **Create new project** → 数十秒待つ

#### 2-2. スキーマ実行

1. 左メニュー **SQL Editor** → **New query**
2. このリポジトリの [`supabase/schema.sql`](./supabase/schema.sql) を**全文コピー**してペースト
   - GitHub の **Raw** ボタンを開いて Ctrl+A → Ctrl+C が確実
3. 右下 **Run** （または Ctrl+Enter）
4. 「Success. No rows returned」が出れば完了
5. （確認）左メニュー **Table Editor** で `categories`, `category_links`, `app_settings` などのテーブルが作られていればOK

#### 2-3. 認証情報を取得

1. 左メニュー **Settings**（歯車）→ **API**
2. 以下の **3 つの値**をコピーしてメモ（次のステップで使う）：
   | 項目 | 場所 |
   |---|---|
   | **Project URL** | Project URL 欄（`https://xxxxx.supabase.co` 形式） |
   | **anon public** key | Project API keys → `anon` `public` 行の長い文字列 |
   | **service_role** key | 同上 → `service_role` 行 |

> ⚠️ `service_role` key は **絶対にブラウザ側に出さない**でください（RLS をバイパスする全権限キー）。Vercel の Environment Variables (server-only) に登録するのみで、`NEXT_PUBLIC_` プレフィックスは付けない。サーバー側の `/auth/callback` で Discord メンバーシップ判定を `app_metadata` に書き込むために必要。

---

### 3. Vercel デプロイ (5分)

#### 3-1. プロジェクトをインポート

1. https://vercel.com/login で GitHub ログイン
2. https://vercel.com/new
3. **Import Git Repository** で fork したリポジトリを探す
   - 初回は **Adjust GitHub App Permissions** で fork を含むようアクセス権限を調整
4. **Import** クリック
5. **Configure Project** 画面：
   - Framework Preset: **Next.js**（自動検出）
   - そのまま下にスクロール

#### 3-2. 環境変数を設定

**Environment Variables** セクションを展開して以下を登録（必須/任意の区別は `.env.local.example` に詳細あり、すべて Production / Preview / Development 全部にチェック）。

#### 必須

| Name | Value | 用途 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | 2-3 の Project URL | DB 接続 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 2-3 の anon key | DB 接続 (read 専用相当、書き込みは RLS で admin 限定) |
| `SUPABASE_SERVICE_ROLE_KEY` | 2-3 の service_role key | OAuth callback で `app_metadata` 書き込み + secret 暗号化テーブル ([⚠️ NEVER expose to browser](#)) |
| `DISCORD_BOT_TOKEN` | Discord Bot トークン (5-1 で取得) | OAuth gate で guild メンバーシップ判定 + 自動取り込み |
| `DISCORD_GUILD_ID` | Discord サーバー ID | OAuth gate のメンバー判定対象 |

`SUPABASE_SERVICE_ROLE_KEY` 等の **server-only** 変数は `NEXT_PUBLIC_` プレフィックスを **絶対付けない**。付けるとブラウザバンドルに含まれて漏洩します。

#### 推奨 / 任意

| Name | Value | 用途 |
|---|---|---|
| `DISCORD_ADMIN_ROLE_IDS` | カンマ区切り Discord ロール ID | カテゴリ編集等を admin ロール所有者のみに制限 (未設定 = 全員 admin、後方互換) |
| `CRON_SECRET` | 32 文字以上のランダム文字列 | Vercel Cron 認証 |
| `YOUTUBE_API_KEY` | YouTube Data API v3 キー | 限定公開動画の duration / uploadDate 取得 (未設定だと HTML scrape fallback、Vercel IP の bot 検出で失敗することあり) |
| `SECRET_ENCRYPTION_KEY` | 64 文字 hex (`openssl rand -hex 32`) | FFLogs token 等の AES-256-GCM 暗号化保管 (未設定だと旧 `app_settings` 平文保存にフォールバック) |
| `FFLOGS_API_KEY` | FFLogs API v1 キー | レポート ↔ 動画 自動マッチ (Public レポート対象) |
| `FFLOGS_OAUTH_CLIENT_ID` | FFLogs OAuth Client ID | **Private / Unlisted** レポートの自動マッチ用 (Authorization Code Flow)。v1 で十分なら未設定可 |
| `FFLOGS_OAUTH_CLIENT_SECRET` | FFLogs OAuth Client Secret | 同上 (server-only)。詳細手順は `.env.local.example` |

#### Discord OAuth (ダッシュボード設定のみ、env なし)

1. Discord Developer Portal → アプリケーション → OAuth2 → Redirects に `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback` を追加
2. Supabase ダッシュボード → Authentication → Providers → Discord を有効化、Discord Client ID / Secret を貼り付け
3. Supabase ダッシュボード → Authentication → URL Configuration → Redirect URLs に `https://YOUR_VERCEL_DOMAIN/auth/callback` と `http://localhost:3000/auth/callback` を追加

#### 3-3. デプロイ実行

1. **Deploy** ボタン
2. 1〜2分待つ（ビルドログがリアルタイム表示）
3. 完了すると `https://your-project-name.vercel.app` の URL が払い出される

#### 3-4. （任意）カスタムドメイン

`raid.example.com` のような自前ドメインを使いたい場合は **Settings → Domains** から追加できます。Cloudflare などの DNS で CNAME を Vercel に向ける流れ。

---

### 4. 初期設定 (5分)

デプロイ完了 URL を開きます。最初は何も登録されていない状態です。

#### 4-1. スケジュール URL の登録

1. ヘッダー右上の **⚙️ 設定**アイコンをクリック
2. **Schedule Source** セクションで character-sheets の URL を入力
   - 形式: `https://character-sheets.appspot.com/schedule/list?key=...`
   - character-sheets でスケジュール未作成の場合は https://character-sheets.appspot.com/schedule/ で先に作成
3. **保存**
4. ホームに戻ると次回開催日 + 日程一覧が表示されるはず

> この URL は Supabase の `app_settings` テーブルに保存され、**全メンバーで共有**されます。誰か1人が登録すれば全員に反映。

#### 4-2. カテゴリーの追加・編集

1. 上部タブ **カテゴリー** へ
2. デフォルトでサンプル 5 件 (現行零式 + Variant + Extreme + Ultimate × 2) が seed されているので、**自分達のコンテンツに編集**するか、削除して新規追加：
   - カードの **⋯ → 削除**
   - 右上 **カテゴリー追加** で新規
3. 編集ダイアログ各項目：
   | 項目 | 説明 |
   |---|---|
   | 名前 | 表示名（例: 万魔殿パンデモニウム:辺獄編） |
   | URL識別子 | URLパスに使う英数字-（例: `pandaemonium-edge`） |
   | ステータス | 未着手 / 練習中 / クリア済 / 休止中 |
   | 軽減表 URL | Google Sheets の埋め込み URL（任意） |
   | ロット管理 URL | 同上（任意） |
   | Discord チャンネル ID | 後述（任意） |
4. **保存**

#### 4-3. Google Sheets URL の取得方法

軽減表・ロット管理用のスプレッドシート URL は以下の形式が使えます：

| 種類 | 形式 | 取得方法 |
|---|---|---|
| 公開URL | `.../pubhtml` | Sheets で **ファイル → 共有 → ウェブに公開** |
| 埋め込み URL | `.../e/.../pubhtml?widget=true` | 同上、ウェブに公開時 |
| 通常の共有URL | `.../edit#...` | 共有設定が「リンクを知っている全員が閲覧可」の場合のみ |

#### 4-4. 動作確認

- ホームにスケジュール表示
- カテゴリーカードをクリック → **軽減表 / ロット管理 / 攻略情報 / 動画** タブが表示
- 攻略情報・動画タブで「**+ 追加**」からリンク登録できる

---

### 5. Discord 自動取り込みを使う場合（任意, 20分）

毎日 1回、指定 Discord チャンネルから URL を自動取得して攻略情報・動画タブに投入する機能。設定が少し複雑なので、まずは手動運用してから後で追加でも OK。

#### 5-1. Discord Bot を作成

1. https://discord.com/developers/applications にログイン
2. 右上 **New Application** → 名前 (例: `Raid Repository Bot`) → **Create**
3. 左メニュー **Bot**
4. ページを下にスクロールして **Privileged Gateway Intents** セクション：
   - **MESSAGE CONTENT INTENT** を **ON**
   - 他はOFFのままでOK
   - 下部 **Save Changes**
5. 同じ Bot ページの **Token** セクション → **Reset Token** → 表示された**トークンをコピー**して保管（一度しか表示されない）

#### 5-2. Bot を Discord サーバーに招待

1. 左メニュー **OAuth2** → **URL Generator**
2. **Scopes**: `bot` にチェック
3. **Bot Permissions**: 
   - `View Channels`
   - `Read Message History`
4. 下に生成された URL を新タブで開く
5. 自分の Discord サーバーを選択 → **認証**

#### 5-3. チャンネル個別の権限

サーバー全体での Bot 権限と、各チャンネルの権限上書きは別です。**取り込み対象チャンネルそれぞれ**で：

1. Discord で対象チャンネル右クリック → **チャンネルの編集**
2. 左メニュー **権限**
3. **メンバーまたはロールを追加** → Bot 名を検索 → 追加
4. 以下を許可（緑のチェック）：
   - **チャンネルを表示**
   - **メッセージ履歴を読む**
5. **変更を保存**

> 💡 攻略・動画チャンネルが各カテゴリーに2つずつあるなら、Bot 専用ロールを作って一括許可する方法もあります。

#### 5-4. Vercel に環境変数を追加

Vercel ダッシュボード → プロジェクト → **Settings → Environment Variables**：

| Name | Value |
|---|---|
| `DISCORD_BOT_TOKEN` | 5-1 でコピーしたトークン |
| `CRON_SECRET` | 任意のランダム文字列（32文字以上推奨） |

`CRON_SECRET` 生成例（PowerShell）：
```powershell
-join ((48..57) + (65..90) + (97..122) | Get-Random -Count 32 | % {[char]$_})
```

または Bash:
```bash
openssl rand -hex 16
```

設定後、**Deployments → 最新行の ⋯ → Redeploy** で再デプロイ（環境変数は再ビルド時のみ反映）。

#### 5-5. チャンネル ID を取得

1. Discord 設定 → **詳細設定** → **開発者モード** を ON
2. 取り込み対象チャンネルを**右クリック → IDをコピー**
3. アプリのカテゴリー編集ダイアログで「Discord 攻略チャンネルID」「Discord 動画チャンネルID」欄に貼り付け
4. **保存**

#### 5-6. 動作確認

`/category` ページの **Discord 取り込み** ボタン → クリック後、結果がボタン下に表示：

- ✅ `+N 件取り込み (...)` → 成功
- ℹ️ `Discord メッセージから URL を検出できず` → チャンネル空 or Bot 権限不足（5-3 を見直し）
- ⚠️ `失敗 N` → DB 接続エラーなど（Vercel ログで詳細確認）
- ❌ `エラー: discord 401/403/...` → Bot Token または権限の問題

正常動作を確認できたら、毎日 09:00 JST に自動実行されます（`vercel.json` の cron schedule）。手動でも `/category` のボタンからいつでも実行可。

---

### スキーマ更新時の対応

将来このリポジトリを `git pull` で最新化した時にスキーマが拡張されている場合：

1. プルしたコードに含まれる新しい `supabase/schema.sql` をそのまま Supabase SQL Editor で再実行
2. すべての `CREATE TABLE` / `ALTER TABLE` が `IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` で書かれているので**冪等**
3. 既存データは破壊されません

### よくあるトラブル

| 症状 | 原因 / 対処 |
|---|---|
| デプロイ後に「Supabase に接続できませんでした」 | env vars 未設定 → Vercel Settings 確認 |
| 設定 dialog で URL 保存できない | Supabase の `app_settings` テーブル未作成 → schema.sql 再実行 |
| カテゴリー追加でエラー | RLS ポリシー未適用 → schema.sql 再実行 |
| Discord 取り込みボタンで `not configured` | `CRON_SECRET` または `DISCORD_BOT_TOKEN` 未設定 |
| `scanned 0` ばかり | Bot がチャンネルを見えていない → 5-3 を再確認 |
| メンバーがホームでオンボーディング表示 | スケジュール URL が DB に未保存 → 設定 dialog で**保存**を押す |

## Local development

```bash
npm install
cp .env.local.example .env.local  # Supabase keys を記入
npm run dev
```

Open http://localhost:3000

## Schema migration

`supabase/schema.sql` は冪等です。スキーマ変更があったら同じ SQL を再実行すれば反映されます。

## License

MIT
