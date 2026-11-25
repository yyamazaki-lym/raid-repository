# Raid Repository — 引き継ぎノート

> 2.19 (2026-11-25) 時点。完了済 TODO の見出しは `src/lib/changelog.ts` (最新) / `src/lib/changelog-archive.ts` (過去)、本文は `docs/release-notes/`、古い完了記録と過去版番号は `.claude/done.md`。
>
> **残タスクの正本は `docs/backlog.md`。** このファイルは番号体系の索引とコード外の判断待ちを持つ (下記「TODO 番号の体系」)。
>
> **新規会話の手順**: このファイルを読んだ後、TODO 一覧は自動表示せずユーザーの要望を待つ。新規 TODO 追記時は part 単位ではなく TODO 完了時のみ統合追記する (part 細分は commit log に任せる)。

## プロジェクト概要

**Raid Repository** — FFXIV レイド固定向け portal (Next.js 16 + Supabase, single-tenant)

- **Repo**: https://github.com/yyamazaki-lym/raid-repository
- **Path**: `D:\workd\raid-repository`
- **Stack**: Next.js 16.4 (Turbopack) / React 19.2 / Supabase / Tailwind v4 / @base-ui/react / Upstash Redis (レート制限・キャッシュ)
- **Deploy**: Vercel auto-deploy from `main`
- **Version**: `2.19 (2026-11-25)`。`package.json#version` は `1.9.38` のまま (履歴マーカー)、UI は `RELEASES[0].version + .date` を表示 (値は `src/lib/changelog-meta.ts`)
- **Next.js 16 注意**: 破壊的変更含む。`node_modules/next/dist/docs/` を参照すること (詳細は `AGENTS.md`)

## 🔄 保留オペレーション

- **CRON_SECRET の入れ替え** (2026-10-07 セキュリティ精査の残り、未実施)。Vercel の env と、pg_cron が使う Supabase の vault の secret (`cron_notify_native_schedule_bearer`、`supabase/schema.sql` の 13-0) を同じ値にそろえて替える (本番・デモそれぞれ)。作業者が手順書を持っている

(2026-10-02: 残っていた 2 項目をユーザー決定で閉じた — ① Discord 通知トグルは OFF のまま。固定の Discord 運用は別の方法で行っているので、OFF を正式な運用にもしない ② TODO #92 (日付メモの所有者) は 2026-09-09 に所有者限定で決着済み。あわせて所有者不明の行の削除開放 (S-10) と admin の代理作成 (S-11) も閉じ、1 人 1 日付 10 件の上限 (S-3) を入れた。旧い記述 (pg_cron 移管の観察記録・2026-05-08 の pre-check) は git 履歴を参照)

## 📌 次回の作業優先度

> 2026-09-09 更新。**残タスクの正本は `docs/backlog.md`** (調査ノート
> `docs/ff14-tools-research-2026-09-06-wide.md` が根拠)。このファイルは
> 「番号体系の索引」と「コード外の判断待ち」だけを持つ。

残っている実装は **W-9 + UI-13 (軽減の計画 × 実測) のみ**で、これは 8.0 の
軽減再編後に着手する方が保守的に有利 (調査ノート自身の判断)。TODO #11
(パフォーマンス) は休眠中。L-24 (シートのキャッシュの作り直し) は 2026-11-20〜22
に実装・本番確認まで済んだ (下の「完了済み TODO」)。

手が空いたときに拾う順:

1. **実機確認** (ユーザー操作が必要。下記「実機確認待ち」)
2. **保留** (`docs/backlog.md` の G-1 DB デプロイの承認制 / G-2 main のブランチ保護。
   2026-11-25 にユーザー判断で保留のまま。旧「判断待ち 2 件」(Discord 通知 / TODO #92)
   は 2026-10-02 に閉じた)
3. **8.0 の発表内容を確かめる** (W-33、期限 2026-12): 東京ファンフェス
   (2026-10-31〜11-01) で発表された新ジョブ・新難易度の名称と構成を確かめ、
   `docs/patch-8.0-readiness.md` (最終更新 2026-09-07) を更新する。④ 立ち上げ
   ウィザードを作るかの判断もここ
4. **L-24 の最後の確認**: 2026-12 上旬に本番の実行時エラーで `revalidating cache` が
   0 件のままか (`docs/backlog.md` の L-24 の条件 4)
5. W-9 + UI-13 (8.0 後)

## 🔢 TODO 番号の体系

番号が 3 系統あるので、**接頭辞で出どころを見分ける**。混ぜて振り直さない
(過去の `changelog.ts` / PR 本文が参照キーとして持っているため)。

| 体系 | 例 | 出どころ | 一覧の場所 |
|---|---|---|---|
| `#N` (数字のみ) | #11 / #92 | 2026-04〜07 の履歴上の通番。`changelog.ts` の参照キー | このファイルの「未完了 TODO 一覧」 |
| `W-N` / `UI-N` / `B-N` | W-9 / UI-13 / B-5 | 調査ノート (`docs/ff14-tools-research-2026-09-06-wide.md`) の項目番号。W=機能、UI=画面、B=第 1 回ノートの項目 | `docs/backlog.md` |
| `L-N` | L-7 / L-8 | 実機で出た要望・不具合。調査ノートに番号が無いので `docs/backlog.md` 側で採番 | `docs/backlog.md` |

⚠ **新しい実機要望は `L-N` を `docs/backlog.md` で採番する** (このファイルの
`#N` を伸ばさない)。`#N` は既に閉じた体系で、`changelog.ts` の過去エントリが
参照しているキーなので現状のまま凍結する。

## 未完了 TODO 一覧

ページ / 領域ごとに分類。番号は上表の体系に従う。

### 🗓 スケジュールページ (`/` = top)

| # | 項目 | 規模 |
|---|---|---|
| _(現在なし)_ | — | — |

### 📂 カテゴリ詳細ページ (`/category/[slug]`)

| # | 項目 | 規模 |
|---|---|---|
| W-9 + UI-13 | 軽減の「計画 × 実測」3 要素バー / レーン型タイムライン。x 軸に当たる W-10 (雛形の自動生成) は 2026-09-08 実装済み。⚠ **8.0 の軽減再編後に着手する** — シートの略称と FFLogs の正式名が一致せず、計画側の重ね合わせが壊れやすい (調査ノートの判断) | 大 |

### ⚙ 設定 / 管理系 (settings-dialog / maintenance-menu)

| # | 項目 | 規模 |
|---|---|---|
| _(現在なし)_ | — | — |

### 🌐 サイト全体 / 横断 UI

| # | 項目 | 規模 |
|---|---|---|
| 11 | ページ全体のパフォーマンス最適化。phase 1-10 完了済、**休眠中** (新ボトルネック発見時のみ再開)。見送り候補は再検討禁止。詳細: `.claude/todos/11.md` | — |

### 🧹 コードベース最適化 / リファクタ

| # | 項目 | 規模 |
|---|---|---|
| _(現在なし)_ | — | — |

### 🚀 インフラ / デプロイ (コード外作業)

| # | 項目 | 規模 |
|---|---|---|
| _(現在なし)_ | — | — |

## 🔍 実機確認待ち

実装は入っているが、**この環境から確かめられない**もの (実 API に到達できない
/ 実物のシートが要る)。詳細は `docs/backlog.md` の各節 (練習ログの手動の記録は
`docs/release-notes/v2.19-2026-11-08.md`)。

| 対象 | 何を見るか | 外れていたら疑う場所 |
|---|---|---|
| W-8 死亡の直前 | 実 pull を 1 つ開いて直前の被弾が並ぶか | `parseDeathLeadUp` の入力側 (レスポンスの形) |
| W-6 出席の自動突合 | 同期後のトーストで突合が 0 件でないか | `extractPlayerNames` の入力側 (参加者名が `composition` か `damageDone` か) |
| 練習ログの手動の記録 (#499) | admin で手動の記録の保存・削除ができるか (デモでは読み取りまで実測) | `practice-log-manual-actions.ts` |
| W-21 Discord の回答ボタン | 催促メッセージのボタンを実際に押して出欠に反映されるか | `/api/discord/interactions` の署名検証・`DISCORD_PUBLIC_KEY` |
| C-4 週のまとめ | 火曜の同期後に Discord へ実際に投稿されるか (dev ではプレビューのみ確認) | 練習ログの通知設定の 4 つ目 |

## 完了済み TODO

直近版のみ列挙。詳細経緯は `src/lib/changelog.ts`、過去版アーカイブは `.claude/done.md`。

- **2026-11-25: L-8 — 軽減表の見出し行をシートで隠していても、列の名前と担当ジョブを読む** — 実機確認待ちだった L-8 を本番の実物のシート (絶もうひとつの未来) で確かめたところ、チェック列 29 本の自動ラベル・列 → ジョブの対応が 0 本だった。通常の共有 URL は gviz で CSV を取っていて、gviz の CSV はシートで隠した行を落とす (このシートはジョブ名・アビリティ名・対象種別の行を隠していた)
  - **#516**: カードに出す行は gviz のまま。表示中の表で見出し行が見つからないときだけ、隠した行も含む全行の表 (`/export?format=csv`、`fetchSheetFullGrid`) を取り、列の並びが揃っているとき (`sameColumnLayout`) だけそこから見出しを読む
  - **✅ 2026-11-25 ユーザー実機検収 OK**: 本番で列の名前 (`パッセージ・オブ・アームズ (ナイト)` など) が出て、「自分の担当だけ」で絞り込めた。runtime logs のエラー 0

- **2026-11-20〜22: L-24 — キャッシュを Upstash の自前の SWR に置き換え、`unstable_cache` を全廃** — `unstable_cache` の取り直しが応答の後に waitUntil の外で走り、凍結で落ちて「revalidating cache with key … TimeoutError」を本番の別のルートに残していた (表示は壊れない、月 7 件ほど)。`docs/backlog.md` の L-24 の案 B で実装
  - **#508**: シート (軽減表・ロット) を `redis-swr.ts` (純ロジック) + `redis-swr-store.ts` (Upstash、`retry: false`) に載せ替え。保存先に書くのは `after()` の中だけ
  - **#509**: 残りの 4 か所 (`xivapi-action-names` / デモの `category-progress`・`practice-log-missing-days`・出席サマリーのゲスト) も移し、`redis-swr-next.ts` に共通化。締め切り `Infinity` で `setTimeout` が 1ms に丸められる不具合も直した。`check-sheet-swr.mjs` が「`src` に `unstable_cache` が無い」を見る
  - **#511 / #513**: 確認用の `written` ログを止めた
  - **✅ 本番・デモで確認**: シートは本番で空 (miss)・古い (refresh)・新しい (ログなし) の 3 経路、xivapi は本番の Logs 同期、スパークライン・欠けている日・出席サマリーはデモで miss / refresh。#509 の後、本番の `revalidating cache` は 0 件 (2026-11-25 時点)
  - **残り**: 2026-12 上旬に 0 件のままかを見る (L-24 の条件 4)

- **2026-08-28: TODO #94 — FF14 ツール調査 (Tier A) の実装 5 件 + XIVAnalysis 連携 + BiS リンク** — 外部ツール調査 (`docs/ff14-tools-research-2026-08.md`) の Tier A 提案をユーザー指示で一括実装。ブランチ `claude/ff14-tools-features-research-kr8l44`。
  - **schema**: 6b 章を新設 (`category_waymarks` / `category_bis_links` / `loot_weekly_checks` / `fflogs_fights` / `fflogs_report_syncs` / `fflogs_report_videos` + sort_order RPC 2 本)。**7 章 (RLS) より前に配置**する必要がある (ENABLE / policy ループが名指しするため)。realtime 購読は `category_waymarks` のみ追加 (7b FULL + 8 章 publication)、他 5 テーブルは DEFAULT のまま。`categories_default_tab_check` に `'logs'` を追加
  - **A-5 ウェイマーク**: `category_macros` と同型 (client/actions/fetch + マクロタブ内セクション)。markercode をラベル + メモ付きで保存 → ワンタップコピー、DnD 並べ替え
  - **A-3 シートのモバイルビュー**: `sheet-csv.ts` (URL → CSV 変換 + 自前 CSV パーサ + 列マッチ) / `server/sheet-table.ts` (isPublicHttpUrl + safeFetch + 2MB/15s 上限 + 5 分 revalidate) / `sheet-cards.tsx`。**mobile のみカード、PC は従来 iframe**、取得失敗時は iframe だけ描画する fallback。軽減表 / ロット両対応
  - **A-4 週次消化 + BiS**: `loot_weekly_checks` は火 17:00 JST 起点の `week_start` (`week-jst.ts`)。**本人書き込みは Server Action + service role で自分の discord_id の行のみ** (member-writable な RLS 面を増やさない = 監査 M-1 と同種のリスクを作らない)。client に Discord ID は一切渡さず `isMe` を server 側で畳む。BiS は admin CRUD の URL 預かりのみ
  - **A-1/A-2 練習ログタブ**: 新サブタブ `logs`。`server/fflogs-fights.ts` が v2 GraphQL `reportData.report.fights` を materialize (report ↔ カテゴリ/日付は **既存資産のみ** = video の `logs_url` / `expected_fflogs_zone_ids` / session logs。新規マッチングは足していない)。cron `/api/cron/fflogs-sync` の末尾に追加 + admin の手動同期ボタン。`lastPhase` が取れない場合に最小クエリで 1 度だけ再試行する degrade あり。UI は進捗サマリ + 日別バー + pull 一覧 (FFLogs fight / XIVAnalysis / 動画時刻)
  - **XIVAnalysis 連携**: `fflogs-url.ts` に code 抽出と URL 組み立てを集約。動画カードに Analysis バッジ、pull 行にも同バッジ
  - **方針**: 個人 DPS は集計も表示もしない (調査ノート §1-F)。Sheets を正とする過去判断は覆さない (読み取りビューの上乗せのみ)
  - **検証**: `npx tsc --noEmit` / `npm run lint` (新規エラー 0、既存 warning 1 のみ) / `npx next build` pass。純関数 22 ケースを tsx で実測 pass (週境界 / CSV / URL 変換)。**ローカル PG16 に schema.sql を適用 → 新 6 テーブル各 4 policy + publication 反映 + 冪等再適用 + CHECK 実発火 (`javascript:` URL 拒否) + sort_order RPC 連番を実測**
  - ⚠ **未検収**: 実データでの FFLogs fights 同期 (OAuth 接続済み本番でのみ確認可能) / Google Sheets 実 URL でのカードパース / 非 admin メンバーの消化チェック書き込み。本番デプロイ後にユーザー実機確認が必要


2026-07-12 以前の完了記録は `.claude/done.md` の先頭へ移した (2026-11-25)。

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
- **scrape の外向き fetch は `/api/fflogs/scrape-proxy` (Edge runtime) 経由必須** — Cloudflare bot 判定は Edge IP を通すが Node Lambda IP を**恒常 403** (2026-06-11 実測確定、「間欠的」ではない)。ポータルページ自体は 2.9 で全て Node runtime 化済み (cold start 対策) なので、scrape 系コードを Node 直 fetch に変えてはいけない。エラー reason の経路表記 (`edge 経由` / `direct`) で切り分け可能

### 認証 / 認可 — 4 層防御

| 層 | 手段 | コード |
|---|---|---|
| 1. リクエスト | Discord OAuth gate | `proxy.ts` (`app_metadata.discord_guild_member`) |
| 2. ページ | ロール gate | `[slug]/layout.tsx` の `requireDiscordRoles()` |
| 3. アプリ | Server Action 入口 admin gate | `assertAdminResult()` |
| 4. DB | RLS write 制限 | `auth.jwt()->'app_metadata'->>'is_admin' = 'true'` |

- **dev bypass**: `.env.local` の `DEV_AUTH_BYPASS=true` (NODE_ENV != production 時のみ偽 admin で短絡)。`DEV_AUTH_BYPASS_NON_ADMIN=true` で roles=[] 視点
- **Service role bypass**: `SUPABASE_SERVICE_ROLE_KEY` 設定で server-side createClient が service role 化 (RLS バイパス、dev 用)
- **Admin 判定**: `DISCORD_ADMIN_ROLE_IDS` 未設定なら **全員 false (fail-closed)**。2026-06-09 に fail-open (未設定 = 全員 admin) から変更済
- **Public demo mode**: `PUBLIC_DEMO_MODE=true` で proxy gate を skip (実セッション cookie は app 層へ素通し)。TODO #91 (2.7) から実セッション優先 — guild member は本物の roles を取得 (owner は編集可能)、セッションなし / 非メンバーは roles=[] ゲスト fallback (redirect なし、read-only)。ログイン導線は demo ゲスト時のみ設定ダイアログ footer に Sign in 表示

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

- `/auth/callback` + `/api/cron/*` に 10 req / 30 sec の固定ウィンドウ (`@/lib/rate-limit.ts`)。Upstash Redis (KV_REST_API_* か UPSTASH_REDIS_REST_*) があれば全インスタンスで共有、無ければ・失敗したらインスタンスごとのメモリに縮退。本番・デモとも Upstash 接続済み
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
│   │   ├── layout.tsx                  # 全ポータルの layout (Node runtime。2.9 で Edge から移行)
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
│   └── changelog.ts                    # 更新履歴の最新 1 件 (過去は changelog-archive.ts、本文は docs/release-notes/)
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

**ローカル env**: `.env.local` を main repo (`D:\workd\raid-repository\.env.local`) からコピー。`.env*` は gitignore 済。`.env.local` には dev で Discord OAuth gate を抜けるため `DEV_AUTH_BYPASS=true` を含めること (NODE_ENV !== "production" 時のみ偽 admin で短絡、Vercel 本番では fail-safe で無効化)。新 worktree でも main repo の `.env.local` をそのまま流用可。

**worktree での tsc / next build**: worktree は独自の `node_modules` を持たない (main repo のものを共有する設計)。worktree 内から実行する場合は main repo の node_modules を参照すること:

```bash
node D:/workd/raid-repository/node_modules/typescript/bin/tsc --noEmit
```

`npm install` は worktree では新規実行不要 (main repo の lockfile / node_modules がそのまま有効)。

## コミット & Push 運用

**確定フロー**: 実装 → `tsc --noEmit` → commit → 直後に `git push origin main` 自動実行 → 結果 (commit range) を事後報告。

**改行ありメッセージ**: PowerShell の `Out-File -Encoding utf8` は BOM 混入するので必ず:

```powershell
$path = 'D:/workd/raid-repository/.git/COMMIT_EDITMSG_TEMP'  # worktree の場合は .git/worktrees/<name>/
[System.IO.File]::WriteAllText($path, $msg, (New-Object System.Text.UTF8Encoding $false))
git commit -F $path
Remove-Item $path
```

- BOM 混入時: `git commit --amend -F <path>` (push 前のみ)
- Bash heredoc は Windows で不安定 → 避ける
- 連続 commit 時は cwd が外れることがあるので PowerShell 冒頭に `Set-Location D:\workd\raid-repository\.claude\worktrees\<name>`
- Claude Desktop は `.claude/settings.json` hooks が動かない (CLI 版のみ) — Claude が直接 push
- 既存 commit 取消は `git revert --no-edit <hash>` (`reset --hard` 不使用方針)

## バージョン更新

`src/lib/changelog.ts` の `RELEASES[0]` に新エントリ追加 (or 当日中に複数 part を追加)。`MAJOR.MINOR (YYYY-MM-DD)` 方式、patch は使わない。

## Claude Code 自動化セットアップ

`8850b78` (2026-05-02) でプロジェクト全体に導入。

### Project scope (`.claude/` 配下、git 管理)

- **skills/**
  - `check-next-docs` — Next.js 16 / React 19 の API を編集する前に `node_modules/next/dist/docs/` を必ず読む
  - `handoff-update` — `/handoff-update` で完了 TODO を本ファイルに統合追記
- **agents/**
  - `supabase-rls-reviewer` — RLS / GRANT / ポリシー整合の読み取り監査
  - `next16-migration-reviewer` — async params / fetch caching / use() 等の現行 API 適合監査
- **hooks/** (`.claude/settings.json` に登録)
  - `PreToolUse(Edit|Write|MultiEdit)` → `block-sensitive-files.sh` (`.env*` / lock 自動編集を遮断、`.env*.example` は許可)
  - `PostToolUse(Edit|Write|MultiEdit)` → `eslint-fix.sh` (`.ts|.tsx|.js|.jsx|.mjs|.cjs` のみ `eslint --fix`、失敗時もブロックしない)

### User scope (`~/.claude.json` 直下の `mcpServers`、コミット禁止)

| MCP | コマンド | 環境変数 |
|---|---|---|
| `supabase` | `npx -y @supabase/mcp-server-supabase --read-only --project-ref=jmzjwesxqnaqmysuzrjt` | `SUPABASE_ACCESS_TOKEN` |
| `context7` | `npx -y @upstash/context7-mcp` | `CONTEXT7_API_KEY` |

**API キーローテ履歴**: 2026-05-02 — 旧 context7 key (`ctx7sk-870c8d52-...`) と旧 Supabase access token を漏洩扱いで revoke、新キーで user scope に再登録。新キーは `~/.claude.json` のみに格納、git 管理外。

### 有効化されているプラグイン (`~/.claude/settings.json`)

- `claude-code-setup@claude-plugins-official`
- `frontend-design@claude-plugins-official`
