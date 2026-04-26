# Raid Repository

FF14 レイド固定向けポータル — スケジュール / 軽減表 / ロット管理 / 攻略情報 / 動画 を一箇所に。

**Production**: https://raid-repository.vercel.app/

## What it does

### スケジュール
- character-sheets.appspot.com の予定一覧を取り込み
- 「日程確定」(`DECISION`) 行を抽出して**次回開催日**を強調表示
- メンバー名のホバー（PC）/ タップ（モバイル）でその人の一言コメントをポップアップ
- 名前クリックで character-sheets の自分の入力画面に直行
- 過去日程トグル（デフォルト非表示）
- スケジュール URL は cookie + localStorage で per-browser 上書き可能

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

### Discord 自動取り込み
- カテゴリーごとに「攻略チャンネルID」「動画チャンネルID」を設定可能
- Vercel Cron が**毎日 09:00 JST** に各チャンネルの直近100件を pull
- URL 抽出 + 重複排除 + ページタイトル自動取得 → 該当サブタブに自動投入

### テーマ
7つの FF14 拡張テーマ（拡張ごとに専用エフェクト）：

| テーマ | エフェクト |
|---|---|
| ARR (新生) | 斜めに流れる流星 + 微細な星屑 |
| Heavensward (蒼天) | ステンドグラスの格子 + 黄金の光柱 |
| Stormblood (紅蓮) | 砂漠の地層 + 横に流れる砂塵 |
| Shadowbringers (漆黒) | 虚無に降り注ぐシンイーターの光 + 漂うエーテルの粒子 |
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

## For other raid groups

このリポジトリは「1 グループ = 1 デプロイ」を前提に作られています（マルチテナント設計ではない）。
別の固定で使いたい場合：

1. **このリポジトリを fork**
2. 新規 **Supabase プロジェクト** を作成 → SQL Editor で `supabase/schema.sql` を実行
3. **Vercel** で fork 先を import → 環境変数を設定:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
4. デプロイ後、ヘッダーの ⚙️ 設定からスケジュール URL を登録
5. （任意）Discord 自動取り込みを使う場合：
   - Discord Developer Portal で Bot 作成（**MESSAGE CONTENT INTENT を ON**）
   - Bot をサーバーに招待（Read Messages + Read Message History 権限）
   - Vercel に環境変数追加: `DISCORD_BOT_TOKEN`, `CRON_SECRET`（ランダム文字列）
   - カテゴリー編集ダイアログで Discord チャンネル ID を入力

## Local development

```bash
npm install
# Supabase keys を .env.local に設定
npm run dev
```

Open http://localhost:3000

## Schema migration

`supabase/schema.sql` は冪等。スキーマ変更があったら同じ SQL を再実行すれば反映されます。

## Phase history

- **Phase 1**: UIシェル + 7テーマ + テーマ別エフェクト
- **Phase 2**: Supabase + Realtime + カテゴリー CRUD + DnD + ステータス編集
- **Phase 3**: スプシ埋込 (軽減表/ロット管理) + リンク管理 (攻略/動画) + UX 修正
- **Phase 4**: Discord 自動取り込み（Vercel Cron + Bot）
