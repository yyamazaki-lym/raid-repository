# Raid Repository

FF14 レイド固定向けポータル — スケジュール / 軽減表 / ロット管理 / 攻略情報 / 動画 を一箇所に。

「1グループ = 1デプロイ」前提で作られた、自分の固定で fork して使うシングルテナントアプリです。

## Live demo

実際の使用感を確認できる公開モックサイト (read-only):

🔗 **https://demo-raid-repository.vercel.app**

サンプルデータ (7 カテゴリ + 過去 8 週分のスケジュール + 軽減表 / ロット表 / 攻略リンク / 動画リンク / マクロ / 募集文等) が seed 済 (`supabase/seed-demo.sql` 由来、demo project にのみ適用)。`PUBLIC_DEMO_MODE=true` で Discord OAuth gate を skip しつつ、書き込みは admin gate で全件弾く 4 層防御 (proxy / ページ / Server Action / RLS) で閲覧専用にしています。

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
- ソースモードを設定ダイアログから 3 択で選択：**同期式**（character-sheets 取り込み、デフォルト）/ **自前作成式**（portal 内で候補日の追加・出欠入力・開催確定まで完結、FFLogs 連携 + Discord 通知対応）/ **使わない**（機能停止）
- 「日程確定」(`DECISION`) 行を抽出して**次回開催日**を強調表示（本日は「開始まで N 時間 M 分」のカウントダウン付き）
- 自前作成式では ○×△ に加えて**遅刻の到着予定 / 早退の予定時刻**（HH:MM）を本人が入力可。出欠表の記号の横に `21:30〜` と表示され、Discord の確定通知でも名前の横に出る
- Discord 通知（開催確定 / 出欠催促）のテンプレートで `{discord_relative}` / `{discord_time}` が使え、読む側のタイムゾーンで「3 時間後」「9月8日(火) 21:00」に置き換わる
- メンバー名のホバー（PC）/ タップ（モバイル）でその人の一言コメントをポップアップ
- 過去日程トグル（デフォルト非表示）
- 同期式では character-sheets.appspot.com の予定一覧を取り込み。名前クリックで character-sheets の自分の入力画面に直行
- スケジュール URL は **Supabase の `app_settings` テーブルで全員共有**
  （誰かが登録すれば全員に反映 / リロードで取得）

### コンテンツ（カテゴリー）
- レイドコンテンツ単位で **ステータス**（未着手 / 練習中 / クリア済 / 休止中）を切替
- ドラッグで並び替え（マウス + 長押しタッチ + キーボード対応）
- 編集ダイアログから名前 / URL識別子 / ステータス + 各種URL + Discord チャンネルIDを設定
- 削除確認ダイアログ付き
- Supabase Realtime でメンバー全員に即時同期

### サブタブ（コンテンツごと）
- **軽減表 / ロット管理**: 既存 Google Sheets を iframe で全幅表示（80% スケール）
  - **モバイルは読み取り専用カード表示**（シートを CSV で取得してフェーズ単位のカードに再構成、「自分の担当だけ」フィルタ付き）。取得できない場合は従来の iframe にフォールバック
  - ロットタブには **今週の消化チェック**（火 17:00 JST リセット基準、未消化人数バッジ）と **最適装備 (BiS) リンク**（XivGear 等の共有 URL をジョブ / 担当者付きで登録）
- **攻略情報**: wiki/記事リンクの一覧、DnD 並べ替え、URL からタイトル自動取得
- **動画**: YouTube はサムネ + クリック再生（lazy embed）、他の動画サイトはリンクカード
  - オプションで FFLogs URL を登録可能（ワンタップで FFLogs のレポートページへ / **XIVAnalysis の解析ページへ**）
- **マクロ**: ゲーム内マクロをラベル + 本文で保存、ワンタップコピー、DnD 並べ替え
  - 同じタブに **ウェイマーク (markercode)** セクション。EchoPlan 等が出力する配置文字列をラベル + メモ付きで保存し、ワンタップコピー
- **練習ログ**: FFLogs の pull 単位データを取り込んで表示
  - 総 pull / 練習日数 / 最深到達 / クリア回数のサマリと、日ごとの**到達度バー**（バー = ベスト到達度、右端 = 討伐、自己ベスト更新日にフラグ）
  - フェーズ (P1〜) 表記は**絶コンテンツのみ**（零式は残 HP% で表示）。雑魚戦 (Trash Fights) は取り込み時に除外
  - 日付を開くと pull 一覧。各 pull から **FFLogs の該当 fight / XIVAnalysis の解析 / 動画のその瞬間** へ 1 クリック
  - 動画へのジャンプは report ごとに「レポート開始が動画の何秒地点か」を 1 度登録すれば全 pull で有効
  - 各 pull に**ワイプ原因**（最初に落ちたジョブ略称 ← 致命の一撃の技名、10 秒以内の同時死亡数）。日ごと / コンテンツ全体で「どの技で崩れているか」を集計
  - 絶は **フェーズ滞在時間**（pull ごとのフェーズ帯バーと、全 pull 合計の割合）
  - 個人 DPS は集計も表示もしない（PT としての到達度のみ）。死亡もプレイヤー名は保存せずジョブ + 技名まで

### Discord 自動取り込み
- コンテンツごとに「攻略チャンネルID」「動画チャンネルID」を設定可能
- Vercel Cron が**毎日 01:00 JST** に各チャンネルの直近100件を pull
- URL 抽出 + 重複排除 + ページタイトル自動取得 → 該当サブタブに自動投入
- コンテンツ単位で**取り込みの一時停止**トグル
- コンテンツ一覧の「**Discord 取り込み**」ボタンで**手動即時実行**
  （コンテンツごとに `+件数 / 重複 / 失敗 / scanned 0` を表示）
- 取り込まれたリンクには**指紋アイコン**が付与され、手動登録分と区別可能
- コンテンツカードに**過去 7 日の取り込み件数バッジ** (`+N/wk`)

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
- Vercel Cron Jobs (Discord 取り込み / FFLogs 同期)

### セキュリティ防御層

2.1 で 4 段の多重防御を導入済:

1. **proxy.ts**: Discord OAuth gate — guild メンバー以外を `/login` / `/auth/denied` にリダイレクト
2. **ページ単位**: `categories.required_role_ids` で個別カテゴリへのロール制限
3. **Server Action 入口**: `assertAdminResult()` で admin ロール限定 (categories CRUD / app_settings / FFLogs / 動画メタ系すべて)
4. **DB 層 (RLS)**: INSERT/UPDATE/DELETE は `auth.jwt()->'app_metadata'->>'is_admin' = 'true'` を要求。SELECT は anon + authenticated 全開 (公開読み取り温存)

その他: CSP / HSTS / X-Frame-Options / Referrer-Policy / Permissions-Policy 全付与、`/auth/callback` + `/api/cron/*` に rate limit、FFLogs token は AES-256-GCM 暗号化保管 (`secrets` テーブル)、Server Action の DB エラー文言は汎用化済 (生 PG エラー漏洩防止)。

> 📌 **非 Vercel で自己ホストする場合の注意 (rate limit)**: レート制限は接続元 IP の特定に `x-real-ip` ヘッダを優先します。Vercel は常にこれを実接続元 IP で設定するため、標準構成 (Vercel + 任意の DNS CNAME / カスタムドメイン) では安全です。`x-real-ip` を付与しない reverse proxy (自前 nginx 等) を前段に挟んで自己ホストする場合のみ、**その proxy で `x-real-ip` を実接続元 IP に必ず設定してください**。さもないと攻撃者が `x-forwarded-for` を毎リクエスト偽装してレート制限を回避できます。

## Setup for your raid group

> 📌 **2026-05 改訂**: Step 構成を Discord 認証先行順に再編しました。`DISCORD_BOT_TOKEN` / `DISCORD_GUILD_ID` および Discord Application の Client ID / Secret は Vercel デプロイ前に必要なので、新 Step 3 / 4 でまとめて取得・設定します。

このリポジトリを自分の固定で使う手順。所要時間は 30〜60分（うち Discord 自動取り込みのチャンネル個別設定は任意で +10分）。

### 必要なもの

| 必須 | アカウント / ツール | 用途 |
|---|---|---|
| ✅ | [GitHub](https://github.com) | リポジトリ管理（無料） |
| ✅ | [Supabase](https://supabase.com) | DB + Realtime（無料枠で十分） |
| ✅ | [Vercel](https://vercel.com) | ホスティング（Hobby 無料枠で十分） |
| ✅ | [Discord Developer](https://discord.com/developers/applications) | OAuth gate (guild メンバー判定) + 自動取り込み |

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

> 📌 **本番 / 実際の固定で使う場合**: schema.sql の実行のみで OK。`/category` は空 portal で起動するので、運営者が固定で扱うコンテンツを「+ コンテンツ追加」から登録してください。
>
> 📌 **demo / モックサイト用にデプロイする場合のみ**: 続けて [`supabase/seed-demo.sql`](./supabase/seed-demo.sql) を同様に SQL Editor で実行すると、demo 表示用のサンプルカテゴリ 7 件 + サンプルデータ (動画 / 軽減 / ロット / 募集文等) が一括投入されます。**本番運用では実行しないでください** — 本番テーブルに demo データが混入します。冪等 (ON CONFLICT / sentinel / URL NOT EXISTS guard) なので demo project への再実行は安全。
>
> 📌 **GitHub Actions で自動反映したい場合 (任意)**: `supabase/schema.sql` を更新する main push のたびに自動で SQL Editor 相当の処理を走らせる workflow を同梱しています。Supabase 接続文字列を repo secret に登録するだけで以後手動コピペ不要。手順は **[10. (任意) GitHub Actions で schema 自動反映](#10-任意-github-actions-で-schema-自動反映-5分)** を参照。

#### 2-3. 認証情報を取得

1. 左メニュー **Settings**（歯車）→ **API**
2. 以下の **3 つの値**をコピーしてメモ（Step 5 で使う）：
   | 項目 | 場所 |
   |---|---|
   | **Project URL** | Project URL 欄（`https://xxxxx.supabase.co` 形式） |
   | **anon public** key | Project API keys → `anon` `public` 行の長い文字列 |
   | **service_role** key | 同上 → `service_role` 行 |

> ⚠️ `service_role` key は **絶対にブラウザ側に出さない**でください（RLS をバイパスする全権限キー）。Vercel の Environment Variables (server-only) に登録するのみで、`NEXT_PUBLIC_` プレフィックスは付けない。サーバー側の `/auth/callback` で Discord メンバーシップ判定を `app_metadata` に書き込むために必要。

> 💡 ここで控えた **Project URL** のサブドメイン部 (例: `xxxxx.supabase.co` の `xxxxx`) は次の Step 4 で Discord Developer Portal に登録する Redirect URI にも使うのでメモしておくこと。

---

### 3. Discord Application + Bot 作成 (10分, 必須)

Discord guild メンバーシップが portal の **OAuth 認証ゲート**になっているため、Bot 取り込み機能を使わない場合でもここの設定は必須です。Application (OAuth) と Bot は同じ画面内で 1 アプリにまとめて作ります。

#### 3-1. Application を作成

1. https://discord.com/developers/applications にログイン
2. 右上 **New Application** → 名前 (例: `Raid Repository`) → **Create**
3. 左メニュー **General Information** で名前 / アイコンを必要に応じて調整

#### 3-2. OAuth2 の Client ID / Client Secret を取得

1. 左メニュー **OAuth2** → **OAuth2** ページ
2. **CLIENT ID** をコピーしてメモ
3. **CLIENT SECRET** 欄の **Reset Secret** ボタンを押し、表示された Secret をコピーしてメモ
   - 一度しか表示されないので必ず控えること。漏れたら同じ画面で再 Reset 可

> ⚠️ Client Secret は **Supabase の Authentication プロバイダ設定欄にだけ貼る値**。Vercel の Environment Variables や `.env.local` には登録しません。

#### 3-3. Bot を有効化 + Intent を ON + Token を取得

1. 左メニュー **Bot**
2. ページを下にスクロールして **Privileged Gateway Intents** セクション:
   - **SERVER MEMBERS INTENT** を **ON** （OAuth gate で guild メンバー判定に必須）
   - **MESSAGE CONTENT INTENT** を **ON** （自動取り込みで添付メッセージ本文を読むため必須）
   - 他は OFF のままで OK
   - 下部 **Save Changes**
3. 同じ Bot ページの **Token** セクション → **Reset Token** → 表示された**トークンをコピー**して保管（一度しか表示されない、Step 5 の `DISCORD_BOT_TOKEN` で使用）

#### 3-4. Discord サーバー ID (Guild ID) を取得

1. Discord 本体アプリの **設定 → 詳細設定 → 開発者モード** を ON
2. 左サイドバーの自分のサーバーアイコンを**右クリック → サーバー ID をコピー**
3. メモ（Step 5 の `DISCORD_GUILD_ID` で使用）

> 💡 ここまでで「Client ID / Client Secret / Bot Token / Guild ID」の 4 つが揃っていることを確認してから次へ。

---

### 4. Discord ↔ Supabase OAuth 連携 (5分, 必須)

Step 2 と Step 3 で取得した値を使い、Discord Developer Portal と Supabase ダッシュボードを双方向に紐付けます。**Vercel デプロイより前にここまで終わらせておくと、デプロイ直後にログインを試せます** (URL Configuration の Vercel ドメイン側は Step 7 で追記)。

#### 4-1. Discord Developer Portal → OAuth2 → Redirects

1. Step 3 で開いた Application の **OAuth2** ページ
2. **Redirects** セクションで **Add Redirect** → 以下を貼り付け:
   ```
   https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback
   ```
   - `YOUR_PROJECT_REF` は Step 2-3 で控えた Supabase Project URL のサブドメイン部
   - これは Supabase 側の固定 callback URL なので、Vercel ドメインが変わっても Discord 側設定の変更は不要
3. **Save Changes**

#### 4-2. Supabase Dashboard → Authentication → Providers

1. https://supabase.com/dashboard で対象プロジェクトを開く
2. 左メニュー **Authentication → Providers**
3. **Discord** を展開 → **Enable Discord provider** を ON
4. **Client ID** に Step 3-2 でコピーした Client ID を貼り付け
5. **Client Secret** に Step 3-2 でコピーした Client Secret を貼り付け
6. **Save**

> 📌 Site URL / Redirect URLs（=Vercel ドメイン側の登録）は Vercel のドメインが確定する Step 7 で行います。ここではまだ空のままで OK。

---

### 5. Vercel デプロイ (5分)

#### 5-1. プロジェクトをインポート

1. https://vercel.com/login で GitHub ログイン
2. https://vercel.com/new
3. **Import Git Repository** で fork したリポジトリを探す
   - 初回は **Adjust GitHub App Permissions** で fork を含むようアクセス権限を調整
4. **Import** クリック
5. **Configure Project** 画面：
   - Framework Preset: **Next.js**（自動検出）
   - そのまま下にスクロール

#### 5-2. 環境変数を設定

**Environment Variables** セクションを展開して以下を登録（必須/任意の区別は `.env.local.example` に詳細あり、すべて Production / Preview / Development 全部にチェック）。

#### 必須

| Name | Value | 用途 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Step 2-3 の Project URL | DB 接続 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Step 2-3 の anon key | DB 接続 (read 専用相当、書き込みは RLS で admin 限定) |
| `SUPABASE_SERVICE_ROLE_KEY` | Step 2-3 の service_role key | OAuth callback で `app_metadata` 書き込み + secret 暗号化テーブル（⚠️ NEVER expose to browser） |
| `DISCORD_BOT_TOKEN` | Step 3-3 で取得した Bot トークン | OAuth gate で guild メンバーシップ判定 + 自動取り込み |
| `DISCORD_GUILD_ID` | Step 3-4 で取得した Discord サーバー ID | OAuth gate のメンバー判定対象 |

`SUPABASE_SERVICE_ROLE_KEY` 等の **server-only** 変数は `NEXT_PUBLIC_` プレフィックスを **絶対付けない**。付けるとブラウザバンドルに含まれて漏洩します。

#### 推奨 / 任意

| Name | Value | 用途 |
|---|---|---|
| `DISCORD_ADMIN_ROLE_IDS` | カンマ区切り Discord ロール ID | カテゴリ編集等を admin ロール所有者のみに制限 (未設定 = 全員 admin、後方互換) |
| `CRON_SECRET` | 32 文字以上のランダム文字列 | Vercel Cron 認証 (自動取り込みを使う場合は必須) |
| `NEXT_PUBLIC_SPLASH_SW` | `true` | cold start 中の白画面を「起動中」スプラッシュに置き換える Service Worker (`public/sw.js`) を有効化。Production のみで可。未設定/false = 登録なし + 既登録 SW を自動解除 (キルスイッチ)。ビルド時インライン化のため切替には再デプロイが必要 |
| `YOUTUBE_API_KEY` | YouTube Data API v3 キー | 限定公開動画の duration / uploadDate 取得 (未設定だと HTML scrape fallback、Vercel IP の bot 検出で失敗することあり) |
| `SECRET_ENCRYPTION_KEY` | 64 文字 hex (`openssl rand -hex 32`) | FFLogs token 等の AES-256-GCM 暗号化保管 (未設定だと旧 `app_settings` 平文保存にフォールバック) |
| `FFLOGS_API_KEY` | FFLogs API v1 キー | レポート ↔ 動画 自動マッチ (Public レポート対象) + 練習ログの **unlisted レポート取得** (URL 登録済みの code 直指定。xivanalysis と同じ経路) |
| `FFLOGS_OAUTH_CLIENT_ID` | FFLogs OAuth Client ID | **Private / Unlisted** レポートの自動マッチ用 (Authorization Code Flow)。v1 で十分なら未設定可 |
| `FFLOGS_OAUTH_CLIENT_SECRET` | FFLogs OAuth Client Secret | 同上 (server-only)。詳細手順は `.env.local.example` |

`CRON_SECRET` 生成例（PowerShell）：
```powershell
-join ((48..57) + (65..90) + (97..122) | Get-Random -Count 32 | % {[char]$_})
```

または Bash:
```bash
openssl rand -hex 16
```

#### 5-3. デプロイ実行

1. **Deploy** ボタン
2. 1〜2分待つ（ビルドログがリアルタイム表示）
3. 完了すると `https://your-project-name.vercel.app` の URL が払い出される — この URL は Step 7 で使うのでコピーしておく

#### 5-4. （任意）カスタムドメイン

`raid.example.com` のような自前ドメインを使いたい場合は **Settings → Domains** から追加できます。Cloudflare などの DNS で CNAME を Vercel に向ける流れ。Step 7 の Supabase URL Configuration ではカスタムドメイン側を Site URL にすると運用が綺麗。

---

### 6. Bot を Discord サーバーに招待 (3分)

Step 3 で作った Application を、自分の固定サーバーに Bot として参加させます。OAuth gate のメンバー判定だけなら参加させなくても通る場合がありますが、**`SERVER MEMBERS INTENT` を通じて guild member API を呼ぶには Bot が当該 guild に在籍している必要がある**ため、必ずこの Step を実行してください。

1. Step 3 で開いた Application の左メニュー **OAuth2 → URL Generator**
2. **Scopes**: `bot` にチェック
3. **Bot Permissions**:
   - `View Channels`
   - `Read Message History`
4. 下に生成された **GENERATED URL** を新タブで開く
5. 自分の Discord サーバーを選択 → **認証**

> 💡 自動取り込み用にチャンネル個別の権限上書きを設定する場合は Step 9 を参照。

---

### 7. デプロイ後の Supabase URL Configuration 更新 (3分, 必須)

Vercel ドメインが Step 5 で確定したので、Supabase Auth に登録します。**これを忘れると Discord OAuth ログイン後の戻り先で `redirect_uri_mismatch` エラー** になります。

1. Vercel ダッシュボード → 対象プロジェクト → **Settings → Domains** で Production URL を確認 (例: `your-project-name.vercel.app`)
2. https://supabase.com/dashboard で対象プロジェクトを開く
3. 左メニュー **Authentication → URL Configuration**
4. **Site URL** に Vercel ドメインを設定:
   ```
   https://<your-vercel-domain>
   ```
5. **Redirect URLs** に以下 2 つを追加:
   ```
   https://<your-vercel-domain>/auth/callback
   http://localhost:3000/auth/callback
   ```
   - `**` ワイルドカード形式 (`https://<your-vercel-domain>/**`) も併用しておくと preview deploy の戻り先まで広くカバーできる
6. **Save**

> 📌 後からカスタムドメインや別 Vercel プロジェクト名にリネームする場合の手順は [`.claude/todos/20.md`](./.claude/todos/20.md) を参照 (Site URL / Redirect URLs / FFLogs OAuth の同時更新が必要)。

#### 7-1. ログイン動作確認

1. `https://<your-vercel-domain>/` を開く → `/login` にリダイレクトされる
2. **Discord でログイン** ボタンを押す → Discord の OAuth 同意画面 → portal TOP に着地すれば OK
3. 着地しない場合のチェックポイント:
   - Site URL が **新ドメイン**になっているか (`raid-repository.vercel.app` のまま等になっていないか)
   - Redirect URLs に `https://<your-vercel-domain>/auth/callback` が exact match で入っているか
   - Discord Developer Portal の Redirects に `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback` が exact match で入っているか
   - Vercel の env に `DISCORD_BOT_TOKEN` / `DISCORD_GUILD_ID` が入っているか (= Step 5-2 のチェック)
   - Bot が Step 6 で実際に guild に参加しているか

---

### 8. 初期設定 (5分)

デプロイ完了 URL を開きます。最初は何も登録されていない状態です。

#### 8-1. スケジュール URL の登録

1. ヘッダー右上の **⚙️ 設定**アイコンをクリック
2. **Schedule Source** セクションで character-sheets の URL を入力
   - 形式: `https://character-sheets.appspot.com/schedule/list?key=...`
   - character-sheets でスケジュール未作成の場合は https://character-sheets.appspot.com/schedule/ で先に作成
3. **保存**
4. ホームに戻ると次回開催日 + 日程一覧が表示されるはず

> この URL は Supabase の `app_settings` テーブルに保存され、**全メンバーで共有**されます。誰か1人が登録すれば全員に反映。

#### 8-2. コンテンツの追加・編集

1. 上部タブ **コンテンツ** へ
2. 最初は空の状態なので、右上 **+ コンテンツ追加** から自分達のコンテンツを登録（登録後の編集・削除はカードの **⋮** メニューから）
3. 編集ダイアログ各項目：
   | 項目 | 説明 |
   |---|---|
   | 名前 | 表示名（例: 万魔殿パンデモニウム:辺獄編） |
   | URL識別子 | URLパスに使う英数字-（例: `pandaemonium-edge`） |
   | 説明文 | カードに表示する補足テキスト（任意） |
   | ステータス | 未着手 / 練習中 / クリア済 / 休止中 |
   | 軽減表 URL | Google Sheets の埋め込み URL（任意） |
   | ロット管理 URL | 同上（任意） |
   | Discord チャンネル ID | 後述（任意） |
4. **保存**

#### 8-3. Google Sheets URL の取得方法

軽減表・ロット管理用のスプレッドシート URL は以下の形式が使えます：

| 種類 | 形式 | 取得方法 |
|---|---|---|
| 公開URL | `.../pubhtml` | Sheets で **ファイル → 共有 → ウェブに公開** |
| 埋め込み URL | `.../e/.../pubhtml?widget=true` | 同上、ウェブに公開時 |
| 通常の共有URL | `.../edit#...` | 共有設定が「リンクを知っている全員が閲覧可」の場合のみ |

#### 8-4. 動作確認

- ホームにスケジュール表示
- コンテンツカードをクリック → **軽減表 / ロット管理 / 攻略情報 / 動画 / マクロ** タブが表示
- 攻略情報・動画タブで「**+ 追加**」からリンク登録できる

---

### 9. (任意) Discord 自動取り込みのチャンネル個別設定 (10分)

毎日 1回、指定 Discord チャンネルから URL を自動取得して攻略情報・動画タブに投入する機能。Step 3 / 6 で Bot 本体の作成と guild 参加は済んでいるので、ここでは「Bot にチャンネル単位の閲覧権限を付ける」「コンテンツごとにチャンネル ID を登録する」の 2 点を行います。

> 📌 Step 5 の env で `CRON_SECRET` を未登録の場合は、ここで Vercel ダッシュボード → Settings → Environment Variables に追加して **Deployments → 最新行の ⋯ → Redeploy** してください（環境変数は再ビルド時のみ反映）。

#### 9-1. チャンネル個別の権限上書き

サーバー全体での Bot 権限と、各チャンネルの権限上書きは別です。**取り込み対象チャンネルそれぞれ**で：

1. Discord で対象チャンネル右クリック → **チャンネルの編集**
2. 左メニュー **権限**
3. **メンバーまたはロールを追加** → Bot 名を検索 → 追加
4. 以下を許可（緑のチェック）：
   - **チャンネルを表示**
   - **メッセージ履歴を読む**
5. **変更を保存**

> 💡 攻略・動画チャンネルが各コンテンツに 2 つずつあるなら、Bot 専用ロールを作って一括許可する方法もあります。

#### 9-2. チャンネル ID を取得して portal に登録

1. Discord 設定 → **詳細設定** → **開発者モード** を ON (Step 3-4 で済ませていれば不要)
2. 取り込み対象チャンネルを**右クリック → IDをコピー**
3. アプリのコンテンツ編集ダイアログで「Discord 攻略チャンネルID」「Discord 動画チャンネルID」欄に貼り付け
4. **保存**

#### 9-3. 動作確認

`/category` ページの **Discord 取り込み** ボタン → クリック後、結果がボタン下に表示：

- ✅ `+N 件取り込み (...)` → 成功
- ℹ️ `Discord メッセージから URL を検出できず` → チャンネル空 or Bot 権限不足（9-1 を見直し）
- ⚠️ `失敗 N` → DB 接続エラーなど（Vercel ログで詳細確認）
- ❌ `エラー: discord 401/403/...` → Bot Token または権限の問題

正常動作を確認できたら、毎日 01:00 JST に自動実行されます（`vercel.json` の cron schedule）。手動でも `/category` のボタンからいつでも実行可。

---

### 10. (任意) GitHub Actions で schema 自動反映 (5分)

`supabase/schema.sql` が更新されたとき (upstream `git pull` → `git push`、または自分でスキーマを編集したとき)、Supabase Dashboard で手動コピペする代わりに **push 1 回で自動反映**できます。

**この設定をしないとどうなる?**
- 設定しなくても今までどおり手動運用できます (Step 2-2 と同じやり方)
- ただし upstream に schema 拡張が入るたびに SQL Editor で再実行する手間がかかります

#### 10-1. 接続文字列を取得

1. Supabase ダッシュボード → **Settings → Database → Connection string**
2. **Session pooler** タブを選択 (CI 向け、`postgres.<ref>` ユーザー)
   - "Direct connection" は Free plan で IPv6 のみ提供で GitHub Actions runner から繋がりません。**Session pooler を必ず選択**
3. URI 形式の文字列をコピー (`postgresql://postgres.xxxxx:[YOUR-PASSWORD]@aws-0-...:5432/postgres` 形式)
4. `[YOUR-PASSWORD]` を Step 2-1 で保管した DB パスワードに置換

#### 10-2. GitHub repo secret に登録

1. fork した GitHub repo → **Settings → Secrets and variables → Actions** → **New repository secret**
2. 入力:
   | 項目 | 値 |
   |---|---|
   | Name | `SUPABASE_DB_URL` |
   | Value | 10-1 で組み立てた URI 全体 |
3. **Add secret**

#### 10-3. 動作確認

- これだけです。次回 `supabase/schema.sql` を含む main push が入ると、**Actions** タブで "Deploy Database (Production)" workflow が自動実行され schema が反映されます
- (任意) Actions タブ → "Deploy Database (Production)" → 右上 **Run workflow** で手動 trigger も可能
- workflow が失敗した場合は psql のエラーメッセージがログに出るので原因が読めます。`schema.sql` は冪等なので何度でも再 run 可能

> 📌 **secret を登録しなかった fork の挙動**: workflow は冒頭で `Skipping: SUPABASE_DB_URL not set on this fork.` とログを出して即 success 終了します。Actions タブが緑のチェックで埋まる (赤い印は付かない) ので、手動運用を続けたい人は無視して OK。

> 📌 **demo project 用の workflow** (`deploy-database-demo.yml`): upstream 元 (`yyamazaki-lym/raid-repository`) でだけ動かす demo 専用 workflow も同梱しています。各 fork ユーザーには無関係 (secret 未登録で常に skip)。誤って自分の本番プロジェクトに seed-demo.sql を流さないよう、本番 fork では絶対に `SUPABASE_DB_URL_DEMO` secret を登録しないでください。

---

### スキーマ更新時の対応

将来このリポジトリを `git pull` で最新化した時にスキーマが拡張されている場合：

1. プルしたコードに含まれる新しい `supabase/schema.sql` をそのまま Supabase SQL Editor で再実行
   - **[Step 10](#10-任意-github-actions-で-schema-自動反映-5分) を設定済の場合は `git push origin main` するだけで GitHub Actions が自動反映**するので SQL Editor は不要です
2. すべての `CREATE TABLE` / `ALTER TABLE` が `IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` で書かれているので**冪等**
3. 既存データは破壊されません

### よくあるトラブル

| 症状 | 原因 / 対処 |
|---|---|
| デプロイ後に「Supabase に接続できませんでした」 | env vars 未設定 → Vercel Settings 確認 |
| Login で `redirect_uri_mismatch` | Step 7 (Supabase URL Configuration) の Redirect URLs に新ドメイン `/auth/callback` が exact match で入っているか確認 |
| Login 後すぐ `/auth/denied` に飛ぶ | (1) Bot が guild に参加していない (Step 6) / (2) `SERVER MEMBERS INTENT` が OFF (Step 3-3) / (3) `DISCORD_GUILD_ID` が誤り (Step 5-2) のいずれか |
| 設定 dialog で URL 保存できない | Supabase の `app_settings` テーブル未作成 → schema.sql 再実行 |
| コンテンツ追加でエラー | RLS ポリシー未適用 → schema.sql 再実行 |
| Discord 取り込みボタンで `not configured` | `CRON_SECRET` または `DISCORD_BOT_TOKEN` 未設定 |
| `scanned 0` ばかり | Bot がチャンネルを見えていない → Step 9-1 を再確認 |
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
