# Raid Repository — 引き継ぎノート (1.9 (2026-04-28), 2f59abf 時点)

## プロジェクト概要

**Raid Repository** — FFXIV レイド固定向け portal (Next.js 16 + Supabase, single-tenant)

- **Repo**: `https://github.com/yyamazaki-lym/raid-repository`
- **Path**: `D:\workd\portal`
- **Stack**: Next.js 16.2.4 (Turbopack) / React 19.2 / Supabase / Tailwind v4 / @base-ui/react / shadcn 系
- **Deploy**: Vercel auto-deploy from `main`
- **Current version**: `1.9 (2026-04-28)` — 新方式 (`MAJOR.MINOR (YYYY-MM-DD)`、patch 廃止) に移行。`package.json#version` は `1.9.38` を残置 (履歴マーカー)、UI は `RELEASES[0].version` + `.date` を表示
- **重要**: `D:\workd\portal\AGENTS.md` で「Next.js 16 は破壊的変更含む。`node_modules/next/dist/docs/` を参照すべし」

## 直近の主要な変更 (1.9.21 → 1.9.38)

| Ver | 概要 |
|---|---|
| 1.9.24 | FFLogs マッチを「同 JST 日 + content classifier」にシンプル化。±時間ウィンドウ撤廃 |
| 1.9.25 | HTML scrape 日付抽出バグ根治 (Created date 除外、closest-anchor 選択、優先度再構成) |
| 1.9.26 | 過去簡易チップの空 placeholder 削除、過去詳細の Logs アイコン位置修正 |
| 1.9.27 | 次回開催日カード縦中央揃え + 詳細日程行整列 |
| 1.9.28 | 凡例右端に更新ボタン (`router.refresh()` + `useTransition`) |
| 1.9.30 | ページ最大幅 `6xl` → `5xl` で横スリム化 |
| 1.9.36 | ルールボタン (運用ルール表示)、絵文字 decode (`&#xNNN;` `<img alt>`) |
| 1.9.37 | parseTopText が `■コメント` 直前で truncate |
| 1.9.38 | **チップ縦中央追求を断念** (Yu Gothic UI 環境で完全解決不能と判断、symmetric `py-1` に固定) |
| 1.9 (2026-04-28) | バージョン管理体系を `MAJOR.MINOR (YYYY-MM-DD)` 方式に変更 (patch 廃止)。コミット毎の patch 肥大を解消 |
| 1.9 (`59122b2`) | TODO #14 完了: スケジュール取り込み時、各ユーザーのコメント (`timestamp + body` の連結 fingerprint を `localStorage` に user.userId 別に保存) が変化していれば、ヘッダーの吹き出しアイコンを amber + 右上 dot でハイライト。popover 開操作で「確認済み」 → 解除。初回は silent baseline (ノイズ抑制) |
| 1.9 (`2f59abf`) | TODO #16 完了: 募集文テンプレ DnD をカテゴリブロック単位の sortable に再設計 (3 度目の正解)。`SortableContext.items` を group key 配列に、各 section が `useSortable`、子募集文の grip も親 section の listeners に prop drilling 接続 → 子を掴んでも親カテゴリごと追従、中の複数募集文も全部一緒に動く。`category_id` は変更せず、`sort_order` だけグループ単位で並べ替え。popover 内では intra-category 並び替えは行わない (per-category マクロページに譲る) |
| 1.9 (`2f59abf`) | 過去日程の動画アイコンを直接外部リンクへ (詳細表 + 簡易チップ両方)。`SessionVideoLink` に `url` 追加、`buildSessionVideoLinkMap` で SELECT に `category_links.url` を伝播。`schedule-list.tsx` (isPast=true) と `schedule-past-simple.tsx` で `<a href={safeHref(videoLink.url)} target="_blank">`。upcoming は引き続きポータル内動画ページへ |

## 確定 TODO 一覧 (再開時の参照用)

| # | 項目 | 規模 |
|---|---|---|
| 1 | 同日複数 Logs/動画 のプルダウン選択式 | 中 (schema 設計含む) |
| 2 | スケジュール表自前実装 (作成/編集/確定/Discord 通知) | 大 |
| ~~3~~ | ~~攻略リンクのサイト別アイコン (Web / 動画 / X)~~ — 完了 (1.9 (2026-04-28)、`<LinkSiteIcon variant="coarse">`) | ~~小~~ |
| ~~4~~ | ~~動画リンクのサイト別アイコン (YouTube / Twitch / ニコニコ / X)~~ — 完了 (1.9 (2026-04-28)、`<LinkSiteIcon variant="fine">`) | ~~小~~ |
| ~~5~~ | ~~マクロの説明文変更~~ — 完了 (1.9 (2026-04-28)、「攻略に用いる戦術のテンプレ等を…」) | ~~極小~~ |
| ~~6~~ | ~~募集文テンプレート並び替え (DnD) + top 反映~~ — 完了 (1.9 (2026-04-28)、マクロページにも DnD 追加、グローバル sort_order に反映 → トップページの「募集」ボタンと自動連動、Top 行に ★ Top バッジ) | ~~小~~ |
| 7 | スマホでのレイアウト崩れ確認 | 中 |
| 8 | Vercel/Supabase 自動導入 (Deploy button / `.env.example` / seed) | 中 |
| ~~9~~ | ~~バージョン番号体系の見直し~~ — 完了 (1.9 (2026-04-28) で新方式へ移行) | ~~小〜中~~ |
| ~~10~~ | ~~動画ページ上部のクリア日時ボタンを押下時、リスト内のその日時の動画位置までスクロール (anchor jump)~~ — 完了 (1.9 (2026-04-28)、Trophy バッジを `<button>` 化、`findVideoIdByDate` ヘルパー共通化) | ~~小〜中~~ |
| 11 | ページ全体のパフォーマンス最適化 (重さを軽減) — 候補: bundle 軽量化, RSC 化, lazy mount, 画像最適化, query batching, realtime subscription 削減 等 | 中 |
| ~~12~~ | ~~トップの運用ルール popup に編集ボタン追加~~ — 完了 (1.9 (2026-04-28)、Supabase `app_settings.schedule_top_text_override` で persistent override + オリジナル/編集後トグル + クリアボタン) | ~~小〜中~~ |
| ~~13~~ | ~~スケジュール取り込み時の文字コード decode~~ — 完了 (1.9 (2026-04-28)、`src/lib/html-entities.ts` に共通 `decodeHtmlEntities` を切り出し、`&times;` `&divide;` `&laquo;` `&deg;` 他多数の named entity をカバー) | ~~小〜中~~ |
| ~~14~~ | ~~カレンダー取り込みで各人のメモに更新があった場合、視覚的に色変化させる~~ — 完了 (1.9 `59122b2`、`comment-popover.tsx` で fingerprint 比較 + amber highlight + 確認時 localStorage 更新) | ~~小〜中~~ |
| ~~15~~ | ~~過去の活動履歴 簡易/詳細の見出し名~~ — 完了 (1.9 (2026-04-28)、`Past · 簡易ログ (日付チップ)` / `Past · 詳細ログ (出欠表)`) | ~~極小~~ |
| ~~16~~ | ~~DnD アイテムのカテゴリ跨ぎ移動~~ — 完了 (1.9 `2f59abf`、SortableContext をカテゴリブロック単位に再設計、子の grip も親 section の listeners に接続。子を掴んでも親カテゴリごと追従、中の複数募集文も全部追従) | ~~中~~ |
| ~~17~~ | ~~コンテンツカードに背景画像を設定可能にする~~ — 完了 (1.9 (2026-04-28)、`categories.background_image_url` 列追加 + 編集ダイアログに URL 入力 + Card に image layer + dark gradient overlay。`isSafeUrl` で http(s) のみ許可、`schema.sql` 再適用が必要) | ~~中~~ |
| ~~18~~ | ~~設定ダイアログに FF14 Lodestone へのリンクを追加~~ — 完了 (1.9 (2026-04-28)、フッター GitHub Source の隣に Link2 アイコン + "Lodestone" ラベルで配置) | ~~極小~~ |
| 19 | ロール単位で見られるページを分けたい — Discord ロール ID で出し分け。本 PR (#1) で `app_metadata.discord_roles` 保存 + `requireDiscordRoles([...])` ヘルパーまでは仕込み済み。残り: `categories` テーブルに `required_role_ids text[]` 列追加 + 編集ダイアログでロール選択 UI + ページレンダリング時のガード呼び出し + ロール一覧を Supabase からどう拾うか (静的に env or `/guilds/{id}/roles` を bot token で取得してキャッシュ) を決める | 中 |

### 除外済み (再対応不要)

- ~~top の「断絶」 Ultimate clear 表記~~ (異例ケース)
- ~~Vercel デプロイ確認~~ (1 回きり)
- ~~ヘビー級クリア取得~~ (取得済み)
- ~~チップ縦中央~~ (1.9.38 で終了、symmetric `py-1` に固定)

## アーキテクチャ重要ポイント

### FFLogs マッチング (1.9.24+ シンプル版)

- **マッチ条件**: 動画タイトル日付 == レポートの JST カレンダー日 + `contentMismatchPenalty !== 1`
- **sort**: greedy global pair sort、tie-breaker は `report.startMs` ascending
- **撤廃済**: ±時間ウィンドウ / `RAID_HOUR_JST` / `expectedRaidMs` / `SMALL_PENALTY` / `diffHours`
- HTML scrape は `extractTimestampMs` (`src/lib/server/fflogs.ts:474`) で priority + closest 選択
- `Created/Uploaded/Posted by` 直後の日付は upload metadata として除外

### コンテンツ分類 (`@/lib/content-groups.ts`)

- `CONTENT_GROUPS` (15 グループ、絶 / 零式各 tier / Arcadion / Criterion 等)
- `normalizeContentText` で全角→半角コロン正規化 (1.9.13 で seed のミスマッチ修正)
- 略称対応: `LH級` `クル級` `ヘビ級` `ウェル級`

### クリア検出 (`@/lib/clear-detection.ts`)

- `isClearTitleForCategory(title, categoryName)`:
  - 絶 / 4人用 → 単純なクリアキーワード
  - 零式 → 「4 層 / 四層 / P4S / P8S / P12S / M4S / M8S」 + クリア両方必要
- `isFirstFloorPracticeTitle` で「みなしクリア時間」の起点判定

### URL 安全 (`@/lib/url-safe.ts`)

- `isSafeUrl` / `safeHref` / `assertSafeUrl` で http(s) のみ通す
- 全レンダリング箇所と書き込み (`createCategoryLink` 等) で適用

### スケジュール (`@/lib/schedule/parse.ts`)

- `parseSchedule(html)` → `ParsedSchedule` (users / sessions / comments / `topText`)
- `topText` は `<p>/<pre>/<blockquote>/<h2-4>` を `<table>` 前 + `■コメント` 前から抽出
- 絵文字 decode 済み (`&#xNNN;` / `<img alt>`)

## 既知のペインポイント (再触らない方が良い)

- **チップ縦中央揃え**: 1.9.28-1.9.37 で 10 回試行、Yu Gothic UI font metrics の固有差異で完全解決不能。1.9.38 でシンプル版に固定済み。再度触る場合はユーザー明示要請がない限り避ける
- **FFLogs マッチング**: 1.9.4-1.9.25 で大量パッチ、現在 1.9.24 で安定。新たな問題が出た場合のみ慎重に対応

## 主要ファイル (navigation 用)

```
src/
├── app/(portal)/
│   ├── page.tsx                          # スケジュールページ (top)
│   ├── category/page.tsx                 # コンテンツ一覧
│   ├── category/category-list.tsx        # カードレイアウト (右カラム = StatusBadge / +N/wk / ⋮)
│   └── category/[slug]/
│       ├── videos/videos-list.tsx        # 動画リスト + 統計バッジ + 複数選択削除
│       ├── macros/macros-list.tsx        # マクロ + 募集文テンプレ
│       └── ...
├── components/portal/
│   ├── schedule-list.tsx                 # 出席表 (凡例 + 更新 + ルール)
│   ├── schedule-past-simple.tsx          # 過去簡易チップ
│   ├── schedule-edit-frame-dialog.tsx    # iframe 内インライン編集
│   ├── next-session-card.tsx             # 次回開催日カード
│   ├── settings-dialog.tsx               # 設定 + FFLogs 連動 + 更新履歴
│   ├── maintenance-menu.tsx              # メンテナンス (Discord/duration/clear 取得)
│   └── session-memo-popover.tsx          # メモ機能
└── lib/
    ├── server/
    │   ├── fflogs.ts                     # FFLogs マッチャ (シンプル版)
    │   ├── categories-actions.ts         # backfill / fetchTimeToClear
    │   └── ...
    ├── schedule/
    │   ├── parse.ts                      # parseSchedule + parseTopText
    │   └── next-session.ts               # fetchSchedule
    ├── clear-detection.ts                # tier-aware クリア検出
    ├── content-groups.ts                 # CONTENT_GROUPS + classifier
    ├── title-date.ts                     # extractDateFromTitle
    ├── duration-format.ts                # 時間 / クリア日 formatter
    ├── url-safe.ts                       # safeHref / isSafeUrl
    └── changelog.ts                      # 更新履歴 (UI に表示)
```

## 開発コマンド

```bash
# 型チェック
node ./node_modules/typescript/bin/tsc --noEmit

# 本番ビルド
node ./node_modules/next/dist/bin/next build
```

dev server は `.claude/launch.json` で `portal-dev` 設定済み (port 3000)。Claude Preview から起動可能。

## コミット運用

- Claude は **`git commit` まで** 実施し作業終了。`git push origin main` は Claude のツール呼び出しからは harness classifier に常に denied されるため、push はユーザー側で実行する
- 改行を含むメッセージは `git commit -F .git/COMMIT_EDITMSG_TEMP` 方式 (Windows + bash の heredoc 不安定回避用、コミット後に temp 削除)
- `.claude/settings.json` には Stop hook 経由で自動 push を試みる構成が残っているが、`.claude/auto-push.log` がまだ生成されておらず動作未確認。当面は **ユーザー手動 push** が運用前提
- hook 設定 (`settings.json`) の更新コミットは classifier に self-modification として弾かれることがあるため、必要に応じてユーザー側で commit + push

## 新規会話の開始テンプレ

新しい Claude Code セッションを開いたら、最初のメッセージで以下を投げる:

```
このリポは Raid Repository (Next.js 16 + Supabase, single-tenant FFXIV portal)。
直近作業は 1.9.38 でチップ縦中央追求を終了 (symmetric py-1 に固定)。

詳細は .claude/HANDOFF.md を読んでから作業してください。

今回やりたいのは TODO #X: [具体的な要望]
```

Claude が `Read .claude/HANDOFF.md` で本ファイルを読み込み、直前の context を回復した上で作業を開始します。
