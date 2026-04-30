# Raid Repository — 引き継ぎノート

> 2.1 (2026-04-30) 時点。完了済 TODO の詳細はすべて `src/lib/changelog.ts` を参照。

## プロジェクト概要

**Raid Repository** — FFXIV レイド固定向け portal (Next.js 16 + Supabase, single-tenant)

- **Repo**: https://github.com/yyamazaki-lym/raid-repository
- **Path**: `D:\workd\portal`
- **Stack**: Next.js 16.2.4 (Turbopack) / React 19.2 / Supabase / Tailwind v4 / @base-ui/react
- **Deploy**: Vercel auto-deploy from `main`
- **Version**: `2.1 (2026-04-30)`。`package.json#version` は `1.9.38` のまま (履歴マーカー)、UI は `RELEASES[0].version + .date` を表示
- **Next.js 16 注意**: 破壊的変更含む。`node_modules/next/dist/docs/` を参照すること (詳細は `AGENTS.md`)

## 🔄 保留オペレーション

現在なし。新たな schema 変更や設定変更が発生したらここに追記する。

## 📌 次回の作業優先度

現在なし。次回着手項目はユーザーが TODO リストから選定する。

## 🚨 新規会話開始時のルーチン

1. このファイル全体を読み込む (`Read .claude/HANDOFF.md`)
2. **「未完了 TODO 一覧」**を表示してユーザーに見せる
3. ユーザーから具体的な要望が来るのを待つ

ユーザー側のテンプレ:
```
このリポは Raid Repository (Next.js 16 + Supabase)。
.claude/HANDOFF.md を読んで TODO 一覧を表示してから作業してください。
```

## 未完了 TODO 一覧

| # | 項目 | 規模 |
|---|---|---|
| 1 | 同日複数 Logs/動画 のプルダウン選択式 | 中 (schema 設計含む) |
| 2 | スケジュール表自前実装 (作成/編集/確定/Discord 通知) | 大 |
| 7 | スマホでのレイアウト崩れ確認 | 中 |
| 8 | Vercel/Supabase 自動導入 (Deploy button / `.env.example` / seed)。導入後の公開モックサイト (デモ用ダミーデータ) も検証 | 中 |
| 11 | ページ全体のパフォーマンス最適化 (継続)。2.1 (2026-04-30) で phase 1-9 完了 (画像最適化 / Realtime delta / ChunkErrorHandler / `buildSessionVideoLinkMap` O(n+m) / `<Link>` 復活 + auth cache() / Next.js `deploymentId` skew protection / `useRealtimeAllScheduleMemos` 集約 / framer-motion 撤廃 / Toaster dynamic import)。残候補: `@supabase/ssr` の client 流入 (~31 KB gz) — 案 A で `@supabase/supabase-js` + 自作 cookie storage adapter に置換すれば剥がせるが auth 整合に直結するため別 commit で慎重に扱う必要 / `@base-ui/react` Dialog/Popover/Dropdown 系の dynamic import (20-30 KB gz 見込) / `tailwind-merge` (7.9 KB gz) を `clsx` 単独に縮約 | 中 |
| 20 | Vercel ドメイン変更 — Project Settings → Domains。Discord Developer / Supabase Auth の Redirect URLs にも反映必要 | 小 |
| 23 | サイト全体のデータ初期化ボタン (admin 限定、2 段階確認: 1 回目「本当に初期化?」、2 回目「`INITIALIZE` と入力」) | 中 |
| 38 | スケジュール追加機能 — portal 内から開催候補日を追加する UI が無い。日付 + 時間帯 + 参加可否を入力 → DB 保存 → 描画。TODO #2 と統合可 | 中〜大 |
| 47 | 動画お気に入り機能 + ソートで「お気に入りのみ」表示。`category_links` に boolean 列追加 → 動画カードに star トグル → videos-list の sort モードに「お気に入り」追加 | 中 (schema 変更含む) |
| 49 | 動画削除時にページトップへスクロールが戻る挙動を抑止。`router.refresh()` / revalidate 後の再描画でスクロール位置が失われている可能性。`videos-list` の削除ハンドラ周辺を調査 | 小〜中 |
| 50 | 過去日程リスト (詳細ログ表) のユーザー名ヘッダーから日付編集ページ (character-sheets iframe) への遷移を無効化。upcoming はそのまま、past 詳細表の `UserHeaderCell` のみ click を抑止 — `schedule-list.tsx` の `tableHead(false, false)` 経路で `UserHeaderCell` に `isPast` (or `clickable=false`) flag を渡して span 描画に切替 | 小 |

## 完了済み TODO

> 各項目の詳細・経緯は `src/lib/changelog.ts` の該当バージョン項目に記載。ここでは番号と版だけ。

- **2.1 (2026-04-30)**: #46 / #11 phase 1-9 / #48 phase 3
- **2.1 (2026-04-29)**: #21 #22 #24 #25 #26 #27 #28 #29 #30 #31 #32 #33 #34 #35 #36 #37 #39 #40 #41 #42 #43 #44 #45
- **2.0 (2026-04-28)**: #19 (ロール単位ページ閲覧制御 = OAuth + 役職判定)
- **1.9 (2026-04-28)**: #3 #4 #5 #6 #9 #10 #12 #13 #14 #15 #16 #17 #18

### 除外済み (再対応不要)

- top の「断絶」 Ultimate clear 表記 (異例ケース)
- Vercel デプロイ確認 (1 回きり)
- ヘビー級クリア取得 (取得済み)
- チップ縦中央揃え (1.9.38 で symmetric `py-1` に固定)
- 診断ツール (YouTube 取得テスト UI) — 2.1 で撤去 (`YOUTUBE_API_KEY` で限定公開動画も取れるため)

## アーキテクチャ重要ポイント

### スケジュール ↔ 動画紐付け

- マッチ条件: 動画日付 (タイトル → `posted_at` JST 日付 → スキップ) == セッションの JST カレンダー日
- `posted_at` 解決順: タイトル日付 → YouTube uploadDate → 既存値 (`resolvePostedAt` in `categories-actions.ts`)
- 撤廃済 (再導入禁止): ±36h ウィンドウ / `created_at` フォールバック / Discord 時刻優先 — 古い動画の誤紐付け原因

### FFLogs マッチング

- マッチ条件: 動画タイトル日付 == レポートの JST カレンダー日 + `contentMismatchPenalty !== 1`
- カスタムマッチワード: カテゴリ毎の `fflogs_match_keywords` で part 一致 cross-group reject を override
- 1 レポート → N 動画 OK (`usedReports` 撤廃)
- 取得経路: v2 GraphQL (Public のみ) + HTML scrape (Public + Unlisted + Private、session cookie 必要)
- 全ポータルページが Edge runtime — Vercel Edge IP は Cloudflare bot 判定をすり抜けやすい (Node Lambda IP は 403 になりがち)

### 認証 / 認可 — 4 層防御

| 層 | 手段 | コード |
|---|---|---|
| 1. リクエスト | Discord OAuth gate | `proxy.ts` (`app_metadata.discord_guild_member`) |
| 2. ページ | ロール gate | `[slug]/layout.tsx` の `requireDiscordRoles()` |
| 3. アプリ | Server Action 入口 admin gate | `assertAdminResult()` |
| 4. DB | RLS write 制限 | `auth.jwt()->'app_metadata'->>'is_admin' = 'true'` |

- **dev bypass**: `.env.local` の `DEV_AUTH_BYPASS=true` (NODE_ENV != production 時のみ偽 admin で短絡)。`DEV_AUTH_BYPASS_NON_ADMIN=true` で roles=[] 視点
- **Service role bypass**: `SUPABASE_SERVICE_ROLE_KEY` 設定で server-side createClient が service role 化 (RLS バイパス、dev 用)
- **Admin 判定**: `DISCORD_ADMIN_ROLE_IDS` 未設定なら全員 admin (backward compat)

### YouTube メタデータ

- 優先順: Data API v3 (`YOUTUBE_API_KEY`) → HTML scrape
- API key 設定で unlisted も取得可。private (uploader 限定) は不可
- 取得失敗でもタイトル日付があれば `posted_at` に書く

### Rate limit / エラー汎用化

- `/auth/callback` + `/api/cron/*` に 10 req / 30 sec の in-memory 固定ウィンドウ (`@/lib/rate-limit.ts`)。Vercel function instance 跨ぎ非共有 — 本格分散制限は Upstash Redis 等
- `dbError(label, error)` (`@/lib/server/db-error.ts`) で「{label}に失敗しました」を返し、生 PG エラーは `console.warn("[db-error] {label}:", detail)` で server log のみ

## 既知のペインポイント (再触らない方が良い)

| 領域 | 経緯 |
|---|---|
| チップ縦中央揃え | 1.9.28-37 で 10 回試行、Yu Gothic UI metrics の固有差で完全解決不能。1.9.38 で symmetric `py-1` に固定 |
| FFLogs マッチング | 1.9.4-25 で大量パッチ、現在 (2.1) 安定 |
| Status 右端揃え | flex-col 化は他の崩れを誘発、`padding` 調整で妥協済 (TODO #28)。再調整は revert 履歴 (`d7cdecd` 等) を確認 |

## 主要ファイル (navigation 用)

```
src/
├── app/
│   ├── (portal)/
│   │   ├── layout.tsx                  # 全ポータル Edge runtime 設定
│   │   ├── page.tsx                    # スケジュールページ (top)
│   │   ├── category/page.tsx           # コンテンツ一覧
│   │   ├── category/category-list.tsx  # カードレイアウト
│   │   └── category/[slug]/
│   │       ├── layout.tsx              # 詳細レイアウト + role gate
│   │       ├── videos/videos-list.tsx
│   │       └── ...
│   ├── auth/                           # OAuth callback / sign-out / denied
│   └── api/                            # cron / health / fflogs OAuth / page-title
├── components/portal/
│   ├── schedule-list.tsx
│   ├── schedule-past-simple.tsx
│   ├── schedule-edit-frame-dialog.tsx
│   ├── next-session-card.tsx
│   ├── settings-dialog.tsx
│   ├── maintenance-menu.tsx            # Discord 取込 + duration / posted_at backfill + クリア再計算
│   ├── category-form-dialog.tsx        # カテゴリ編集
│   └── session-memo-popover.tsx
├── lib/
│   ├── server/
│   │   ├── fflogs.ts                   # マッチャ + HTML scrape
│   │   ├── categories-actions.ts       # admin-gated Server Actions
│   │   ├── session-video-link.ts       # スケジュール↔動画紐付け
│   │   ├── auth.ts                     # requireDiscordRoles / assertAdminResult
│   │   ├── db-error.ts
│   │   ├── secret-store.ts             # 暗号化 secret CRUD
│   │   └── ...
│   ├── schedule/{parse.ts, next-session.ts}
│   ├── clear-detection.ts              # tier-aware クリア検出
│   ├── content-groups.ts               # CONTENT_GROUPS + classifier
│   ├── title-date.ts                   # extractDateFromTitle
│   ├── url-safe.ts                     # safeHref / isSafeUrl
│   ├── rate-limit.ts
│   └── changelog.ts                    # 更新履歴 (UI + 完了 TODO アーカイブ)
└── proxy.ts                            # Discord OAuth gate + rate limit
```

## 開発コマンド

```bash
# 型チェック
node ./node_modules/typescript/bin/tsc --noEmit

# 本番ビルド
node ./node_modules/next/dist/bin/next build
```

dev server は `.claude/launch.json` の `portal-dev` 設定 (port 3000)。Claude Preview から起動可。

**ローカル env**: `.env.local` を main repo (`D:\workd\portal\.env.local`) からコピー。`.env*` は gitignore 済。

## コミット & Push 運用

**確定フロー**: 実装 → `tsc --noEmit` → commit → 直後に `git push origin main` 自動実行 → 結果 (commit range) を事後報告。

**改行ありメッセージ**: PowerShell の `Out-File -Encoding utf8` は BOM 混入するので必ず:

```powershell
$path = 'D:/workd/portal/.git/COMMIT_EDITMSG_TEMP'  # worktree の場合は .git/worktrees/<name>/
[System.IO.File]::WriteAllText($path, $msg, (New-Object System.Text.UTF8Encoding $false))
git commit -F $path
Remove-Item $path
```

- BOM 混入時: `git commit --amend -F <path>` (push 前のみ)
- Bash heredoc は Windows で不安定 → 避ける
- 連続 commit 時は cwd が外れることがあるので PowerShell 冒頭に `Set-Location D:\workd\portal\.claude\worktrees\<name>`
- Claude Desktop は `.claude/settings.json` hooks が動かない (CLI 版のみ) — Claude が直接 push
- 既存 commit 取消は `git revert --no-edit <hash>` (`reset --hard` 不使用方針)

## バージョン更新

`src/lib/changelog.ts` の `RELEASES[0]` に新エントリ追加 (or 当日中に複数 part を追加)。`MAJOR.MINOR (YYYY-MM-DD)` 方式、patch は使わない。
