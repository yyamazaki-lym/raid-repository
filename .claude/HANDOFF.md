# Raid Repository — 引き継ぎノート

> 2.1 (2026-04-30) 時点。完了済 TODO の詳細は `src/lib/changelog.ts` / 過去版番号は `.claude/done.md`。
>
> **新規会話の手順**: このファイルを読んだ後、TODO 一覧は自動表示せずユーザーの要望を待つ。新規 TODO 追記時は part 単位ではなく TODO 完了時のみ統合追記する (part 細分は commit log に任せる)。

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

**未定 (ユーザー選択)**。直前作業 TODO #23 (サイト全体のデータ初期化ボタン) はクローズ済。残未完了 TODO は下表参照。次回会話開始時にユーザーが選択。

## 未完了 TODO 一覧

ページ / 領域ごとに分類。番号は履歴上の通番なので連続しないが、`changelog.ts` の参照キーとしてそのまま維持する。

### 🗓 スケジュールページ (`/` = top)

| # | 項目 | 規模 |
|---|---|---|
| 2 | スケジュール表自前実装 (作成/編集/確定/Discord 通知) | 大 |
| 38 | スケジュール追加機能 — portal 内から開催候補日を追加する UI が無い。日付 + 時間帯 + 参加可否を入力 → DB 保存 → 描画。TODO #2 と統合可 | 中〜大 |
| 55 | スケジュールページの軽量化。初期表示の重さ / レンダリング負荷を削減 (具体施策は別途調査) | 中〜大 |

### 📂 カテゴリ詳細ページ (`/category/[slug]`)

| # | 項目 | 規模 |
|---|---|---|
| 1 | 同日複数 Logs/動画 のプルダウン選択式 | 中 (schema 設計含む) |

### ⚙ 設定 / 管理系 (settings-dialog / maintenance-menu)

| # | 項目 | 規模 |
|---|---|---|
| _(現在なし)_ | — | — |

### 🌐 サイト全体 / 横断 UI

| # | 項目 | 規模 |
|---|---|---|
| 7 | スマホでのレイアウト崩れ確認 | 中 |
| 51 | マイクロインタラクション / ユーザビリティ向上。クリック時の press feedback / hover 時の subtle elevation / loading skeleton / focus ring 強化 / toast の出現位置・タイミング微調整 / フォーム入力の即時 validation / 空状態の illustration etc。framer-motion を残す方針なので springy な質感も維持しつつ portal 全体の polish を 1 周。観点リストの作成 + 優先順位付けから | 中 |
| 11 | ページ全体のパフォーマンス最適化。phase 1-10 完了済、見送り候補あり。詳細: `.claude/todos/11.md` | — |

### 🚀 インフラ / デプロイ (コード外作業)

| # | 項目 | 規模 |
|---|---|---|
| _(現在なし)_ | — | — |

## 完了済み TODO

直近版のみ列挙。詳細経緯は `src/lib/changelog.ts`、過去版アーカイブは `.claude/done.md`。

- **2.1 (2026-05-01)**: #8 Vercel/Supabase 自動導入 + モックサイト — クローズ (part A〜E 完了)
  - **part A〜D (commit 51f8142 / abaec6d / 1f389be)**: `.env.local.example` に FFLogs v2 OAuth + `NEXT_PUBLIC_SCHEDULE_URL` 追記、schema.sql に Section 11 サンプルカテゴリ 5 件 seed、README に Vercel Deploy Button 追加
  - **part C-ii (本コミット)**: schema.sql Section 12 を新設、Section 11 のサンプル 5 カテゴリに紐付ける demo data bulk seed (category_links 37 / loot_items 18 + entries ~36 / mitigation_phases 20 + entries ~60 / strategy_docs 5 / category_macros 10 / recruitment_templates 5 / tags 11 / past_sessions 18 + memos 8 / app_settings 2)。`DO $$ BEGIN ... END $$` block + sentinel `app_settings.demo_seed_applied=1` で冪等
  - **part E (本コミット)**: `PUBLIC_DEMO_MODE=true` フラグ追加。proxy.ts に `isPublicDemoModeEnabled()` 追加 (NODE_ENV ガード無し → 本番でも有効、dev bypass の後段配置)、auth.ts に `publicDemoModeUser()` 追加 (roles=[] 固定で書き込みは admin gate + RLS で 4 層防御)。`.env.local.example` に PUBLIC_DEMO_MODE セクション追記
  - **モックサイト用デプロイ + README リンク追記**: ユーザー側で実 Vercel + Supabase インスタンスをデプロイ後、README にモックサイト URL を追記する想定 (本コミットでは保留)
- **2.1 (2026-05-01)**: #23 サイト全体のデータ初期化ボタン — 完了 (admin 限定 + 2 段階確認)
  - settings-dialog 末尾に **Danger Zone** セクション新設 (`canEdit` のみ表示、rose 系トーンで他セクションと隔離)。MainTabs / maintenance-menu (日常運用 action) とは性質が違う本番破壊級なので意図的に分離配置
  - 新規 [src/components/portal/data-init-confirm-dialog.tsx](src/components/portal/data-init-confirm-dialog.tsx): 2 段階 confirm dialog (step1=warn / step2=`INITIALIZE` テキスト一致で実行 active)。既存 destructive UI (`window.confirm` 1 段階) には前例の無いテキスト入力ガードを本機能専用に新規実装
  - 新規 [src/lib/server/admin-actions.ts](src/lib/server/admin-actions.ts) `initializeAllDataAction()`: `assertAdminResult()` gate + 13 テーブル子→親順 delete (tags / category_macros / recruitment_templates / strategy_docs / mitigation_entries / mitigation_phases / loot_entries / loot_items / category_links / categories / schedule_session_memos / schedule_past_sessions / app_settings)。各テーブルごとに `delete().not(<pk>, "is", null).select(<pk>)` で削除件数を取得、`revalidatePath("/", "layout")` で全ポータル invalidate
  - 残すデータ: `secrets` (FFLogs OAuth token / session cookie)、storage `category-backgrounds` bucket、`auth.users` / `app_metadata`
  - 実行後フロー: dialog `onComplete` で settings dialog 自体も close → `router.refresh()` で空状態に切替 → toast (sonner) で「データ初期化完了 — 合計 N 行削除」を表示
  - 検証: tsc PASS。動作確認は admin login + 実 Supabase 接続必須のため worktree dev preview の env 解決問題により本番側で実施予定
- **2.1 (2026-05-01)**: #57 スケジュール TOP の Suspense fallback に遅延 fade-in "Now Loading" 投入 — 完了 (commit 5ef8792)
  - 旧 `fallback={null}` (#55 part2) では長いロード時に「真っ白」体感、即時 skeleton では過去 (1.9, 2026-04-28) の swap 違和感再発、という両立困難な要件を **遅延 fade-in** で解消
  - [src/app/(portal)/page.tsx](src/app/(portal)/page.tsx) の fallback を `<ScheduleLoadingFallback />` に置換: Loader2 spinner + "Now Loading..." (role=status / aria-live=polite) を中央配置 (min-h-[40vh])、inline style で `opacity:0` + `animation: scheduleLoadingFadeIn 300ms ease-out 500ms forwards`
  - [globals.css](src/app/globals.css) に `@keyframes scheduleLoadingFadeIn { to { opacity: 1; } }` 追加
  - 仕組み: 500ms 未満ロード = fallback は `opacity:0` のまま視認されず #55 part2 の swap 違和感回避は維持、500ms 超過時のみ 300ms かけて穏やかに fade-in
  - 検証: tsc PASS / HTML stream に fallback markup 含有 / keyframe を CSSOM で確認 / DOM 注入スクショで視覚確認 / console + server エラーなし
- **2.1 (2026-05-01)**: #58 sub-nav / main-nav stuck 時の page アクションボタン portal 集約 — 完了 (part1 + part2 + fix 統合)
  - **part1 (commit 36e32f9)**: 新規 `action-slot.tsx` (Provider / Target / Slot, createPortal)、SubTabs に slot 配置 (mobile `max-w-[60vw] overflow-x-auto` + `[&>*]:!flex-nowrap`)、stuck 検出を IntersectionObserver から scroll listener + hysteresis (STICK_AT 102 / UNSTICK_AT 118) に置換し nav 高変化由来の振動ループを抑止。strategy / macros / videos 各 page を `<ActionSlot>` でラップ (移動方式)、macros は識別子兼用でテキストを「マクロ追加」「募集文追加」に変更
  - **part2 (commit cb294d4)**: /category 一覧用に MainActionSlot 一式 (`MainActionSlotProvider` / `MainActionSlotTarget` / `MainActionSlot`、SubTabs ActionSlot とは別 context、内部 sentinel + scroll listener + hysteresis STICK_AT 92 / UNSTICK_AT 108、unmount で stuck リセット) を追加。`(portal)/layout.tsx` で MainTabs + main をラップ、`main-tabs.tsx` を `<div.flex>` 構造で ul + MainActionSlotTarget を横並び化、`category/page.tsx` の MaintenanceMenu + CategoryFormDialog を MainActionSlot でラップ。あわせて macros 用に `MirrorActionSlot` (stuck 時のみ portal target に render、in-flow 時 null) を追加し、macros-list.tsx は元位置 in-flow ボタン + MirrorActionSlot で複製ボタンを並置 → stuck 時に元位置 2 + portal 2 の計 4 ボタン両表示 (登録量が少なく中途半端な scroll で元位置が見える状態が起こり得るため)。strategy / videos は part1 の移動方式を継続
  - **fix (commit 005836e)**: sub-tab 別タブ遷移時に scroll を top にリセット — Next.js 16 `<Link>` のデフォルト挙動「Page 要素が viewport 内に visible なら scroll 位置を保持」(sticky な MainTabs/SubTabs は判定対象外) のため、stuck 状態のまま別タブへ遷移すると新ページも縮小バーで開く問題があった。sub-tabs.tsx の各 Link `onClick` で `active === false` 時のみ `window.scrollTo({ top: 0, behavior: "instant" })` を発火、同タブ click では scroll 維持
- **2.1 (2026-05-01 part5)**: #56 カテゴリ詳細 sub-nav の sticky top 化 + scroll 連動 collapsed 形 — `src/components/portal/sub-tabs.tsx` 単独で実装。IntersectionObserver + 1px sentinel + `rootMargin: -110px` で nav が sticky 行に達した瞬間に `data-stuck` を切替、CSS で padding / icon / font / gap / underline glow を縮小 (`transition-all duration-200`)。z-index は SubTabs `z-15` (MainTabs `z-20` の下) で重なり回避、top は mobile 110 / sm 118 で MainTabs bottom と gap=1px。desktop / mobile 双方で `getBoundingClientRect` 計測検証済
- **2.1 (2026-05-01 part3+ / part4)**: #20 Vercel ドメイン変更 — コード側ドメイン非依存性を確認 (origin 動的取得 / 環境変数で吸収)、`.env.local.example` に新ドメイン例 + FFLogs OAuth エントリ追記、`.claude/todos/20.md` に dashboard 作業手順チェックリスト整備。実 dashboard 作業 (Vercel project rename / Supabase Auth URL Configuration / FFLogs OAuth Redirect URI) はユーザー側で実施。**part4 (2026-05-01)**: 旧 URL 整理削除完了 — Vercel 旧 alias を 308 Permanent Redirect 化 (curl 検証済)、Supabase Redirect URLs から旧エントリ 3 件削除、FFLogs 3 client すべてから旧 callback URL 削除。詳細: `.claude/todos/20.md`
- **2.1 (2026-05-01 part3+)**: #54 Vercel デプロイ後の遷移ロード再発 — part3 (cold start 根本対策) を Edge → Node runtime 個別判定 (FFLogs 非依存ページ 6 ファイル) で解決、本番体感確認済。詳細: `.claude/todos/54.md`
- **2.1 (2026-04-30 part11)**: #44 仕上げ (`#stickyhead` anchor で row_0 表示揃え)
- **2.1 (2026-04-30 part10)**: #44 微調整 (rowIndex=0 を sentinel 経由)

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

### character-sheets iframe (編集ダイアログ)

- 編集ダイアログは `schedule-edit-frame-dialog.tsx` で character-sheets を iframe 埋め込み (cross-origin, sandbox 付)
- **URL hash anchor は honor される** (2.1 part7-8 で実証、1.9.15 のコメント "URL hash hints aren't honored" は誤った観察)
  - `#row_N` (各日程行 TR の id) — N は character-sheets の HTML DOM 出現順 (実機確認: row_0 = 直近未来日 / 表の最上端、N が増えるほど未来日へ)。`parse.ts` の `ROW_RE` に capture group を入れて parser が `ScheduleSession.rowIndex` に保存。dialog 側が `#row_${rowIndex}` を URL に append すると character-sheets が window scroll + 内部 table-container scroll を両方連動して該当行までジャンプ
  - `#comment` (一言コメント入力欄) で window scrollY ~299 (docMax 付近) にジャンプ → 凡例 + table 行 + 下端 overlay 登録ボタンが同時表示 (= 通常 mode = `targetRowIndex` 無し時のデフォルト着地)
  - cross-origin SOP とは無関係 (ブラウザ native 機能)
- **iframe 経由で開いた時、character-sheets が responsive 判定で上部要素 (デイコードナビ / 大タイトル / 上部登録ボタンセット top=145) を非表示にする**。Chrome 直接アクセスでは見える。デフォルトの scroll=0 では「凡例から始まる短い表示」になるため、`#comment` / `#row_N` hash で初期スクロールを補正する方針に集約
- **dialog 側の構造**: prop は `targetRowIndex?: number | null` のみ (`targetOffsetPx` / mode toggle / `SCROLL_OFFSETS` / translateY clipping は part8 で全廃)。iframe は `absolute inset-0 h-full w-full` でフルサイズ表示、初期スクロール位置の制御は URL hash 一本
- **synthetic 行**: Discord 通知 / snapshot 由来の past セッション (`next-session.ts` の additions) は character-sheets の DOM に対応行が無いので `rowIndex: null`。null は dialog で `#comment` フォールバックされる
- **`/list` ページのみ -1 補正** (2.1 part9-11): 確定セルクリック (= `/schedule/list?key=...` 開く) では `#row_${rowIndex}` だと固定 header に anchor 行が被さり「日付+1 の行が画面最上端」に見えるズレが発生。確定セル handler のみ `rowIndex - 1` を渡して 1 行手前にシフトする。`rowIndex === 0` (= 最古未来日 = 一覧最上端) は `-1` 補正できないので sentinel `-1` を渡し、dialog 側で **`#stickyhead`** anchor (= `<thead id="stickyhead">` 固定 header 自体) に変換 → 凡例 / 運用ルール / コメントが画面外上にスクロールされ、固定 header 直下に row_0 がそのまま表示される。これで他の確定セル click と画面最上端の見た目が一貫する (`schedule-list.tsx` 確定セル handler / `schedule-edit-frame-dialog.tsx` の hash 派生で `targetRowIndex < 0` を `#stickyhead` に分岐)。メンバー列 (= `/schedule/input?...&userId=...`) は `/input` 側で固定 header の被りが起きないため補正不要、`session.rowIndex` をそのまま渡す。`/list` と `/input` で character-sheets の表示構造が違うことが原因
- **character-sheets の anchor 候補** (curl で `id=` 列挙、2.1 part11): `stickyhead` (thead 固定 header), `namerow` (thead 内最初の tr = ユーザー名行), `filterrow` (thead 内 2 番目の tr = フィルター行), `row_0`〜`row_N` (各日程行), `input_0`〜`input_N` (`/input` 側の入力 cell), `comment` (一言コメント), `title` / `serverName` / `filter` / `addUserModal` 等。新しい anchor 候補が必要になったら curl で再列挙: `curl -s "$NEXT_PUBLIC_SCHEDULE_URL" | grep -oE 'id="[^"]*"' | sort -u`
- **撤廃済 (再導入禁止)**:
  - heuristic translateY による per-date jump (`280 + (upcomingIndex - 1) * 36`, 2.1 part8 で削除) — 行高変動 / レイアウト改修で容易にズレ、`#row_N` hash 方式の方が正確かつ自動追従
  - `bottom` mode (offset=2400/3600) の translateY 下端ジャンプ — character-sheets が flex layout (header + table[overflow:auto, flex-grow] + footer) のため iframe height を伸ばすと中央 table が同期拡大 → 行が空白に隠れて使い物にならない (2.1 part4-5 で試行 → 撤回)

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
# 型チェック (main repo / worktree 共通)
node ./node_modules/typescript/bin/tsc --noEmit

# 本番ビルド
node ./node_modules/next/dist/bin/next build
```

dev server は `.claude/launch.json` の `portal-dev` 設定 (port 3000)。Claude Preview から起動可。

**ローカル env**: `.env.local` を main repo (`D:\workd\portal\.env.local`) からコピー。`.env*` は gitignore 済。`.env.local` には dev で Discord OAuth gate を抜けるため `DEV_AUTH_BYPASS=true` を含めること (NODE_ENV !== "production" 時のみ偽 admin で短絡、Vercel 本番では fail-safe で無効化)。新 worktree でも main repo の `.env.local` をそのまま流用可。

**worktree での tsc / next build**: worktree は独自の `node_modules` を持たない (main repo のものを共有する設計)。worktree 内から実行する場合は main repo の node_modules を参照すること:

```bash
node D:/workd/portal/node_modules/typescript/bin/tsc --noEmit
```

`npm install` は worktree では新規実行不要 (main repo の lockfile / node_modules がそのまま有効)。

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
