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

このリポジトリを自分の固定で使う手順：

### 1. Fork

GitHub 右上の **Fork** ボタンから自分のアカウントにコピー。

### 2. Supabase プロジェクト作成

1. https://supabase.com で新規プロジェクト作成（Tokyo リージョン推奨）
2. **SQL Editor** で `supabase/schema.sql` を実行（冪等なので何度でも安全）
3. Settings → API で **Project URL** と **anon key** をメモ

### 3. Vercel デプロイ

1. https://vercel.com/new で fork したリポジトリを Import
2. **Environment Variables** に以下を設定：
   | Name | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | Supabase の Project URL |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase の anon key |
3. **Deploy** クリック

### 4. 初期設定

デプロイ完了後の Vercel URL を開いて：
1. **ヘッダーの ⚙️ 設定**から character-sheets のスケジュール URL を登録
2. **カテゴリー追加**で自分達のレイドコンテンツを登録
3. 必要に応じて編集ダイアログで Google Sheets URL（軽減表・ロット管理）を設定

### 5. Discord 自動取り込みを使う場合（任意）

1. https://discord.com/developers/applications で Bot 作成
2. Bot ページで **MESSAGE CONTENT INTENT** を ON
3. OAuth2 → URL Generator で Bot を自分の Discord サーバーに招待
   - 必要権限: View Channels, Read Message History
4. 取り込み対象の各チャンネルで Bot にアクセス権を付与
5. Vercel に追加の環境変数：
   | Name | Value |
   |---|---|
   | `DISCORD_BOT_TOKEN` | Discord Developer Portal の Bot Token |
   | `CRON_SECRET` | ランダムな文字列（任意の十分長い値） |
6. カテゴリー編集ダイアログで Discord チャンネル ID を入力
7. 設定後、`/category` ページの「Discord 取り込み」ボタンで動作確認

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
