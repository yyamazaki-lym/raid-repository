# Raid Repository

FF14 レイド固定向けポータル — スケジュール / 軽減表 / ロット管理 / 攻略情報 / 動画 を一箇所に。

**Production**: https://raid-repository.vercel.app/

## What it does

- **スケジュール**: character-sheets.appspot.com の予定一覧を取り込んで、次回開催日（DECISION 行）を抽出表示。各メンバー名のホバー / タップで一言コメントをポップアップ
- **カテゴリー**: レイドコンテンツごとにステータス（未着手 / 練習中 / クリア済）+ 並び替え + DnD。Supabase Realtime でメンバー全員に即時同期
- **軽減表 / ロット管理**: 既存の Google Sheets を iframe で埋め込み (URLはカテゴリーごとに登録)
- **攻略情報**: 攻略wiki / 記事 / Twitter リンクの一覧
- **動画**: YouTube はサムネ + クリック再生、他の動画サイトはリンクカード

7つの FF14 拡張テーマ（ARR / HW / SB / ShB / EW / DT / Evercold）切替対応。
スマホでも横スクロール + DnD long-press で操作可能。

## Tech

- Next.js 16 + React 19 + Tailwind CSS v4
- Supabase (Postgres + Realtime; RLS 全開放、anon key 運用)
- shadcn/ui + Base UI primitives
- @dnd-kit (DnD 並び替え)
- motion / framer-motion (タブアニメーション)
- Vercel auto-deploy from GitHub `main`

## For other raid groups

このリポジトリは「1グループ = 1デプロイ」を前提に作られています（マルチテナント設計ではない）。
別の固定で使いたい場合：

1. **このリポジトリを fork**
2. 新規 **Supabase プロジェクト** を作成 → SQL Editor で `supabase/schema.sql` を実行
3. **Vercel** で fork 先を import → 環境変数 `NEXT_PUBLIC_SUPABASE_URL` と `NEXT_PUBLIC_SUPABASE_ANON_KEY` を設定
4. デプロイ後、ヘッダーの ⚙️ 設定アイコンから character-sheets のスケジュール URL を登録 → 完了

## Local development

```bash
npm install
cp .env.local.example .env.local  # Supabase keys を記入
npm run dev
```

Open http://localhost:3000

## Schema migration

`supabase/schema.sql` は冪等。スキーマ変更があったら同じ SQL を再実行すれば反映されます。
