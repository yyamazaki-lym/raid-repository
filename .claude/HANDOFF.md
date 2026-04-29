# Raid Repository — 引き継ぎノート (2.1 (2026-04-29) 時点)

## プロジェクト概要

**Raid Repository** — FFXIV レイド固定向け portal (Next.js 16 + Supabase, single-tenant)

- **Repo**: `https://github.com/yyamazaki-lym/raid-repository`
- **Path**: `D:\workd\portal`
- **Stack**: Next.js 16.2.4 (Turbopack) / React 19.2 / Supabase / Tailwind v4 / @base-ui/react / shadcn 系
- **Deploy**: Vercel auto-deploy from `main`
- **Current version**: `2.1 (2026-04-29)` — Discord OAuth ゲート + admin ロール gating + 動画 ↔ スケジュール紐付け再設計 + カード layout 整理 を含む大型 release。`package.json#version` は `1.9.38` を残置 (履歴マーカー)、UI は `RELEASES[0].version` + `.date` を表示
- **重要**: `D:\workd\portal\AGENTS.md` で「Next.js 16 は破壊的変更含む。`node_modules/next/dist/docs/` を参照すべし」

## 🚨 新規会話開始時のルーチン

**新規会話の最初は必ず以下を実行**:

1. このファイル全体を読み込む (`Read .claude/HANDOFF.md`)
2. **「未完了 TODO 一覧」section を画面に表示**してユーザーに見せる (冒頭参考用)
3. ユーザーから具体的な要望が来るのを待つ

新規会話を開く側 (ユーザー) のテンプレ:

```
このリポは Raid Repository (Next.js 16 + Supabase)。
.claude/HANDOFF.md を読んで TODO 一覧を表示してから作業してください。
```

## 未完了 TODO 一覧 (優先表示)

| # | 項目 | 規模 |
|---|---|---|
| 1 | 同日複数 Logs/動画 のプルダウン選択式 | 中 (schema 設計含む) |
| 2 | スケジュール表自前実装 (作成/編集/確定/Discord 通知) | 大 |
| 7 | スマホでのレイアウト崩れ確認 | 中 |
| 8 | Vercel/Supabase 自動導入 (Deploy button / `.env.example` / seed) | 中 |
| 11 | ページ全体のパフォーマンス最適化 (重さを軽減) — 候補: bundle 軽量化, RSC 化, lazy mount, 画像最適化, query batching, realtime subscription 削減 等 | 中 |
| 20 | Vercel ドメイン変更 (`raid-repository.vercel.app` から好きな名前 / カスタムドメインへ) — Vercel Project Settings → Domains で実施。Discord Developer Portal の Redirects、Supabase Authentication の Site URL / Redirect URLs にも新ドメインを追加する必要あり | 小 |
| 23 | サイト全体のデータ初期化ボタン (設定ダイアログ内、ADMIN 権限のみ、2 度確認ダイアログ) — `categories` `category_links` `app_settings` 等のユーザーデータを TRUNCATE して初期状態に戻す。デプロイ初期や検証時の rebuild 用。Server Action で全テーブルを削除 → 2 段階確認 (1回目「本当に初期化?」、2回目「データ全消去確認、入力欄に `INITIALIZE` と打ってください」) | 中 |
| 29 | GitHub About / topics の定期メンテ — 大型機能追加時に repo の Description / Topics を最新化する。`gh repo edit yyamazaki-lym/raid-repository --description "..." --add-topic ...` で更新可。2.1 (2026-04-29) 時点で description/topics は `discord-oauth/ffxiv/nextjs/raid/supabase/tailwind/typescript/vercel` まで更新済み (継続項目として残置) | 極小 |
| 33 | **🔒 [security]** CSP enforce 切替 — Report-Only で投入済 (2.1, 2026-04-29)。本番 1 週間運用 → DevTools violation report 確認 → 不足 origin 追加 → ヘッダー名を `Content-Security-Policy` に切替 (= enforce)。enforce 切替時に `'unsafe-eval'` 削除も検討 (本番不要なケース多い)。directives は `next.config.ts` の `cspDirectives` 定数 | 小 (運用待ち) |
| 35 | **🔒 [security]** FFLogs session cookie / OAuth tokens を `app_settings` 平文保存から脱却 — 専用テーブル `secrets` に分離、Postgres `pgcrypto` で暗号化 (encryption key は env)。RLS で SELECT を service role のみに絞る。書き込み Server Action は admin gate 維持 | 中 |
| 36 | **🔒 [security]** Supabase RLS を `auth.uid()` ベースに締める — 現状全テーブル `USING (true)` で誰でも anon key で全件 CRUD 可能。Discord OAuth で `auth.users` に session があるユーザーのみ SELECT 許可、書き込みは admin role を要求する RLS function を作成。最大規模の変更で migration 計画が必要 | 大 |
| 37 | カテゴリ編集ダイアログで「攻略チャンネル ID から自動紐付け」 — Discord の攻略チャンネルに投稿された URL を import したとき、その中に `docs.google.com/spreadsheets/...` の URL が含まれていれば軽減表 (mitigation_sheet_url) / ロット管理 (loot_sheet_url) として自動セットする。判別ヒューリスティックは title / 周辺テキストの「軽減」「ロット」キーワード or sheet 名前。ユーザーが手で `category-form-dialog` の URL 欄に貼り付ける手間を削減。既存の `importDiscordNow` (動画+strategy 取り込み) のフローに hook を追加 | 中 |

## 完了済み TODO アーカイブ

| # | 項目 | 完了時 |
|---|---|---|
| ~~3~~ | 攻略リンクのサイト別アイコン (Web / 動画 / X) — `<LinkSiteIcon variant="coarse">` | 1.9 (2026-04-28) |
| ~~4~~ | 動画リンクのサイト別アイコン (YouTube / Twitch / ニコニコ / X) — `<LinkSiteIcon variant="fine">` | 1.9 (2026-04-28) |
| ~~5~~ | マクロの説明文変更 | 1.9 (2026-04-28) |
| ~~6~~ | 募集文テンプレート並び替え (DnD) + top 反映 — マクロページにも DnD、グローバル sort_order、Top 行 ★ Top バッジ | 1.9 (2026-04-28) |
| ~~9~~ | バージョン番号体系の見直し (`MAJOR.MINOR (YYYY-MM-DD)` に移行、patch 廃止) | 1.9 (2026-04-28) |
| ~~10~~ | 動画ページ上部のクリア日時ボタン押下で該当動画にスクロール (anchor jump) — Trophy `<button>` 化、`findVideoIdByDate` ヘルパー | 1.9 (2026-04-28) |
| ~~12~~ | トップの運用ルール popup に編集ボタン追加 — `app_settings.schedule_top_text_override` で persistent override | 1.9 (2026-04-28) |
| ~~13~~ | スケジュール取り込み時の文字コード decode — `src/lib/html-entities.ts` に集約 | 1.9 (2026-04-28) |
| ~~14~~ | カレンダー取り込みでメモ更新時の視覚ハイライト — `comment-popover.tsx` で fingerprint 比較 + amber + dot | 1.9 `59122b2` |
| ~~15~~ | 過去の活動履歴の見出し名 — `Past · 簡易ログ` / `Past · 詳細ログ` | 1.9 (2026-04-28) |
| ~~16~~ | DnD アイテムのカテゴリ跨ぎ移動 — SortableContext をカテゴリブロック単位に再設計 | 1.9 `2f59abf` |
| ~~17~~ | コンテンツカードに背景画像を設定可能に — `categories.background_image_url` + storage bucket | 1.9 (2026-04-28) |
| ~~18~~ | 設定ダイアログに FF14 Lodestone へのリンク追加 | 1.9 (2026-04-28) |
| ~~19~~ | ロール単位ページ閲覧制御 — `categories.required_role_ids` + Discord OAuth + role check | 2.0 (2026-04-28) |
| ~~21~~ | カテゴリ編集を「admin ロール持ちのみ」に制限 — `DISCORD_ADMIN_ROLE_IDS` env + `assertAdminResult` + Server Action 経由 | 2.1 (2026-04-29) |
| ~~22~~ | スケジュール ↔ 動画の紐付けがタイトル日付を見ていない — `session-video-link.ts` を「動画日付 == セッション JST 同日」方式に変更。日付解決は タイトル日付 → posted_at の JST 日付 → スキップ の優先度。`posted_at` の取得元も Title-date → YouTube uploadDate の優先度に反転 | 2.1 (2026-04-29) |
| ~~25~~ | カード編集にクリア時間 (timeToClearSeconds) 手動入力欄 — `categories.manual_time_to_clear_seconds` + `manualTimeToClearSeconds ?? computed` 優先 | 2.1 (2026-04-29) |
| ~~26~~ | カード編集にコンテンツ説明文 (description) フィールド — `categories.description` + `[slug]/layout.tsx` ヘッダー直下表示 | 2.1 (2026-04-29) |
| ~~27~~ | /category ページ上部の説明文に「動画など」追加 (当初『カード編集から動画追加』と誤解釈、UI 撤去済み) | 2.1 (2026-04-29) |
| ~~28~~ | Status の右端を Trophy と揃える — `SubPageShortcuts` の右パディングのみ調整 | 2.1 (2026-04-29) |
| ~~24~~ | 過去日程は Discord/snapshot を authoritative source として表示 + 個別削除 UI — 過去フィルタは `status === "DECISION"` 限定 + `mergeStoredPastSessions` で **char-sheets のみで stored に無い過去行は破棄**。char-sheets が実際は流した日でも DECISION マーカーを残すケースを排除。`discord-schedule.ts` は未来日時 insert ガード + 既存未来行 DELETE クリーンアップ。settings dialog → DB 保存件数ボタンで直近 20 件を表示、各行 × で個別削除可 (`deleteStoredPastSession` Server Action)。100 件ローテで元 Discord メッセージが落ちた古い stored 行や、誤って入った行を除去できる | 2.1 (2026-04-29) |
| ~~30~~ | 紅蓮 (Stormblood) テーマの彩度/明度を下げて薄く + 出欠 × (rose-400) と差別化 — `app/globals.css` の `.dark.theme-stormblood` を hue `22 → 38-40` (deep ember 寄り) に振り、accent も `45 → 60` (amber 寄り)、primary chroma `0.27 → 0.17` で再調整。前回 chroma 圧縮のみで hue 据え置きだったため × マーカーと色相被り → ember 系 hue で解消 | 2.1 (2026-04-29) |
| ~~31~~ | 軽減表 / ロット管理ページのスプレッドシート紐付け解除 UI + 軽減表テンプレ案内 — `SheetUrlUnlinkButton` を新規追加し `SheetIframe` の toolbar に admin 限定表示 (`updateCategory({ mitigation_sheet_url/loot_sheet_url: null })` で解除)。軽減表 onboarding には lastagous 氏のコピー元シート + note 使い方ガイドへのリンク追加 | 2.1 (2026-04-29) |
| ~~32~~ | **🔒 [security]** セキュリティレスポンスヘッダー追加 — `next.config.ts` の `headers()` で全パスに `X-Frame-Options: DENY` / `HSTS max-age=15552000` / `Referrer-Policy strict-origin-when-cross-origin` / `X-Content-Type-Options: nosniff` / `Permissions-Policy` (camera/microphone/geolocation 等を全 OFF) を付与 | 2.1 (2026-04-29) |
| ~~34~~ | **🔒 [security]** Storage bucket `category-backgrounds` 強化 — `file_size_limit = 5MB` + `allowed_mime_types = [png,jpeg,webp,gif]` を bucket レベル強制 (SVG は XSS ベクタなので除外)、anon UPDATE/DELETE policy 撤去、public read + anon insert のみ残置 | 2.1 (2026-04-29) |

### 除外済み (再対応不要)

- ~~top の「断絶」 Ultimate clear 表記~~ (異例ケース)
- ~~Vercel デプロイ確認~~ (1 回きり)
- ~~ヘビー級クリア取得~~ (取得済み)
- ~~チップ縦中央~~ (1.9.38 で終了、symmetric `py-1` に固定)
- ~~診断ツール (YouTube 取得テスト UI)~~ (2.1 (2026-04-29) で撤去、`YOUTUBE_API_KEY` 設定で限定公開動画も取得可能になったため)

## 直近の主要な変更 (2.0 / 2.1)

| Ver | 概要 |
|---|---|
| 2.0 (2026-04-28) | TODO #19: Discord OAuth ゲート全体導入 + ロール単位ページ閲覧制御。`/auth/callback` で `app_metadata.discord_guild_member` / `discord_roles` を JWT 同梱、`proxy.ts` (旧 middleware) で全 page を gate |
| 2.1 (2026-04-29) | TODO #21: admin ロール限定編集 (`DISCORD_ADMIN_ROLE_IDS` env)、TODO #22: 動画紐付けタイトル日付ベース化 + posted_at 取得元 YouTube 優先、TODO #25-28: カード編集ダイアログ拡張 (description / manual time / Status 揃え)、メンテメニュー単独ボタン化、`<details>` でロールセクション折りたたみ、TODO #24: 過去日程は DECISION のみ表示、TODO #30: 紅蓮テーマ彩度/明度を低減 |

## アーキテクチャ重要ポイント

### スケジュール↔動画紐付け (2.1+ シンプル版)

- **マッチ条件**: 動画日付 (タイトル → `posted_at` の JST 日付 → スキップ の優先度) == セッションの JST カレンダー日
- **`posted_at` 解決**: タイトル日付 (`titleDateToIso`) → YouTube uploadDate → 既存値維持 の優先度 (`resolvePostedAt` in `categories-actions.ts`)
- **撤廃済**: ±36h ウィンドウ / `created_at` フォールバック / Discord 時刻優先設計 (古い動画の誤紐付け原因だった)

### FFLogs マッチング (1.9.24+ シンプル版)

- **マッチ条件**: 動画タイトル日付 == レポートの JST カレンダー日 + `contentMismatchPenalty !== 1`
- **sort**: greedy global pair sort、tie-breaker は `report.startMs` ascending
- HTML scrape は `extractTimestampMs` (`src/lib/server/fflogs.ts:474`) で priority + closest 選択
- **HTML scrape の UA は実 Chrome 風** (2.1+): `Mozilla/5.0 (Windows NT 10.0; Win64; x64) ... Chrome/124.0.0.0 ...` + `Sec-Fetch-*` / `Sec-Ch-Ua-*` / `Referer` / `Accept-Encoding` 一式付与。旧 UA `Mozilla/5.0 (compatible; RaidRepository/...)` は Cloudflare 判定で 403 を引いていた。それでも 403 が続く場合は Vercel IP block で API 経由不能、手動 URL 貼り付けか Public 化で対応

### コンテンツ分類 (`@/lib/content-groups.ts`)

- `CONTENT_GROUPS` (15 グループ、絶 / 零式各 tier / Arcadion / Criterion 等)
- `normalizeContentText` で全角→半角コロン正規化
- 略称対応: `LH級` `クル級` `ヘビ級` `ウェル級`

### クリア検出 (`@/lib/clear-detection.ts`)

- `isClearTitleForCategory(title, categoryName)`:
  - 絶 / 4人用 → 単純なクリアキーワード
  - 零式 → 「4 層 / 四層 / P4S / P8S / P12S / M4S / M8S」 + クリア両方必要
- `isFirstFloorPracticeTitle` で「みなしクリア時間」の起点判定

### URL 安全 (`@/lib/url-safe.ts`)

- `isSafeUrl` / `safeHref` / `assertSafeUrl` で http(s) のみ通す

### 認証 / 認可 (2.0+)

- **全体ゲート**: `proxy.ts` (Next.js 16 で `middleware.ts` から改名) で `app_metadata.discord_guild_member === true` を要求
- **ロール gate**: `categories.required_role_ids` を `[slug]/layout.tsx` の `requireDiscordRoles()` で照合 (defense-in-depth)
- **Admin gate** (2.1+ 拡張): `DISCORD_ADMIN_ROLE_IDS` env のロールを持つユーザーのみ DB 書き込み系操作可。`assertAdminResult()` を以下に適用済み:
  - `category` CRUD (create/update/delete/reorder/status)
  - `category_links` CRUD (createCategoryLinkAction / updateCategoryLinkAction / deleteCategoryLinkAction / setCategoryLinkOrderAction)
  - `app_settings` 系 (setScheduleUrlAction / setDiscordScheduleChannelIdAction / setFflogsUsernameAction / setFflogsSessionCookie)
  - スケジュール系 (importPastScheduleFromDiscord / snapshotScheduleNow / deleteStoredPastSession)
  - FFLogs 系 (linkFflogsReports / clearAllFflogsLinks / disconnectFflogsOAuthAction / setSessionLogsUrl)
  - 動画メタ系 (importDiscordNow / backfillVideoDurations(Chunk) / backfillPostedAtFromDiscordChannels)
- **UI 連動**: `site-header.tsx` を server component 化し `getCurrentUserCanEdit()` を `<SettingsDialog canEdit>` に渡す。非 admin は settings dialog 内のフォーム / メンテメニュー / カテゴリメニューが全部非表示
- **Supabase RLS**: 依然 anon フル open。本気の防御は別 PR で `auth.uid()` ベースに締めること (TODO 残)。現状は server action 経由の admin gate がアプリ層の主防御

### YouTube メタデータ取得 (2.1+)

- **優先度**: YouTube Data API v3 (`YOUTUBE_API_KEY` 設定時) → HTML scrape (consent cookie 付き、Vercel IP の bot 検出で fail することあり)
- **限定公開対応**: API key で unlisted 動画も取得可。private (uploader しか見れない) は不可
- **Title-date fallback**: YouTube 取得失敗時もタイトル日付があれば `posted_at` に書く (`resolvePostedAt`)

## 既知のペインポイント (再触らない方が良い)

- **チップ縦中央揃え**: 1.9.28-1.9.37 で 10 回試行、Yu Gothic UI font metrics の固有差異で完全解決不能。1.9.38 でシンプル版に固定済み。再度触る場合はユーザー明示要請がない限り避ける
- **FFLogs マッチング**: 1.9.4-1.9.25 で大量パッチ、現在 1.9.24 で安定
- **Status 右端揃え (Card layout)**: flex-col 化で完全に揃えようとしたら他の崩れが出たため `padding` 調整で妥協 (TODO #28)。再度 layout 変更を試みる場合は revert 履歴 (`d7cdecd` 等) を確認

## 主要ファイル (navigation 用)

```
src/
├── app/(portal)/
│   ├── page.tsx                          # スケジュールページ (top)
│   ├── category/page.tsx                 # コンテンツ一覧
│   ├── category/category-list.tsx        # カードレイアウト (右カラム = Trophy / Hourglass / +N/wk / ⋮、icon 行末に Status)
│   └── category/[slug]/
│       ├── layout.tsx                    # category 詳細レイアウト + description 表示 + role gate
│       ├── videos/videos-list.tsx        # 動画リスト + 統計バッジ + 複数選択削除 + scroll-to-focus
│       ├── macros/macros-list.tsx        # マクロ + 募集文テンプレ
│       └── ...
├── components/portal/
│   ├── schedule-list.tsx                 # 出席表 (凡例 + 更新 + ルール)
│   ├── schedule-past-simple.tsx          # 過去簡易チップ
│   ├── schedule-edit-frame-dialog.tsx    # iframe 内インライン編集
│   ├── next-session-card.tsx             # 次回開催日カード
│   ├── settings-dialog.tsx               # 設定 + FFLogs 連動 + 更新履歴 + サインアウト
│   ├── maintenance-menu.tsx              # メンテナンス (単独ボタン、「最新情報を取り込んで再計算」)
│   ├── category-form-dialog.tsx          # カテゴリ編集 (description / manual time / role 折りたたみ)
│   └── session-memo-popover.tsx          # メモ機能
├── lib/
│   ├── server/
│   │   ├── fflogs.ts                     # FFLogs マッチャ
│   │   ├── categories-actions.ts         # admin-gated Server Actions / backfill / fetchTimeToClear / resolvePostedAt
│   │   ├── session-video-link.ts         # スケジュール↔動画紐付け (タイトル日付ベース)
│   │   ├── auth.ts                       # requireDiscordRoles / assertAdminResult / userIsAdmin
│   │   └── ...
│   ├── schedule/
│   │   ├── parse.ts                      # parseSchedule + parseTopText
│   │   └── next-session.ts               # fetchSchedule
│   ├── clear-detection.ts                # tier-aware クリア検出
│   ├── content-groups.ts                 # CONTENT_GROUPS + classifier
│   ├── title-date.ts                     # extractDateFromTitle / titleDateToIso
│   ├── duration-format.ts                # 時間 / クリア日 formatter
│   ├── url-safe.ts                       # safeHref / isSafeUrl
│   └── changelog.ts                      # 更新履歴 (UI に表示)
└── proxy.ts                              # Discord OAuth gate (旧 middleware.ts)
```

## 開発コマンド

```bash
# 型チェック
node ./node_modules/typescript/bin/tsc --noEmit

# 本番ビルド
node ./node_modules/next/dist/bin/next build
```

dev server は `.claude/launch.json` で `portal-dev` 設定済み (port 3000)。Claude Preview から起動可能。

**ローカル env セットアップ** (worktree 含む): `.env.local` を main repo (`D:\workd\portal\.env.local`) からコピー。`.env*` は gitignore 済なので worktree でも commit には混ざらない。

**Discord OAuth gate のバイパス** (2.1+): `.env.local` に `DEV_AUTH_BYPASS=true` を立てると `NODE_ENV !== "production"` のときだけ proxy / auth が偽 admin ユーザーで短絡する。これでローカル preview から全画面にアクセス可能。`DEV_AUTH_BYPASS_NON_ADMIN=true` を追加すると roles=[] の偽ユーザーになり non-admin 視点も試せる。Vercel 本番では NODE_ENV ガードで必ず無効化される (二重ガード)。詳細は `.env.local.example` 参照。

## コミット & Push 運用

**確定フロー**:

1. ユーザー要望を実装 → 型チェック (`tsc --noEmit`) → コミット
2. `git commit` 直後に `git push origin main` を **自動実行**
3. push 結果 (commit range) をユーザーに報告して **事後確認**
4. ブロックされた場合 (タイミング依存で稀) のみユーザー手動 push を依頼

**コミットメッセージ作成**:

- 改行を含むメッセージは PowerShell の `Out-File -Encoding utf8` だと **BOM が混入する** ので、必ず以下を使う:
  ```powershell
  [System.IO.File]::WriteAllText("$pwd\.git\COMMIT_EDITMSG_TEMP", $msg, (New-Object System.Text.UTF8Encoding $false))
  git commit -F .git/COMMIT_EDITMSG_TEMP
  Remove-Item .git/COMMIT_EDITMSG_TEMP
  ```
- もし BOM 混入の commit を作ってしまったら `git commit --amend -F .git/COMMIT_EDITMSG_TEMP` で修正 (push 前)
- Bash の heredoc は Windows 環境で不安定なので避ける

**環境注意**:

- **Claude Desktop 環境では `.claude/settings.json` の hooks は実行されない** (Desktop の仕様、CLI 版なら動く)。Stop hook の自動 push は期待しない、Claude が直接 push する
- 連続コミット時は cwd が `D:\workd\portal` から外れることがあるので、PowerShell の場合は冒頭に `Set-Location D:\workd\portal` を入れる

**revert / 履歴整理**:

- 既存 commit を revert したい場合は `git revert --no-edit <hash>` で新 commit として打ち消す (`reset --hard` は使わない方針)
- HANDOFF.md の追記が revert で巻き戻ったら再追記する (revert で消えても push 済みなら GitHub に履歴は残る)

## バージョン更新

`src/lib/changelog.ts` の `RELEASES[0]` に新しいエントリを追加 (or 当日中に複数 part を追加)。`MAJOR.MINOR (YYYY-MM-DD)` 方式、patch は使わない。
