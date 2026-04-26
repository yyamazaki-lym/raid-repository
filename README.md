# Raid Repository

FF14 レイド固定向けポータル — スケジュール / 軽減表 / ロット管理 / 攻略情報 / 動画 を一箇所に。

「1グループ = 1デプロイ」前提で作られた、自分の固定で fork して使うシングルテナントアプリです。

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
- Supabase (Postgres + Realtime; RLS 全開放、anon key 運用)
- shadcn/ui + Base UI primitives
- @dnd-kit (DnD 並べ替え)
- motion (タブアニメーション)
- Vercel auto-deploy from GitHub `main`
- Vercel Cron Jobs (Discord 取り込み)

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

1. このリポジトリの右上 **Fork** ボタン
2. 自分のアカウントを選択 → **Create fork**
3. （任意）Settings → 名前を変更しても OK

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
2. 以下の**2つの値**をコピーしてメモ（次のステップで使う）：
   | 項目 | 場所 |
   |---|---|
   | **Project URL** | Project URL 欄（`https://xxxxx.supabase.co` 形式） |
   | **anon public** key | Project API keys → `anon` `public` 行の長い文字列 |

> ⚠️ `service_role` key は使わないでください（管理者権限なので公開すると危険）。

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

**Environment Variables** セクションを展開：

| Name | Value | Environments |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | 2-3 の Project URL | Production / Preview / Development 全部 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 2-3 の anon key | Production / Preview / Development 全部 |

各行で **Add** をクリックして登録。

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
2. デフォルトでアルカディア3階級が seed されているので、**自分達のコンテンツに編集**するか、削除して新規追加：
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
