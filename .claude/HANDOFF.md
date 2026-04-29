# Raid Repository — 引き継ぎノート

> 2.1 (2026-04-29) 時点。アーカイブ詳細は `src/lib/changelog.ts` を参照。

## プロジェクト概要

**Raid Repository** — FFXIV レイド固定向け portal (Next.js 16 + Supabase, single-tenant)

- **Repo**: https://github.com/yyamazaki-lym/raid-repository
- **Path**: `D:\workd\portal`
- **Stack**: Next.js 16.2.4 (Turbopack) / React 19.2 / Supabase / Tailwind v4 / @base-ui/react / shadcn 系
- **Deploy**: Vercel auto-deploy from `main`
- **Version**: `2.1 (2026-04-30)` — Discord OAuth ゲート + admin 限定編集 + 動画↔スケジュール紐付け再設計 + セキュリティ強化 6 段。`package.json#version` は `1.9.38` のまま (履歴マーカー)、UI は `RELEASES[0].version + .date` を表示
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
| 11 | ページ全体のパフォーマンス最適化 — bundle 軽量化 / RSC 化 / lazy mount / 画像最適化 / query batching / realtime 削減 等 | 中 |
| 20 | Vercel ドメイン変更 — Project Settings → Domains。Discord Developer / Supabase Auth の Redirect URLs にも反映必要 | 小 |
| 23 | サイト全体のデータ初期化ボタン (admin 限定、2 段階確認: 1 回目「本当に初期化?」、2 回目「`INITIALIZE` と入力」) | 中 |
| 38 | スケジュール追加機能 — portal 内から開催候補日を追加する UI が無い。日付 + 時間帯 + 参加可否を入力 → DB 保存 → 描画。TODO #2 と統合可 | 中〜大 |
| 46 | 開催日が過去リストに載らない — 2026-04-29 が開催日だったが「過去の活動」に表示されていない。`mergeStoredPastSessions` の DECISION 判定 / Discord 取り込み済か / `schedule_past_sessions` テーブルに行が残っているかを切り分け要 | 小〜中 |
| 47 | 動画お気に入り機能 + ソートで「お気に入りのみ」表示。`category_links` に boolean 列追加 → 動画カードに star トグル → videos-list の sort モードに「お気に入り」追加 | 中 (schema 変更含む) |

## 完了済み TODO アーカイブ

> 詳細は `src/lib/changelog.ts` 参照。

### 2.1 (2026-04-29)

| # | 項目 |
|---|---|
| 21 | カテゴリ編集を admin ロール限定に — `DISCORD_ADMIN_ROLE_IDS` env + `assertAdminResult` |
| 22 | 動画 ↔ スケジュール紐付けをタイトル日付ベースに刷新 — `posted_at` 解決順は タイトル日付 → YouTube uploadDate → 既存値 |
| 24 | 過去日程は Discord/snapshot を authoritative source に + 個別削除 UI — 過去フィルタは `DECISION` 限定、未来日時 insert ガード追加 |
| 25 | カード編集に「クリアまでの累計時間」手動入力欄 — `manual_time_to_clear_seconds` ?? 自動計算 |
| 26 | カード編集に「説明文」フィールド追加 — `[slug]/layout.tsx` ヘッダー直下表示 |
| 27 | /category ページ説明文に「動画など」追加 |
| 28 | Status 右端を Trophy と揃える |
| 30 | 紅蓮テーマの hue/chroma 再調整 — × マーカー (rose-400) との色相被り解消 |
| 31 | 軽減表 / ロット管理ページの紐付け解除 UI + 軽減表テンプレ案内 |
| 32 | 🔒 セキュリティレスポンスヘッダー追加 — XFO / HSTS / Referrer-Policy / nosniff / Permissions-Policy |
| 33 | 🔒 CSP 段階導入 — Report-Only → enforce、production で `'unsafe-eval'` 削除 |
| 34 | 🔒 Storage bucket 強化 — file_size_limit 5MB + mime 制限 + anon UPDATE/DELETE 撤去 |
| 35 | 🔒 FFLogs token 暗号化保管 — 新 `secrets` テーブル + AES-256-GCM (Web Crypto) |
| 36 phase 1 | 🔒 RLS で書き込みを authenticated 限定 |
| 36 phase 2 | 🔒 RLS で書き込みを `is_admin` claim 限定 |
| 40 | 🔒 Rate limit 追加 — `/auth/callback` + `/api/cron/*` に in-memory 固定ウィンドウ (10 req / 30 sec) |
| 41 | 🔒 Server Action のエラーメッセージ汎用化 — `dbError(label, error)` ヘルパー |
| 42 | 背景画像リセット問題 — CSP `img-src` 緩和で正常化 |
| 45 | 🔍 FFLogs Logs 取り込みの 2 段階バグ修正 — (a) 全ポータル Edge runtime 化で Cloudflare 403 回避、(b) matcher 緩和 + 1 レポート → 同日複数動画 OK + カスタムマッチワード機能 |
| 39 | 🎯 開催時間中バッジを「挑戦中」(amber) に切替 — `inSession` 判定 + tone="inSession" で next-session カードと relative ラベルを差別化 |
| 43 | 🖼 SheetIframe にズームトグル — デフォルト 60%、50/60/75/90/100% を循環、localStorage 永続化 |
| 44 | 📅 スケジュール出欠セル → iframe スクロールジャンプ — `targetOffsetPx` 経由で `BASE + index * ROW_HEIGHT` ヒューリスティックを translateY clip に注入。3-way トグル (該当日 / 中央 / 上) |
| 29 | 🏷 GitHub About / topics 更新 — 2.1 機能反映 |
| 37 | 📎 攻略チャンネル取り込み時に sheet URL 自動紐付け — `軽減表` / `ロット` キーワード + `docs.google.com/spreadsheets` を per-line 検出、`mitigation_sheet_url` / `loot_sheet_url` が NULL のときのみ更新 (race-safe `IS NULL` guard) |

### 1.9 / 2.0 (2026-04-28)

| # | 項目 | 完了時 |
|---|---|---|
| 3, 4 | サイト別アイコン (web/動画/X、YouTube/Twitch/etc) | 1.9 |
| 5, 6 | マクロ説明文変更 + テンプレ DnD 並び替え | 1.9 |
| 9 | バージョン番号体系を `MAJOR.MINOR (YYYY-MM-DD)` に変更 | 1.9 |
| 10 | クリア日時ボタンで動画にスクロール (anchor jump) | 1.9 |
| 12 | 運用ルール popup に編集ボタン (override 永続化) | 1.9 |
| 13 | スケジュール取り込みの文字コード decode | 1.9 |
| 14 | カレンダーのメモ更新ハイライト | 1.9 |
| 15 | 過去履歴の見出し名 (`Past · 簡易ログ` / `Past · 詳細ログ`) | 1.9 |
| 16 | DnD のカテゴリ跨ぎ移動 | 1.9 |
| 17 | カードに背景画像設定 + storage bucket | 1.9 |
| 18 | 設定ダイアログに Lodestone リンク | 1.9 |
| 19 | ロール単位ページ閲覧制御 (Discord OAuth + 役職判定) | 2.0 |

### 除外済み (再対応不要)

- top の「断絶」 Ultimate clear 表記 (異例ケース)
- Vercel デプロイ確認 (1 回きり)
- ヘビー級クリア取得 (取得済み)
- チップ縦中央揃え (1.9.38 で symmetric `py-1` に固定)
- 診断ツール (YouTube 取得テスト UI) — 2.1 で撤去 (`YOUTUBE_API_KEY` 設定で限定公開動画も取れるため)

## アーキテクチャ重要ポイント

### スケジュール ↔ 動画紐付け (2.1+)

- **マッチ条件**: 動画日付 (タイトル → `posted_at` JST 日付 → スキップ) == セッションの JST カレンダー日
- **`posted_at` 解決順**: タイトル日付 → YouTube uploadDate → 既存値維持 (`resolvePostedAt` in `categories-actions.ts`)
- **撤廃済**: ±36h ウィンドウ / `created_at` フォールバック / Discord 時刻優先 (古い動画の誤紐付けの原因だった)

### FFLogs マッチング (2.1+)

- **マッチ条件**: 動画タイトル日付 == レポートの JST カレンダー日 + `contentMismatchPenalty !== 1`
- **緩和**: 「Video カテゴリ分類可 + Report 分類不能」は `0.5` (曖昧採用) に緩和 (TODO #45)
- **カスタムマッチワード**: カテゴリ毎に `fflogs_match_keywords` を設定可、part 一致で cross-group reject を override (TODO #45)
- **同日複数動画**: 1 レポート → N 動画への紐づけ可 (`usedReports` 撤廃、TODO #45)
- **取得経路**: v2 GraphQL (Public のみ、最大 25 ページ) + HTML scrape (Public + Unlisted + Private、session cookie 必要、scrape 成功時のみ cookie auto-delete)
- **runtime**: 全ポータルページが Edge runtime — Vercel Edge IP は Cloudflare bot 判定をすり抜けやすい (Node Lambda IP は 403 になりがち)
- **HTML scrape UA**: 実 Chrome 風 (`Sec-Fetch-*` / `Sec-Ch-Ua-*` / `Referer` 等付与)。それでも 403 が続く場合は手動 URL 貼り付けか Public 化で対応

### コンテンツ分類 (`@/lib/content-groups.ts`)

- `CONTENT_GROUPS` (15 グループ、絶 / 零式各 tier / Arcadion / Criterion 等)
- `normalizeContentText` で全角→半角コロン正規化
- 略称対応: `LH級` `クル級` `ヘビ級` `ウェル級`
- カスタム override: カテゴリ毎の `fflogs_match_keywords` (TODO #45)

### クリア検出 (`@/lib/clear-detection.ts`)

- `isClearTitleForCategory`:
  - 絶 / 4 人用 → 単純なクリアキーワード
  - 零式 → 「4 層 / 四層 / P4S / P8S / P12S / M4S / M8S」 + クリア両方必要
- `isFirstFloorPracticeTitle` で「みなしクリア時間」の起点判定

### URL 安全 (`@/lib/url-safe.ts`)

- `isSafeUrl` / `safeHref` / `assertSafeUrl` で http(s) のみ通す

### 認証 / 認可 (2.1+)

防御層 4 段:

| 層 | 手段 | コード |
|---|---|---|
| 1. 全リクエスト | Discord OAuth gate | `proxy.ts` (旧 middleware.ts、`app_metadata.discord_guild_member` チェック) |
| 2. ページ単位 | ロール gate | `[slug]/layout.tsx` の `requireDiscordRoles()` |
| 3. アプリ層 | Server Action 入口の admin gate | `assertAdminResult()` (categories CRUD / app_settings / FFLogs / 動画メタ系すべて) |
| 4. DB 層 | RLS write 制限 | `auth.jwt()->'app_metadata'->>'is_admin' = 'true'` (Storage bucket も同条件) |

- **dev bypass**: `.env.local` に `DEV_AUTH_BYPASS=true` + `NODE_ENV !== production` で proxy / auth を偽 admin で短絡。`DEV_AUTH_BYPASS_NON_ADMIN=true` を追加すると roles=[] の偽ユーザーで non-admin 視点も試せる。本番は NODE_ENV ガードで必ず無効
- **Service role bypass**: `SUPABASE_SERVICE_ROLE_KEY` 設定で server-side createClient が service role に切替 → RLS バイパス (dev 用)
- **Admin role 判定**: `DISCORD_ADMIN_ROLE_IDS` env 未設定なら全員 admin (backward compat)

### YouTube メタデータ取得 (2.1+)

- **優先順**: YouTube Data API v3 (`YOUTUBE_API_KEY` 設定時) → HTML scrape (consent cookie、Vercel IP の bot 検出で fail することあり)
- **限定公開対応**: API key で unlisted も取得可。private (uploader 限定) は不可
- **Title-date fallback**: YouTube 取得失敗時もタイトル日付があれば `posted_at` に書く

### Rate limit (`@/lib/rate-limit.ts`、TODO #40)

- `/auth/callback` 10 req / 30 sec、`/api/cron/*` 10 req / 30 sec
- 固定ウィンドウ Map ベース、IP は `x-forwarded-for` 先頭採用
- Vercel function instance 跨ぎでは状態非共有 (per-instance per-IP)。本気の分散制限は Upstash Redis 等が必要

### Server Action エラー汎用化 (`@/lib/server/db-error.ts`、TODO #41)

- `dbError(label, error)` で「{label}に失敗しました」を返し、生 PG エラーは `console.warn("[db-error] {label}:", detail)` で server log のみに残す
- 該当 server file は categories-actions / discord-import / discord-postedat-backfill / discord-schedule / fflogs-oauth / schedule-snapshot / secret-store

## 既知のペインポイント (再触らない方が良い)

| 領域 | 経緯 |
|---|---|
| チップ縦中央揃え | 1.9.28-1.9.37 で 10 回試行、Yu Gothic UI font metrics の固有差異で完全解決不能。1.9.38 で symmetric `py-1` に固定 |
| FFLogs マッチング | 1.9.4-1.9.25 で大量パッチ、現在 (2.1) 安定 |
| Status 右端揃え (Card layout) | flex-col 化で完全揃えは他の崩れを誘発、`padding` 調整で妥協済み (TODO #28)。再調整は revert 履歴 (`d7cdecd` 等) を確認 |

## 主要ファイル (navigation 用)

```
src/
├── app/
│   ├── (portal)/
│   │   ├── layout.tsx                  # 全ポータル Edge runtime 設定 (TODO #45)
│   │   ├── page.tsx                    # スケジュールページ (top)
│   │   ├── category/page.tsx           # コンテンツ一覧
│   │   ├── category/category-list.tsx  # カードレイアウト
│   │   └── category/[slug]/
│   │       ├── layout.tsx              # 詳細レイアウト + role gate
│   │       ├── videos/videos-list.tsx
│   │       ├── macros/macros-list.tsx
│   │       └── ...
│   ├── auth/                           # OAuth callback / sign-out / denied
│   └── api/                            # cron / health / fflogs OAuth / page-title
├── components/portal/
│   ├── schedule-list.tsx               # 出席表 (凡例 + 更新 + ルール)
│   ├── schedule-past-simple.tsx        # 過去簡易チップ
│   ├── schedule-edit-frame-dialog.tsx  # iframe 内インライン編集
│   ├── next-session-card.tsx           # 次回開催日カード
│   ├── settings-dialog.tsx             # 設定 + FFLogs 連動 + 更新履歴 + サインアウト
│   ├── maintenance-menu.tsx            # メンテナンス (Discord 取り込み + duration / posted_at backfill + クリア再計算)
│   ├── category-form-dialog.tsx        # カテゴリ編集 (description / manual time / role / FFLogs マッチワード)
│   └── session-memo-popover.tsx        # 日付メモ + Logs URL 手動入力
├── lib/
│   ├── server/
│   │   ├── fflogs.ts                   # FFLogs マッチャ + HTML scrape
│   │   ├── categories-actions.ts       # admin-gated Server Actions
│   │   ├── session-video-link.ts       # スケジュール↔動画紐付け
│   │   ├── auth.ts                     # requireDiscordRoles / assertAdminResult / userIsAdmin
│   │   ├── db-error.ts                 # 汎用エラー文言ヘルパー (TODO #41)
│   │   ├── secret-store.ts             # 暗号化 secret CRUD (TODO #35)
│   │   └── ...
│   ├── schedule/
│   │   ├── parse.ts                    # parseSchedule + parseTopText
│   │   └── next-session.ts             # fetchSchedule
│   ├── clear-detection.ts              # tier-aware クリア検出
│   ├── content-groups.ts               # CONTENT_GROUPS + classifier
│   ├── title-date.ts                   # extractDateFromTitle / titleDateToIso
│   ├── duration-format.ts              # 時間 / クリア日 formatter
│   ├── url-safe.ts                     # safeHref / isSafeUrl
│   ├── rate-limit.ts                   # in-memory 固定ウィンドウ (TODO #40)
│   └── changelog.ts                    # 更新履歴 (UI 表示)
└── proxy.ts                            # Discord OAuth gate (旧 middleware.ts) + rate limit
```

## 開発コマンド

```bash
# 型チェック
node ./node_modules/typescript/bin/tsc --noEmit

# 本番ビルド
node ./node_modules/next/dist/bin/next build
```

dev server は `.claude/launch.json` の `portal-dev` 設定 (port 3000)。Claude Preview から起動可能。

**ローカル env**: `.env.local` を main repo (`D:\workd\portal\.env.local`) からコピー。`.env*` は gitignore 済 (worktree でも commit に混ざらない)。

**Discord OAuth gate のバイパス**: `.env.local` に `DEV_AUTH_BYPASS=true` を立てると `NODE_ENV !== "production"` のときだけ偽 admin で短絡。`DEV_AUTH_BYPASS_NON_ADMIN=true` で roles=[] にして non-admin 視点を確認可能。詳細は `.env.local.example` 参照。

## コミット & Push 運用

**確定フロー**:

1. ユーザー要望を実装 → 型チェック (`tsc --noEmit`) → コミット
2. `git commit` 直後に `git push origin main` を **自動実行**
3. push 結果 (commit range) をユーザーに報告して **事後確認**

**コミットメッセージ作成 (改行ありの場合)**:

PowerShell の `Out-File -Encoding utf8` だと BOM が混入するので必ず以下の方式:

```powershell
$path = 'D:/workd/portal/.git/COMMIT_EDITMSG_TEMP'  # worktree の場合は実 gitdir パス
[System.IO.File]::WriteAllText($path, $msg, (New-Object System.Text.UTF8Encoding $false))
git commit -F $path
Remove-Item $path
```

worktree 配下では実 gitdir が `.git/worktrees/<name>/` にあるので、そこへ書く (例: `D:/workd/portal/.git/worktrees/foo/COMMIT_EDITMSG_TEMP`)。

- BOM 混入 commit を作ってしまったら `git commit --amend -F <path>` (push 前のみ)
- Bash の heredoc は Windows で不安定なので避ける

**環境注意**:

- Claude Desktop は `.claude/settings.json` の hooks が動かない (CLI 版のみ)。Stop hook の自動 push は期待せず、Claude が直接 push する
- 連続コミット時は cwd が `D:\workd\portal` から外れることがあるので、PowerShell では冒頭に `Set-Location D:\workd\portal\.claude\worktrees\<name>` を入れる

**revert / 履歴整理**:

- 既存 commit を取り消したい場合は `git revert --no-edit <hash>` で新 commit として打ち消す (`reset --hard` は使わない方針)
- HANDOFF.md の追記が revert で巻き戻ったら再追記 (push 済なら GitHub に履歴は残る)

## バージョン更新

`src/lib/changelog.ts` の `RELEASES[0]` に新エントリ追加 (or 当日中に複数 part を追加)。`MAJOR.MINOR (YYYY-MM-DD)` 方式、patch は使わない。
