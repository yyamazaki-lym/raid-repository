# Raid Repository — 引き継ぎノート

> 2.1 (2026-05-08) 時点。完了済 TODO の詳細は `src/lib/changelog.ts` / 過去版番号は `.claude/done.md`。
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

**TODO #2 close 後の本番運用観察 + Vercel deploy 障害復旧** (2026-05-08):

1. ⏳ Discord 通知 ON/OFF トグル **現在 OFF**、手動 Bell button で初期検証中。問題なければ ON に戻す。**24h 観察 (項目 2-iv) 期間中も OFF 維持**: ユーザー判断 (2026-05-08) で「Discord 投稿到達確認は 24h 観察と切離し、ON 切替は別タイミング」。24h 観察の検収条件は `cron.job_run_details` に毎時発火 24 行が `status='succeeded'` で並ぶことのみ
2. ⏳ 候補 B 本対応 ([PR #71](https://github.com/yyamazaki-lym/raid-repository/pull/71) — 案 D: Supabase pg_cron): Vercel Hobby cron sub-daily 制約 (PR #69 で daily 暫定 revert 済) を回避するため、毎時 trigger を Supabase pg_cron + pg_net に移管。設計ドキュメント `.claude/plans/todo-2-b-dynamic-moore.md`。当初検討した案 C (GitHub Actions hourly cron) は通常 5–15 min 遅延・ピーク 1h+ で精度不足のため却下、pg_cron は DB 内 scheduler で秒単位精度。**Supabase Dashboard 手動操作が必要**:
   1. ✅ **完了**: SQL Editor で `SELECT vault.create_secret('<Vercel Env の CRON_SECRET と同値>', 'cron_notify_native_schedule_bearer');` を 1 回実行 (vault `secret_len=48` 確認済)
   2. ✅ **完了**: SQL Editor で `supabase/schema.sql` の追記された **13 章「Hourly cron for native schedule Discord notify」** (extensions + DO block + cron.schedule) を実行
   3. ✅ **完了 (2026-05-08)**: `SELECT * FROM cron.job WHERE jobname = 'notify-native-schedule-hourly';` で `jobid=1 / schedule='0 * * * *' / active=true` 確認、手動 trigger 200 OK 確認済
   4. ⏳ **24h 自動運転後の観察**: `SELECT jobid, status, return_message, start_time FROM cron.job_run_details WHERE jobid = 1 ORDER BY start_time DESC LIMIT 24;` で発火履歴確認。**24h 観察起点 = 最初の自動発火 2026-05-08 15:00 JST** (Pre-check 時点 2026-05-08 14:25 JST で run_details 空、次回毎時 0 分が初回)、**観察完了は 2026-05-09 15:00 JST 以降**。検収条件: `status='succeeded'` 23–25 行 / `status='failed'` 0 行 (ENABLED='false' のため route は `{ok:true,posted:0,skipped:0}` 返却 → cron 側は SQL succeeded で記録)

(項目 1/2 とも完了したらこの節を `_(現在なし)_` に戻す)

**Pre-check 結果サマリ (2026-05-08 14:25 JST 実行)**:
- `cron.job`: jobid=1, jobname='notify-native-schedule-hourly', schedule='0 * * * *', active=true
- `app_settings`: enabled='false' / channel_id='924575227306975232' / role_id='1497960832284360706' / hour 未 seed (route 側 default=12)
- `vault.decrypted_secrets`: cron_notify_native_schedule_bearer 登録済 (secret_len=48)
- `cron.job_run_details`: 0 行 (自動発火未到来)

**24h 観察フェーズ実行手順 (新規セッションで実施)**:
- `.claude/plans/todo-2-b-shiny-pancake.md` の Step 2 SQL を実行
- 結果 OK なら本節 項目 2-iv を ✅ 完了マーク + 集計件数 N を追記
- 項目 1 (ON 切替 + Discord 到達確認) は別タスクとして残置
- docs only commit + PR + squash merge

## 📌 次回の作業優先度

未完了 TODO はユーザー選択。残りはほぼ全て中〜大規模 (#7 / #51 / #11) の見送り候補。

## 未完了 TODO 一覧

ページ / 領域ごとに分類。番号は履歴上の通番なので連続しないが、`changelog.ts` の参照キーとしてそのまま維持する。

### 🗓 スケジュールページ (`/` = top)

| # | 項目 | 規模 |
|---|---|---|
| 73 | **FFLogs 連携 native 拡張** — `src/lib/server/fflogs.ts` の `linkReportsToSessions()` は現状 `schedule_past_sessions` 直読みなので native mode の sessions では FFLogs auto-link が動かない。native sessions 対応への拡張、`schedule_past_session_logs` の sync/native 統合 vs 別テーブル新設の設計議論、`schedule_past_sessions` 直読みからの脱却を含む。TODO #2 から分離 (2026-05-08)。詳細は `.claude/plans/todo-2-claude-handoff-md-spicy-seahorse.md` の「FFLogs 部分の扱い (本 TODO から除外)」節 | 中 |
| 77 | **自前作成式 (native) UI を同期式と揃える + 5月重複 row 解消** — native モードのトップ表示に sync 同等の「過去簡易日程 / スケジュールリスト / 過去開催日時」リスト UI (リストから確定操作 / プルダウンで状況入力可) を整備し、`schedule-list.tsx` の `mode` 分岐で出し分ける。併せて `native_schedule_sessions` に入っている **2025 年 5 月 row 2 件のうち重複ノイズ側** (もう片方は開催日程 2 件入りで正) を本番 Supabase SQL Editor から `DELETE` する (実 row id はユーザー判断)。詳細は `.claude/plans/todo-sequential-waterfall.md` | 中〜大 |

### 📂 カテゴリ詳細ページ (`/category/[slug]`)

| # | 項目 | 規模 |
|---|---|---|
| _(現在なし)_ | — | — |

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

### 🧹 コードベース最適化 / リファクタ

| # | 項目 | 規模 |
|---|---|---|
| _(現在なし)_ | — | — |

### 🚀 インフラ / デプロイ (コード外作業)

| # | 項目 | 規模 |
|---|---|---|
| _(現在なし)_ | — | — |

## 完了済み TODO

直近版のみ列挙。詳細経緯は `src/lib/changelog.ts`、過去版アーカイブは `.claude/done.md`。

- **2.1 (2026-05-12)**: #79 schedule_source_mode='disabled' 時のデフォルトページをコンテンツページに切替 — クローズ ([PR #91](https://github.com/yyamazaki-lym/raid-repository/pull/91) squash merge `99cada9`)
  - **発端**: TODO #2 phase 1 (2026-05-07) で disabled モードを導入したが、当初設計では `/` (schedule top) に `ScheduleDisabledNotice` を表示するだけで、スケジュール表を使わない portal でも「Schedule 機能停止中」notice がトップに居座る不自然な状態が残っていた。スケジュールを使わない運用ではコンテンツページを実質のホームにしたい、というユーザー要望
  - **採用方式 (ユーザー確認済み 3 仕様)**: (1) redirect 先 = `/category` (カテゴリ一覧)、(2) `MainTabs` のスケジュール tab は disabled 時に**全ユーザー**で非表示、(3) `/` 直アクセスは **admin だけ** `ScheduleDisabledNotice` を表示し、**非 admin は server redirect**。admin の復帰導線は SiteHeader の SettingsDialog (全 portal ページで常時 mount 済み) を維持
  - **修正** [src/components/portal/main-tabs.tsx](src/components/portal/main-tabs.tsx): `scheduleSourceMode: ScheduleSourceMode` prop を追加、Schedule tab の `<li>` 全体を `!== "disabled"` のときのみ render
  - **修正** [src/app/(portal)/layout.tsx](src/app/(portal)/layout.tsx): `Promise.all` に `getScheduleSourceMode()` を追加、MainTabs に prop で渡す。`React.cache` 済みなので page.tsx と layout で重複 call しても DB クエリは 1 回に dedup
  - **修正** [src/app/(portal)/page.tsx](src/app/(portal)/page.tsx): disabled 分岐に `getAuthorizedUserRoles()` + `userIsAdmin` 判定を追加。非 admin は `redirect("/category")`、admin は従来通り notice 表示。`next/navigation` の `redirect` は Edge Runtime 対応済
  - **採らなかった案**: (a) layout で `(portal)/*` 一括 redirect (loop 可能性 + `/category/*` 配下にもアクセス可能であるべき)、(b) middleware redirect (DB 取得コスト過剰)、(c) client `useEffect` redirect (FOUC + 二重 nav)、(d) MainTabs `href` 差し替えで Schedule tab を残す案 (仕様で全ユーザー非表示が確定)
  - **検証**: `npx tsc --noEmit` PASS。worktree dev preview (`npm install` + `npx vercel@latest env pull` で demo `.env.local` 取得 + `DEV_AUTH_BYPASS` 系切替) で (1) admin / disabled — `/` で notice + tab 非表示、(2) 非 admin / disabled — `/` → `/category` redirect + tab 非表示、(3) sync 回帰 — `/` でスケジュール表 + tab visible (`「スケジュール」link` + `「コンテンツ」button` 両方) を実機確認。本 PR 改修起因の console error / warning 0 件。`/category` で `@dnd-kit/sortable` の `aria-describedby` hydration mismatch が出るが、本 PR と無関係 (worktree 親 main branch でも再現する category-list 既存問題)
  - **本番 DB 非汚染検証パターン**: `app_settings.schedule_source_mode` を実 DB で UPDATE すると他ユーザーから schedule top が一時的に壊れて見える / 戻し忘れリスクがあるため、[src/lib/schedule/source-mode.ts](src/lib/schedule/source-mode.ts) の `getScheduleSourceMode()` を `return "disabled"` / `return "sync"` で順次ハードコード書き換え → preview 検証 → `git checkout -- src/lib/schedule/source-mode.ts` で復元、の経路を採用 (本番 / demo DB は一切触らず)。memory に保存済
  - **設計ドキュメント**: `~/.claude/plans/structured-prancing-frog.md`
- **2.1 (2026-05-08 part15)**: #78 schema.sql / seed-demo.sql の SQL 投入を GitHub Actions で自動化 (psql 直叩き、各 fork は repo secret 1 個登録するだけで以後 push のみで反映) — クローズ ([PR #86](https://github.com/yyamazaki-lym/raid-repository/pull/86) squash merge `040e781`)
  - **発端**: TODO #76 follow-up で `supabase/schema.sql` (DDL/RLS/必須 cron のみ 894 行) と `supabase/seed-demo.sql` (demo 専用 509 行) の責務分離は完成したが、運用面では各 fork ユーザー (本番固定 / demo / 検証 fork) が schema 変更のたびに **Supabase Dashboard SQL Editor で手動コピペ + Run** を強いられていた。upstream で schema 拡張があるたびに数十秒〜数分の手作業が発生し、忘却 + ヒューマンエラーの温床
  - **採用方式 (案 A: GitHub Actions + Supabase CLI)**: TODO #76 follow-up セッションでの 3 案比較 (案 A: GitHub Actions、案 B: Vercel Build psql、案 C: Claude MCP) で fork 適合性が高い案 A を選定済。本実装ではさらに「投入方式」「workflow 構成」「secret 命名」の 3 論点をユーザー確認で確定 — **psql 直叩き** + **2 ファイル分離** + **`SUPABASE_DB_URL` / `SUPABASE_DB_URL_DEMO` (`_PROD` 接尾辞抜き)**
  - **新規** [.github/workflows/deploy-database.yml](.github/workflows/deploy-database.yml) (~40 行): 全 fork で動く本番用。`SUPABASE_DB_URL` secret 未登録 fork は冒頭 guard step で `Skipping: SUPABASE_DB_URL secret not set on this fork.` を出して即 success 終了 (赤い印は付かない)。`paths: ['supabase/schema.sql', '.github/workflows/deploy-database.yml']` で SQL 変更時のみ trigger + `workflow_dispatch` で手動実行可能。psql 引数は `-v ON_ERROR_STOP=1 --single-transaction` で失敗時の部分適用を防止
  - **新規** [.github/workflows/deploy-database-demo.yml](.github/workflows/deploy-database-demo.yml) (~50 行): demo 用、`SUPABASE_DB_URL_DEMO` secret を持つ repo (= `yyamazaki-lym/raid-repository` upstream) でのみ走る。schema.sql + seed-demo.sql の 2 段適用を独立 step で実行 (一方の成否を区別可能)。誤って本番 fork が demo データを引き込まないよう、本番 fork repo では `SUPABASE_DB_URL_DEMO` を絶対に登録しない運用を README で明記
  - **編集** [README.md](README.md): **Step 6 「(任意) GitHub Actions で schema 自動反映」** を新節として追加 (~40 行、Step 5 Discord 自動取り込みの直後)。Session pooler 接続文字列の取り方 (Direct connection は IPv6 のみで Actions runner から繋がらないので NG) + secret 登録手順 + 動作確認手順 + 未登録 fork の挙動説明を全部書く。Step 2-2 のスキーマ実行 callout に Step 6 への内部リンクを追加、「スキーマ更新時の対応」節にも「Step 6 設定済なら push のみで反映」の補足
  - **採らなかった案**: 案 P1 `supabase db push` で migration 化 — HANDOFF.md の文言「supabase db push」と完全整合するが、(a) 既存 fork (LymRestoria 本番、demo 等) は手動 SQL Editor で schema 投入済 → 初回 `supabase migration repair --status applied <ts>` の追加手順が必要 + CLI 学習コスト、(b) 現 schema 構造 (1 ファイル冪等 + ALTER TABLE IF NOT EXISTS パターン) を migration 化すると schema_migrations テーブル管理と二重管理になり今後の schema 変更フローも変わる、で却下。案 D1 単一 workflow + repo variable 分岐 — fork ユーザーに `IS_DEMO` 設定を意識させる手間が増えるため不採用、secret 有無で自動判定する 2 ファイル分離の方がクリア。案 P3 declarative schema (`supabase/schemas/`) — 新機能で fork 学習コスト最大、本 TODO スコープを大きく超えるため将来 TODO として温存
  - **secret 名の HANDOFF 文言修正**: 元 TODO #78 エントリは `SUPABASE_DB_URL_PROD` / `supabase db push` と書いていたが、実装で `SUPABASE_DB_URL` (本番) / `SUPABASE_DB_URL_DEMO` (demo) の対称命名 + psql 直叩きに確定。default = production の方が fork 視点で自然と判断
  - **ユーザー側 1 回限りの登録作業 (各 fork repo で必要なときに任意)**: (1) Supabase ダッシュボード (該当 project) → Project Settings → Database → Database password → Reset で 32 文字ランダム生成 → コピー、(2) Settings → Database → Connection string カードの **Session pooler** タブから URI 取得、(3) `[YOUR-PASSWORD]` を新パスワードで置換、(4) GitHub repo Settings → Secrets and variables → Actions に `SUPABASE_DB_URL` (本番 fork) または `SUPABASE_DB_URL_DEMO` (upstream demo) で登録
  - **触らない範囲**: `supabase/schema.sql` / `supabase/seed-demo.sql` の内容無改修 (現状の冪等性が workflow の前提)。`vault.create_secret` / `cron.schedule` の手動 1 回登録 (保留オペレーション項目 2、pg_cron 系) は CI 自動化非推奨で残置 (secret を CI に置くより Supabase Dashboard で 1 回登録する方が監査痕跡が残る)。既存 Vercel cron 2 件 (`import-discord` / `snapshot-schedule`) も別系統で無関係
  - **検証**: `tsc --noEmit` PASS。**V1 動的検証 (PR merge 後 paths trigger)** PASS — demo project (`raid-repository-demo`) で「Deploy Database (Demo)」workflow が `succeeded in 29s` で全 step ✓ (schema.sql + seed-demo.sql 投入成功、demo project の categories / loot / app_settings.demo_seed_applied=1 sentinel すべて期待値)、「Deploy Database (Production)」も同 push で発火し `Apply supabase/schema.sql` step が灰色 (Skipped、`SUPABASE_DB_URL` 未登録の demo 元 repo では skip するのが期待動作) で `succeeded in 4s`。Annotations 1 warning は `LF will be replaced by CRLF` の git 警告で実害なし
  - **本番側 V1 (同セッション内追加実施)**: ユーザー確認で「本リポは upstream + demo + 本番 (Lym 固定) の **3 役兼用 1 repo**」と確定 (`yyamazaki-lym/raid-repository` 1 個の GitHub repo を Vercel で demo project と本番 project の両方に link する構成)。本番 Supabase project の DB password を Reset → Session pooler URI を組み立て → 同 repo に `SUPABASE_DB_URL` secret として登録 → `workflow_dispatch` で `deploy-database.yml` を main 上で trigger ([run 25548744826](https://github.com/yyamazaki-lym/raid-repository/actions/runs/25548744826)) → 全 step ✓ で `succeeded` (`Apply supabase/schema.sql` も緑)、本番 V1 も PASS。`actions/checkout@v6` (PR #88) も反映済で Annotations 0 warning
  - **他者運用の本番 fork (LymRestoria/yurutto 等)**: upstream pull (or GitHub UI の Sync fork) で workflow ファイル取り込み後、各人が自身の本番 Supabase URI を `SUPABASE_DB_URL` で各 fork repo に登録すれば、その fork でも自動反映が有効化される。各人のオプトイン作業
  - **設計ドキュメント**: `~/.claude/plans/todo78-typed-turtle.md`
- **2.1 (2026-05-08 part14)**: #76 follow-up — Section 11 sample 7 categories も seed-demo.sql に集約 (本番 fork は空 portal で起動) — クローズ ([PR #82](https://github.com/yyamazaki-lym/raid-repository/pull/82) squash merge `bfb3bbf`)
  - **発端**: PR #80 merge 後にユーザーが本番 Supabase で schema.sql を再実行したところ **7 件の sample categories** (`arcadion-heavy` / `arcadion-cruiser` / `arcadion-lightheavy` / `variant-shokyaku` / `extreme-cloud-of-darkness` / `ultimate-omega-protocol` / `ultimate-futures-rewritten`) が入ったまま、と報告。loot/mitigation/strategy 等の bulk demo data は 0 件 (PR #80 で seed-demo.sql に逃がし済) だが、Section 11 INSERT は schema.sql に残置していたため
  - **plan ミス**: 元 plan で Section 11 を「`ON CONFLICT DO NOTHING` で害なし、新規 fork ユーザーの動作確認に役立つ」として保持判断していたが、ユーザー認識では sample categories も明確に demo データであり、本番 fork では空 portal の方が望ましい
  - **修正方針 (ユーザー判断 2026-05-08)**: (1) Section 11 を全面 demo 扱いに格上げ (本番では空 portal、運営者が自分でカテゴリ追加)、(2) schema.sql 側に自動 cleanup DELETE は入れない (削除挙動が暗黙的になり既存運用を壊しうる)、(3) 既に入った 7 件は手動 SQL でユーザー側で削除する運用
  - **修正**: 旧 Section 11 INSERT (8 行) を schema.sql から削除し placeholder コメントブロックを「Section 11-13a: Sample / demo seed data — MOVED to seed-demo.sql」に拡張。seed-demo.sql 冒頭に **Section 0: Sample seed categories** (7 件 INSERT、`ON CONFLICT (slug) DO NOTHING`) を追加、Section 1 demo bulk seed が Section 0 の 5 件に紐付く流れを維持。schema.sql の seed 系 INSERT は完全消滅 — DDL/RLS/extensions/必須 cron のみの純粋スキーマ定義に
  - **README.md 更新**: 「Live demo」節を「7 カテゴリ」に修正、「2-2. スキーマ実行」節に「本番 = schema.sql のみで空 portal、運営者が自分で追加」「demo = schema.sql + seed-demo.sql でサンプル 7 カテゴリ + データ一括投入」の明確分岐を callout 化
  - **本番クリーンアップ用手動 SQL** (Supabase Dashboard SQL Editor で 1 回実行):
    ```sql
    DELETE FROM public.categories
    WHERE slug IN (
      'arcadion-heavy','arcadion-cruiser','arcadion-lightheavy',
      'variant-shokyaku','extreme-cloud-of-darkness',
      'ultimate-omega-protocol','ultimate-futures-rewritten'
    )
    AND name IN (
      '至天の座アルカディア：ヘビー級','至天の座アルカディア：クルーザー級',
      '至天の座アルカディア：ライトヘビー級','異聞商客物語',
      '滅暗闇の雲激闘戦','絶オメガ検証戦','絶もうひとつの未来'
    );
    ```
    name 一致 guard あり = ユーザー編集済の name の行は残置 (誤削除防止)。category_links 等の子 row は CASCADE 連動削除のため事前に件数確認推奨
  - **検証**: `tsc --noEmit` PASS (TS 影響なし、SQL のみの変更)
- **2.1 (2026-05-08 part13)**: #76 schema.sql の demo seed を seed-demo.sql 別ファイルに分離して本番再実行時の誤挿入を構造的に根治 — クローズ ([PR #80](https://github.com/yyamazaki-lym/raid-repository/pull/80) squash merge `9347746`)
  - **真因**: TODO #8 part C-ii (2026-05-01) で `supabase/schema.sql` Section 12 (demo bulk seed) に `app_settings.demo_seed_applied='1'` sentinel ガードを入れて再実行時の重複挿入は防げていたが、Section 13a (URL ベース NOT EXISTS guard のみ、追加コンテンツ seed) を追加した時点で sentinel に依存しない demo セクションが再発。新章追加時にガードの再実装が必要で「demo only」全体ガード機構が schema.sql に存在しないことが本質的な弱点
  - **修正**: Section 12 (行 838-1242) + Section 13a (行 1243-1310) ~473 行を新規 [supabase/seed-demo.sql](supabase/seed-demo.sql) (489 行、demo project 専用) に物理分離。schema.sql には placeholder コメント (~10 行) を残置。冪等ガード (sentinel + URL NOT EXISTS) は seed-demo.sql 内に温存し demo 再適用時の安全性を維持。schema.sql は 1365 → 904 行 (-461 行)、Section 1〜11 + Section 13b (pg_cron) は完全無改修
  - **運用変更**: 本番 fork は `schema.sql` のみ適用 (現状運用と同じ、demo データは入らなくなる)、demo project は `schema.sql` + `seed-demo.sql` の 2 段適用 (新規ステップ)
  - **README.md 更新**: 「Live demo」節に seed-demo.sql 由来の明記、「2-2. スキーマ実行」節に demo project 専用 callout (本番では実行しない警告) を追加
  - **採らなかった案**: 案 A (GUC `current_setting('app.is_demo', true)='1'` 判定) — per-session SET 忘れリスク + 各セクションのラッパー保守負担が残るため却下、案 C (Supabase project_id 判定) — SQL から取得不能で hard-code 必要、fragile で却下
  - **既存環境への影響**: demo project は sentinel 行が既に入っているので seed-demo.sql 再実行で skip、state 変化なし。本番 fork に既に誤挿入された demo データの cleanup は admin の「全データ初期化」(TODO #23) で別途対応する想定 (本 TODO のスコープ外、forward-looking only)
  - **検証**: `tsc --noEmit` PASS (TS 影響なし、SQL のみの変更)。本番 Supabase での schema.sql 再実行で demo データが追加されないことの実機確認は本 PR merge 後にユーザー側で実施
  - **設計ドキュメント**: `~/.claude/plans/handoff-md-todo-dreamy-pumpkin.md`
- **2.1 (2026-05-08 part12)**: #75 sync 出欠 iframe 内「日程登録 / コメント登録」ボタンが押せない不具合修正 — クローズ ([PR #78](https://github.com/yyamazaki-lym/raid-repository/pull/78) squash merge `a4346bc`)
  - **真因**: [src/components/portal/schedule-edit-frame-dialog.tsx:134](src/components/portal/schedule-edit-frame-dialog.tsx) の `<iframe sandbox>` 属性に `allow-modals` トークンが欠落しており、iframe 内 (character-sheets) JS の `alert/confirm/prompt/print` 呼び出しが blocked されていた。character-sheets app の登録系 button (日程登録 / コメント登録 / 削除) は既存登録ありの場合に「上書きしますか?」「削除しますか?」等の `confirm()` を呼ぶ経路があり、blocking で例外発生 → form submit 中断、ユーザーには「button が押せない」と認識されていた
  - **修正**: sandbox 文字列末尾に `allow-modals` を追加 (1 トークン、1 行)。iframe 内 native modal が動作するようになり register / comment / delete 系 button が反応するようになる
  - **demo / 本番差の説明**: コードは同一だが character-sheets 側のデータ依存。demo は新規登録なし経路で `confirm()` 不要 → 押せた、本番 Lym は既存データあり経路で `confirm()` 経由 → blocking 発動 = 押せない、で再現環境差が出ていた
  - **観察フェーズ (前セッション、2026-05-08 part11)**: `~/.claude/plans/todo75-federated-dahl.md` で実機 Claude in Chrome 観察により仮説 A (popover DOM 残留 — `popoverCount=0`) / B (focus restore 不完全 — `activeElement=IFRAME` で正常移動) / C (sandbox `allow-scripts` 不足 — 既に含まれている) / D (dialog overlay 遮蔽 — `topElementAt(button center)=IFRAME`) を全否定し、仮説 E = sandbox `allow-modals` 欠落を新発見・特定
  - **採らなかった案**: (a) character-sheets app 側で `confirm()` を独自カスタム modal に置換 → portal 外 repo で工数大、(b) dialog header の「新しいタブ」link を促進する UI に変更し iframe 内 form 操作を非推奨化 → UX 後退で却下
  - **検証**: 本番 deploy 後にユーザー実機 (本番 Lym 0521 以降 row) で「押せる」確認済 (2026-05-08)
- **2.1 (2026-05-08 part11)**: #74 設定 dialog mode 切替で section 出し分けが即時反映されない不具合修正 — クローズ ([PR #76](https://github.com/yyamazaki-lym/raid-repository/pull/76) squash merge `93ada17`)
  - **真因**: [src/components/portal/settings/schedule-source-mode-section.tsx](src/components/portal/settings/schedule-source-mode-section.tsx) が独自の `mode` useState を持つ一方、parent [src/components/portal/settings-dialog.tsx](src/components/portal/settings-dialog.tsx) の `mode` useState への通知 callback が無く、section の `router.refresh()` は Next.js 16 仕様で Server Component の data refetch のみ実行し Client State (parent useState) は保持するため、parent `mode` が dialog 初回 open 時の値で固まり続ける。結果 `mode === "sync" / "native"` の条件分岐 (settings-dialog.tsx 行 205-249) が永久に更新されず、close → 再 open でしか正常化しなかった
  - **修正**: `ScheduleSourceModeSection` に optional `onModeChange?: (mode: ScheduleSourceMode) => void` prop を追加 (DB 初期 fetch successful path / radio onChange / server action 失敗時の rollback の 4 箇所で callback 呼出)、settings-dialog から `onModeChange={setMode}` を渡して parent state と同期。触る範囲は 2 ファイル / +12 行 / -2 行
  - **副次効果**: parent `mode` 変化を `useEffect [open, mode, adminAuxTick]` (settings-dialog.tsx 行 135-148) が感知できるようになり、初回 native 切替時に `adminAux` fetch も即時発火するようになる (従来は dialog 再 open しないと fetch されない壊れ状態)
  - **採らなかった案**: (a) mode 切替時に dialog 自動 close → 再 open は UX 後退で却下、(b) `<div key={mode}>` で native 4 section を wrap は条件分岐の mount/unmount で internal state が自然 reset されるため冗長で却下、(c) 各 section に reset effect は分散実装で抜けやすく却下
  - **触らない範囲**: `native-members-section.tsx` / `native-choice-values-section.tsx` / `native-cancelled-sessions-section.tsx` / `native-discord-notify-section.tsx` は完全に無改修。条件分岐 mount/unmount で internal state (drafts / channelDraft / roleDraft 等) が自然 reset される
  - **検証**: `tsc --noEmit` PASS。worktree dev preview で sync → native → disabled → sync の 3 mode 遷移を実機確認、各遷移で section 出し分けが即時切替わり (sync 用 `Schedule Source` / `Past Sessions` ↔ native 用 4 section ↔ disabled 時は共通 section のみ) console error 0 件。CRUD round trip (member 追加 / 凡例 CSV 編集中の mode 切替で drafts が消えること) は本番 deploy 後にユーザー実機検証
  - **設計ドキュメント**: `~/.claude/plans/todo-74-dynamic-rocket.md`
- **2.1 (2026-05-08 part10)**: #2 phase 3+4 (TODO #2 完結) — native スケジュール Discord 通知。設計は単一 PR で phase 3 (通知 dispatch + 手動 button) と phase 4 (cron + ON/OFF + 設定 UI) を一括実装。**設計上の重要点**: 当初 phase 3 設計の「DECISION 遷移 / session 作成時の auto-notify 4 イベント」はユーザーが「自動 trigger は良くない、手動なら良い、自動は当日 12:00 JST のみ」と却下したため**実装しない**。自動通知の唯一のパスは **当日 12:00 JST cron** (`/api/cron/notify-native-schedule`)、手動 Bell button は ON/OFF と無関係に常時動作、ON/OFF トグルは cron path のみ gate。PR [#59](https://github.com/yyamazaki-lym/raid-repository/pull/59)。
  - **新規** [src/lib/server/native-schedule-discord.ts](src/lib/server/native-schedule-discord.ts): dispatch module (`notifyNativeScheduleSession({ sessionId, respectToggle, respectDedup })` + `dispatchNoonNotifyForToday()`)。Discord API v10 endpoint 直接 fetch (Bot token + `User-Agent: RaidRepositoryBot/0.1` + `AbortSignal.timeout(15000)`)、`allowed_mentions: { roles: [roleId] }` で role mention のみ parse 許可 (`@here` / 個別 user の暴発防止)、role ID 未設定なら mention 無し平文。メッセージ format は `<@&{roleId}> 本日の固定活動予定日です` + `📅 raw_date` + `🕘 start~end` + `📝 note` + 出欠集計 (○/△/×/未回答 別)
  - **新規** [src/app/api/cron/notify-native-schedule/route.ts](src/app/api/cron/notify-native-schedule/route.ts): cron route。auth は `Authorization: Bearer ${CRON_SECRET}` OR `x-vercel-cron` header、`runtime: 'nodejs'` / `dynamic: 'force-dynamic'` / `maxDuration: 60`。`native_schedule_discord_notify_enabled='false'` なら `{ ok: true, skipped: 'disabled' }` 即返却。`vercel.json` に `{ path: '/api/cron/notify-native-schedule', schedule: '0 3 * * *' }` (UTC 03:00 = JST 12:00) を追加
  - **新規** [src/components/portal/native-schedule/session-discord-notify-button.tsx](src/components/portal/native-schedule/session-discord-notify-button.tsx): 手動 Bell button。`schedule-list.tsx` の確定セルで `mode === 'native' && isAdmin && status === 'DECISION' && !isPast && nativeSessionId` の 5 条件 AND で SessionStatusToggle 隣に mount。click → confirm → `notifyNativeScheduleSessionAction(sessionId)` → toast。`respectToggle:false, respectDedup:false` で ON/OFF 無関係 + 再送可能
  - **新規** [src/components/portal/settings/native-discord-notify-section.tsx](src/components/portal/settings/native-discord-notify-section.tsx): settings UI 1 section に 3 controls (ON/OFF toggle / channel ID input / role ID input)。phase 2-C `native-choice-values-section.tsx` と同じ即時保存パターン (`useTransition` + parent-sync `useEffect` + toast + `onChanged` + `router.refresh()`)、両 ID は `/^\d{17,20}$/` で client validate (server 側と二重化)、空保存で row delete
  - **schema 追加** [supabase/schema.sql](supabase/schema.sql): `native_schedule_sessions.last_notified_at timestamptz` 列 + 3 app_settings keys seed (`native_schedule_discord_notify_enabled='true'` のみ default ON、channel/role は seed なし)。dedup 列の必要性は **Vercel cron at-least-once delivery** で Discord 5xx retry の二重送信を防ぐため、cron path で `last_notified_at IS NULL` で絞り、POST 成功後に `now()` で UPDATE。手動 button は dedup を無視
  - **service role 抽出** [src/lib/supabase/server.ts](src/lib/supabase/server.ts): `createServiceRoleClient()` を export 化。cron route は Vercel 側で実行されるため cookie session が無く anon 扱いとなり `last_notified_at` UPDATE が RLS で拒否される、よって service role 必須。manual button 経路でも統一して service role を使い、認可は server action 側の `assertAdminResult` で二重化
  - **server actions 4 個追加** [src/lib/server/native-schedule-actions.ts](src/lib/server/native-schedule-actions.ts): `setNativeScheduleDiscordNotifyEnabledAction` / `setNativeScheduleDiscordNotifyChannelIdAction` / `setNativeScheduleDiscordNotifyRoleIdAction` (全て admin gate + `upsert` with `onConflict: 'key'` + 空文字 DELETE) + `notifyNativeScheduleSessionAction` (manual button entry)
  - **adminAux 拡張** [src/lib/schedule/native-admin-client.ts](src/lib/schedule/native-admin-client.ts): `fetchNativeScheduleAdminAux()` の `Promise.all` に 3 keys 取得追加、`NativeAdminAux` 型に `discordNotifyEnabled: boolean` (default `true`) / `discordNotifyChannelId: string \| null` / `discordNotifyRoleId: string \| null` を追加
  - **PR #57 由来の auto-notify 削除**: `native-schedule-actions.ts` から PR #57 で仕込んだ `notifyNativeSessionCreated/Decided/Cancelled/Deleted` 4 関数 hook を全削除 (3 actions の `try/catch` ブロックと `rowToSessionLike` / `pickStatusNotifier` helpers を削除、SELECT 列も `id` のみに戻した)。**ファイル削除**: `src/lib/server/discord-post.ts` (PR #57 で新規追加した embed POST 共通ラッパ、149 行) — 新設計では `native-schedule-discord.ts` が直接 fetch する形になり、PR #57 の `dry_run` / `rate_limited` / `discriminated union 戻り値` モデルは廃止。**env 削除** [.env.local.example](.env.local.example): `DISCORD_NOTIFY_DRY_RUN` / `DISCORD_NOTIFY_MENTION_ROLE_ID` を削除 (channel/role は DB の `app_settings` に移動、DRY_RUN は新設計では不要 — channel ID 未設定で no-op)
  - **検証**: `tsc --noEmit` PASS、`npm run lint` 既存 35 errors のみ (新規 0、phase 2-C からの baseline)、schema.sql idempotent (`IF NOT EXISTS` / `ON CONFLICT DO NOTHING`)。本番 DB 連動 (cron 当日 12:00 JST 発火 / 手動 button 投稿 / dedup 動作 / ON/OFF 切替) は本番 deploy 後にユーザー実機で検証 (本ファイル冒頭「保留オペレーション」節のチェックリスト)
  - **設計ドキュメント**: `.claude/plans/todo-2-phase-4-abstract-nygaard.md` (phase 3+4 統合実装の詳細設計)
  - **本 PR で 5 phase シリーズの実装は完了** (phase 1 mode 切替 / 2-A server-side 基盤 / 2-B トップ UI / 2-C settings 3 section / 3+4 Discord 通知 cron + 手動 + ON/OFF)。**ただし TODO #2 自体は close ではない** — 本番運用検証 (本ファイル冒頭「保留オペレーション」節 項目 3 = ON/OFF トグル ON 切替) と、phase 4 plan で言及された残候補 (`mode==='native'` 時の既存 sync cron skip / DECISION 確定後のリマインダー cron (24h 前 / 開始時) / video / FFLogs 連携整合) の要否確定がユーザー判断待ち
- **2.1 (2026-05-07 part9)**: #2 phase 2-C — native スケジュール settings UI 3 section。phase 2-B のトップ UI に対応する管理側 UI を埋めて自前モードを実運用可能にした。新規 server action なし、phase 2-A で実装済の 4 actions (`addNativeScheduleMemberAction` / `updateNativeScheduleMemberAction` / `deleteNativeScheduleMemberAction` / `setNativeScheduleChoiceValuesAction` / `setNativeScheduleSessionStatusAction`) を流用。3 PR シリーズ ([#53](https://github.com/yyamazaki-lym/raid-repository/pull/53) / [#54](https://github.com/yyamazaki-lym/raid-repository/pull/54) / [#55](https://github.com/yyamazaki-lym/raid-repository/pull/55))。
  - **新規 client reader** ([src/lib/schedule/native-admin-client.ts](src/lib/schedule/native-admin-client.ts)): `fetchNativeScheduleAdminAux()` を追加。settings UI が必要とする集合 (`is_active=false` 含む全 member / `status='CANCELLED'` 行 / 凡例 CSV 現値) を 1 回の Promise.all で取得。`fetchNativeSchedule()` は schedule-list が要求する集合に絞っているので別経路、`schedule-url-store.ts` と同じ `"use client" + supabase/client` パターン。RLS は schema.sql 7 章ループの `USING (true)` で SELECT 全面開放されている前提
  - **新規 section** ([src/components/portal/settings/native-members-section.tsx](src/components/portal/settings/native-members-section.tsx)): Discord ID + 表示名 + sort_order + is_active toggle + 削除 を inline 編集。表示名 / sort_order は drafts state で差分時のみ「保存」button 表示、is_active toggle と削除は即時 commit。Discord ID 17–20 桁 regex を client 側で軽 validate (server 側と二重化)
  - **新規 section** ([src/components/portal/settings/native-choice-values-section.tsx](src/components/portal/settings/native-choice-values-section.tsx)): 凡例 CSV を 1 行 Input で編集、live preview chip 列付き、空保存または「既定値に戻す」で fallback (○,×,△,⏰,─) に復帰。`parseCsv` は `native-fetch.ts#parseChoiceValues` と同じ split + trim + filter Boolean (server-only / client 境界を跨がないため重複は許容)
  - **新規 section** ([src/components/portal/settings/native-cancelled-sessions-section.tsx](src/components/portal/settings/native-cancelled-sessions-section.tsx)): `status='CANCELLED'` の sessions を一覧、各行に「候補に戻す / 確定に戻す」button、`setNativeScheduleSessionStatusAction(id, 'CANDIDATE'|'DECISION')` で復帰、確認 dialog + toast + onChanged + router.refresh()
  - **編集** ([src/components/portal/settings-dialog.tsx](src/components/portal/settings-dialog.tsx)): `adminAux` state + `adminAuxTick` state + `mode==='native'` 用 useEffect 追加で aux データ取得、CRUD 後は section から `onChanged` で tick bump → 再 fetch。3 section を `mode==='native'` ガードで mount。section 順序は `Mode → Members → ChoiceValues → CancelledSessions → FflogsSync → ChangelogFooter → DangerZone` で `mode==='sync'` 時の `ScheduleSourceSection` (URL) と `PastSessionsSection` (chId + import/snapshot) のガードと完全対称
  - **schema 変更なし**: 実装着手時に schema.sql 7 章ループを確認、`FOR SELECT TO anon, authenticated USING (true)` で全テーブル SELECT を open しているため `is_active=false` / `status='CANCELLED'` の行も普通に SELECT 可能、admin SELECT policy 追加は不要
  - **検証**: `tsc --noEmit` PASS。worktree dev preview (DEV_AUTH_BYPASS=true + main repo `node_modules` junction + main repo `.env.local` コピー) で 3 PR ごとに (1) sync mode で既存 UI 完全維持 (3 native section 非 mount), (2) mode='native' に切替 + reload + 設定 dialog 再 open で各 section が描画 + 空状態 placeholder + 入力 form 描画, (3) console error 0、を `preview_eval` / `preview_snapshot` で実測。CRUD round trip (member 追加 / 編集 / 削除 / is_active toggle / 凡例 CSV 保存と既定値復帰 / CANCELLED 行復帰) は本番 DB write 回避のため未実施、本番デプロイ後にユーザー実機で確認予定
  - **設計ドキュメント**: `.claude/plans/todo-2-phase-2-c-enchanted-kurzweil.md`
- **2.1 (2026-05-07 part8)**: #2 phase 2-B — native スケジュール UI 第 1 弾。phase 2-A (server-side 基盤) の上に admin 候補日追加 dialog + 本人出欠入力 popover + admin status toggle dropdown を載せて native mode を実利用可能にした。settings の members CRUD / 凡例 chip editor / CANCELLED 行復帰 UI は phase 2-C で別セッション。
  - **新規 component** (`src/components/portal/native-schedule/`): [candidate-date-dialog.tsx](src/components/portal/native-schedule/candidate-date-dialog.tsx) (admin 専用、Schedule h1 横の `+` icon trigger + 日付/時刻/備考 form + `createNativeScheduleSessionAction` 呼出 + 同日 raw_date 重複 toast) / [native-attendance-popover.tsx](src/components/portal/native-schedule/native-attendance-popover.tsx) (本人 only、symbol radio + comment textarea + Save/Cancel + `upsertNativeScheduleAttendanceAction`、`<PopoverContent finalFocus={false}>` + `{open && <PopoverContent>}` controlled unmount で TODO #72 教訓踏襲) / [session-status-toggle.tsx](src/components/portal/native-schedule/session-status-toggle.tsx) (admin、`<DropdownMenu>` + `RadioGroup` で 3 値切替 + `setNativeScheduleSessionStatusAction`、CANCELLED 選択 toast 警告)
  - **型拡張**: [src/lib/schedule/parse.ts](src/lib/schedule/parse.ts) に `NativeScheduleMeta` 型 + `ParsedSchedule.nativeMeta?` field を新設 (`sessionIdByRawDate` + `commentsByPair`、sync 経路では undefined)。[src/lib/schedule/next-session.ts](src/lib/schedule/next-session.ts) は re-export 追加
  - **fetcher 拡張**: [src/lib/schedule/native-fetch.ts](src/lib/schedule/native-fetch.ts) attendances SELECT に `comment` 列追加 + `commentsByPair` map 構築 + `sessionIdByRawDate` map 構築 + `data.nativeMeta` に同梱
  - **配線**: [src/components/portal/schedule-page-body.tsx](src/components/portal/schedule-page-body.tsx) で `_currentDiscordId`/`_isAdmin` の prefix 除去 + `<ScheduleList>` への drill + `mode === 'native' && isAdmin` のとき header に `<CandidateDateDialog>` mount + amber バナー文言更新。[src/components/portal/schedule-list.tsx](src/components/portal/schedule-list.tsx) Props 拡張 (`mode` / `currentDiscordId` / `isAdmin`) + `result.data.nativeMeta` 解決 + SessionRow に drill。SessionRow 内 2 箇所分岐: 確定列 (`mode === 'native' && isAdmin && nativeSessionId` で `<SessionStatusToggle>`) + 出欠 cell (5 条件 AND で `<NativeAttendancePopover>`)
  - **TODO #72 教訓**: popover は `<PopoverContent finalFocus={false}>` + `{open && <PopoverContent>}` controlled unmount を必須化、controlled mode の `<Popover open={open} onOpenChange={setOpen}>` で開閉。dropdown は base-ui Menu の `data-closed` アニメ廃止済 (TODO #65 part8) で別系統
  - **本人判定の漏れ防止**: native popover trigger は `mode === 'native' && !isPast && currentDiscordId === u.userId && nativeSessionId && attendanceOptions` の 5 条件 AND で初めて mount、誤 trigger 化を構造的に排除
  - **CANCELLED の dead-end**: status toggle で CANCELLED 選択 → 次回 fetch で行消失。復帰 UI は phase 2-C 予定、toast で「中止しました (一覧からは非表示になります)」と明示
  - **検証**: `tsc --noEmit` PASS。worktree dev preview (DEV_AUTH_BYPASS=true) で (1) mode=sync で既存挙動完全維持、(2) mode=native 切替 → header `+` button mount + amber バナー描画 + 「予定なし」placeholder 表示、(3) `+` click → CandidateDateDialog 開閉 + form fields (date / time x2 / textarea) 描画 + Save/Cancel 描画、(4) 空 submit で「日付を入力してください」 validation 表示、(5) dialog close → DOM の `[data-slot="popover-content"]` 0 件残留 (TODO #72 退行検証)、(6) console errors / warnings 0 件、を `preview_eval` で実測。DB 連動 (popover symbol 編集 / status toggle / 候補日追加 submit) は prod DB write 回避のため未実施、本番デプロイ後にユーザー実機で確認予定
  - **設計ドキュメント**: `.claude/plans/todo-2-phase-2-b-resilient-seal.md` (本 phase 設計)
- **2.1 (2026-05-07 part7)**: #2 phase 2-A — native スケジュール server-side 基盤を実装 (UI は phase 2-B / 2-C で別 PR)。phase 1 の skeleton fetcher を実データ fetch に置換 + 出欠入力に必要な self-row RLS policy 追加 + 4 機能 (候補日追加 / 出欠入力 / member 管理 / 凡例 master) の Server Actions 8 種を新規ファイルに集約 + page.tsx native 分岐に `requireDiscordMember()` を Promise.all で並列取得して `SchedulePageBody` に `currentDiscordId` / `isAdmin` prop drill (UI 側参照は次 phase)。
  - **新規 schema** ([supabase/schema.sql](supabase/schema.sql) 7a セクション): `native_schedule_attendances` に `_self_insert` / `_self_update` policy を別名追加 — `(auth.jwt() -> 'app_metadata' ->> 'discord_id') = discord_user_id` で本人 row のみ許可。admin policy (7 章ループ) と OR 評価され、admin はそのまま全 row 編集可、非 admin は本人 row のみ。delete は admin only 維持
  - **新規ファイル** ([src/lib/server/native-schedule-actions.ts](src/lib/server/native-schedule-actions.ts)): 8 server actions — `createNativeScheduleSessionAction` / `deleteNativeScheduleSessionAction` / `setNativeScheduleSessionStatusAction` / `addNativeScheduleMemberAction` / `updateNativeScheduleMemberAction` / `deleteNativeScheduleMemberAction` / `setNativeScheduleChoiceValuesAction` (admin gate via `assertAdminResult`) + `upsertNativeScheduleAttendanceAction` (`requireDiscordMember()` で auth user 確定 → RLS WITH CHECK で本人 row のみ通す、admin gate ではない)。symbol 空文字列で row 削除扱い、`raw_date` UNIQUE 違反は 23505 で「同じ日時の候補日がすでにあります」を toast、Discord ID は 17〜20 桁 regex validate
  - **編集** ([src/lib/schedule/native-fetch.ts](src/lib/schedule/native-fetch.ts)): skeleton → 本実装。`native_schedule_members` (is_active=true, sort_order ASC) + `native_schedule_sessions` (CANCELLED 除外, parsed_date DESC) + `app_settings.native_schedule_choice_values` を Promise.all で 3 並列、attendances は session_id IN(...) で一括 SELECT して matrix 構築。choice_values 未設定時は既定 5 種 `["○","×","△","⏰","─"]` fallback (`source: "fallback-from-list"`)。CANCELLED は SELECT で `.neq('status','CANCELLED')` で UI に出さず履歴は DB に残す
  - **編集** ([src/app/(portal)/page.tsx](src/app/(portal)/page.tsx)): native 分岐の Promise.all に `requireDiscordMember()` 追加、`SchedulePageBody` に `currentDiscordId={member.discordId}` / `isAdmin={userIsAdmin(userRoles)}` を渡す。sync 分岐は無改修 (既存挙動完全維持)
  - **編集** ([src/components/portal/schedule-page-body.tsx](src/components/portal/schedule-page-body.tsx)): `currentDiscordId?: string \| null` / `isAdmin?: boolean` prop 追加、本 phase では body 内で参照しない (`_` prefix で unused 抑止)。phase 2-B で popover / dialog から参照
  - **schema 適用**: phase 1 と同様 Supabase Dashboard SQL Editor で `supabase/schema.sql` 再実行 (idempotent)。`SELECT polname FROM pg_policy WHERE polrelid='public.native_schedule_attendances'::regclass` で `_self_insert` / `_self_update` の 2 行が出ることで適用確認可能
  - **検証**: `tsc --noEmit` PASS。phase 2-A は UI 改修なし server-side 基盤のみなので dev preview の機能テストは Supabase schema 適用 + `app_settings.schedule_source_mode='native'` 切替後にユーザー実機で確認 (members 0 件で空状態描画、SQL で member 追加すれば user 列ヘッダーに表示、sessions 未作成のままなので「予定なし」placeholder のまま)
  - **設計ドキュメント**: `.claude/plans/todo-2-phase-2-virtual-panda.md` (phase 2-A 詳細 + 2-B/2-C 後続 plan)。phase 2-B 着手時はこのファイルの「後続 phase」節を参照
- **2.1 (2026-05-07 part6)**: #2 phase 1 — スケジュールソースモード切替 (`sync` / `native` / `disabled`) のインフラを追加。default = `sync` (既存運用と互換)。`native` mode は phase 1 では空状態 skeleton 表示のみ、`disabled` は機能停止 notice のみ。`mode` 切替は `app_settings.schedule_source_mode` の 1 行 update で完結し、sync/native の DB データは両方残置 (往復で履歴を失わない)。Phase 2 以降 (候補日追加 UI / 出欠入力 popover / Discord 通知 / リマインダー cron) は別 TODO で起票予定。
  - **新規 schema** (`supabase/schema.sql` 5e セクション): `native_schedule_sessions` (id / raw_date UNIQUE / parsed_date / start/end_time / day_of_week / status: CANDIDATE|DECISION|CANCELLED / note / created_by_id) + `native_schedule_members` (discord_user_id PK / display_name / sort_order / is_active) + `native_schedule_attendances` (session_id × discord_user_id 複合 PK / symbol / comment)。RLS は既存 7 章ループに追加 (SELECT は anon、INSERT/UPDATE/DELETE は `is_admin = 'true'`)、Realtime publication にも追加
  - **メンバー識別子は Discord OAuth `app_metadata.discord_id`** (portal 内発番なし、二重管理回避)
  - **新規ファイル**: [src/lib/schedule/source-mode.ts](src/lib/schedule/source-mode.ts) (`getScheduleSourceMode()` server helper、default fallback = `'sync'`) / [src/lib/schedule/native-fetch.ts](src/lib/schedule/native-fetch.ts) (空 ScheduleFetchResult を返す skeleton) / [src/components/portal/schedule-disabled-notice.tsx](src/components/portal/schedule-disabled-notice.tsx) / [src/components/portal/settings/schedule-source-mode-section.tsx](src/components/portal/settings/schedule-source-mode-section.tsx) (3 択 radio + 即時保存 + `router.refresh()`)
  - **編集**: [src/app/(portal)/page.tsx](src/app/(portal)/page.tsx) で mode 分岐、[src/components/portal/schedule-page-body.tsx](src/components/portal/schedule-page-body.tsx) に `mode` prop + scheduleUrl を `string | null`、[src/components/portal/settings-dialog.tsx](src/components/portal/settings-dialog.tsx) に新 section + sync 専用 UI を `mode === 'sync'` ガード、[src/lib/server/categories-actions.ts](src/lib/server/categories-actions.ts) に `setScheduleSourceModeAction(mode)` 追加 (admin gate)、[src/lib/schedule-url-store.ts](src/lib/schedule-url-store.ts) に `getScheduleSourceModeFromDb()` client reader を追加 (settings dialog の useEffect 用)
  - **schema 適用**: 本 PR では DDL を `schema.sql` に追記したのみ。Supabase Dashboard SQL Editor で再実行してテーブル作成は別途必要 (既存環境に対しても idempotent)。phase 1 は native テーブル参照しない skeleton なのでテーブル未作成でも portal 動作には影響なし
  - **検証**: `tsc --noEmit` PASS。dev preview で 3 mode (sync = 既存維持 / native = 準備中バナー + 空 list / disabled = 機能停止 notice) の切替・表示確認。settings dialog で mode radio が正しく表示・即時保存し、`mode === 'sync'` のときのみ URL / Discord channel section と Save ボタンが表示される
  - **設計ドキュメント**: `.claude/plans/todo-dazzling-locket.md` に Phase 1〜4 全体設計を保存済。phase 2 起票時はこのファイルを参照
- **2.1 (2026-05-07 part5)**: #72 完全解消 — 案 J 後もユーザー実機で「コメントボタン本体の太い白枠」継続報告 → **真因 = popover content の DOM 残留ではなく Base UI Popover focus restore による trigger button の `:focus-visible` auto outline** と再特定。案 K1 (`bootstrap click()` 撤去, PR [#44](https://github.com/yyamazaki-lym/raid-repository/pull/44)) はハズレ、案 K3 (`<PopoverContent finalFocus={false}>`, PR [#45](https://github.com/yyamazaki-lym/raid-repository/pull/45)) で根絶
  - **真因確定**: `node_modules/@base-ui/react/popover/popup/PopoverPopup.js:118-124` の `FloatingFocusManager` が `disabled: !mounted || openReason === REASONS.triggerHover` で hover open 時のみ focus management を無効化する設計。しかし `comment-popover.tsx` は controlled mode で React 側から `setOpen(true)` を直接呼ぶため、Base UI 内部 store の `openReason` が `triggerHover` と認識されず → focus management 常時 enable → close 時に `returnFocus: finalFocus` (default = trigger に戻す) で trigger に programmatic focus → `:focus-visible: true` → `globals.css * { outline-ring/50 }` の auto outline visible (= 太い白枠)。`PopoverRoot` には `openOnHover` API が無いため controlled mode で reason を Base UI に伝える方法はなく、`<PopoverPopup finalFocus={false}>` で close 時の focus restore そのものを無効化する方針が解
  - **観察手法**: Claude in Chrome で demo 環境 (commit `331cb27` 案 J 適用済) で実機 hover/leave + `javascript_tool` の `getComputedStyle().outline` / `matches(':focus-visible')` で測定。修正前 `outline-style: auto` / `:focus-visible: true` / `outline-color: oklab(0.92 -0.03 -0.03 / 0.5)` (= --ring 銀白色 50% opacity) を確認、修正後 `activeElement = BODY` / `:focus-visible: false` / `outline-style: none` で根絶検証
  - **修正** ([src/components/portal/comment-popover.tsx](src/components/portal/comment-popover.tsx)):
    - 案 K1 (PR [#44](https://github.com/yyamazaki-lym/raid-repository/pull/44) commit `476ebfd`): bootstrap `triggerRef.current?.click()` と `bootstrapped` state を撤去、`onMouseEnter` を `setOpen(true)` のみに簡素化。実機検証で太い白枠継続 → 仮説 (programmatic click() が keyboard modality 化) はハズレ。案 J controlled unmount は副作用なしで維持
    - 案 K3 (PR [#45](https://github.com/yyamazaki-lym/raid-repository/pull/45) commit `5424391`): `<PopoverContent finalFocus={false}>` で close 時の focus restore を無効化。実機検証で太い白枠根絶
  - **a11y trade-off**: click outside / escape close でも trigger に focus 戻らない。CommentPopover は装飾的アイコントリガー (popover content にも focusable element なし) で keyboard ユーザー多用パスではないため影響軽微
  - **再導入禁止リスト**: `<PopoverContent>` の `finalFocus={false}` を撤去すると Base UI focus restore 経由で太い白枠が再発する。CommentPopover の Popover Root は controlled mode 維持 (`<Popover open={open} onOpenChange={setOpen}>`) を前提とした修正なので、Root を uncontrolled に戻す場合は `finalFocus` の挙動も再評価必要
  - **検証**: `tsc --noEmit` PASS。demo (commit `5424391` 案 K3 適用後) で `Ctrl+Shift+R` → ヴェーネスのコメントアイコン hover → カーソル移動 → `document.activeElement.tagName === 'BODY'` / `getComputedStyle().outlineStyle === 'none'` を `javascript_tool` で測定確認。zoom screenshot で通常の細枠 (`border-[var(--neon-cyan)]/40`) のみ visible、太い白枠なし
- **2.1 (2026-05-07 part4)**: #72 部分解消 — 案 D / A / B / E / T 全敗 (案 D=focus 同期, 案 A=bootstrap click, 案 B=常駐 MutationObserver, 案 E=`[&:not([data-open])]:hidden`, 案 T=`<Portal keepMounted>`) → **Claude 自前観察フェーズで rapid 連続 hover race の真因確定 + 案 J (controlled unmount) で demo 実機解消** **— ただし「コメントボタン本体の太い白枠」(別系統の Base UI focus restore 由来) はユーザー実機で継続、part5 案 K3 で根絶**
  - **観察手法**: Claude in Chrome で demo 環境 (`https://demo-raid-repository.vercel.app/`、本番と同一 Vercel production build) に対して実機 hover/click 操作 + `javascript_tool` で DOM 属性測定。Single hover では再現せず、**rapid 連続 hover (3 trigger 順次)** で 3 popover が `data-open=""` 残置 + `display: flex` で visible 残留することを **実測再現**。
  - **真因確定**: **複数 Popover の同時 `setOpen(false)` 並行発火**で React 19 production batch race が発生し `data-open` 属性が外れない。`keepMounted` (案 T) でも `[&:not([data-open])]:hidden` (案 E) でも `data-open` が外れる前提だったため両方失効。outside click は Base UI `useDismiss` が個別 Popover を確実な close path に乗せるため、ページ内 click で残留が解消する観測事実と一致。本番ユーザー報告「リロード直後 first hover → leave で白枠」は、複数メンバーアイコンを順次素早く hover していく自然な行為で発火していた。
  - **修正** ([src/components/portal/comment-popover.tsx](src/components/portal/comment-popover.tsx)): `<PopoverContent ...>...</PopoverContent>` を `{open && <PopoverContent ...>...</PopoverContent>}` で wrap (React 条件付き render = controlled unmount)。open=false 遷移時に React unmount path で確実に DOM tree から物理除去 → `data-open` 属性更新に依存しない。案 A bootstrap click は残置 (副作用なし、予防策)
  - **副次撤去** ([src/components/ui/popover.tsx](src/components/ui/popover.tsx)): 案 T `<PopoverPrimitive.Portal keepMounted>` → `<PopoverPrimitive.Portal>` に戻す + 案 E `[&:not([data-open])]:hidden` も削除 (案 J で不要化、コード簡潔化)
  - **動作差** (案 T 比): 初期 mount = 7 → 0 popover-content (paint cost 改善側)、close 経路 = `data-open` 外れ依存 → React unmount で確実、rapid 複数 close = batch race 影響を構造的に排除
  - **副作用受入**: 入場アニメ (`data-open:animate-in / fade-in-0 / zoom-in-95`) が open 時の新規 mount で必ず走る (本来そう設計されていた)。Base UI Popover.Root が `<PopoverContent>` 不在の状態で動作する (controlled mode の前提として API は許容、dev preview で実証)
  - **検証**: `tsc --noEmit` PASS。dev preview で baseline 0 popover-content / click open で 1 個 mount + 中身描画 / outside click で 0 個 + aria-expanded=false / rapid hover sequence で 0 個残留 / console errors 0 件、を `preview_eval` 実測。production race そのものは dev 再現不能だが、案 J の機構は `data-open` 属性更新に依存しないため race の影響を受けない設計上の保証あり。本番デプロイ後にユーザー実機で「リロード直後 hover → leave で白枠が visible に出ない」を最終確認予定
- **2.1 (2026-05-07 part3)**: #71 part3 — 残留検知時に `stale.remove()` で物理削除追加 + selector を `:not([data-open])` に絞り込み (part2 デプロイ後も本番白枠継続のため強化) **— 完全解消には至らず、未解決部分を TODO #72 に移管 (上記 part4 で根絶)**
  - **part3 デプロイ後のユーザー報告**: 「クリック後はホバーしても白枠は出なくなった。ページリロード後は、ホバーした状態で外すと白枠が出続ける状態が継続」
  - **新たな切り分け** (TODO #72 への申し送り):
    - click open → close: ✅ 残留なし (part3 で修正)
    - 一度 click 経路を通した後の hover → close: ✅ 残留なし (Base UI 内部状態が click でフル初期化済?)
    - **リロード直後の first hover → leave**: ❌ 残留継続 (hover-only path の問題)
  - **真因仮説 (未確定、TODO #72 で調査)**:
    - React 19 hydration 完了直後の最初の portal mount が不完全な状態で hover trigger される
    - mouseenter → setOpen(true) 経路で Base UI Popover の internal state が click 経路と異なる初期化を踏む (focus 移動なし、pointer events の event.type 違い等)
    - portal node が body 直下に持ち上がるタイミングで、初回だけ unmount path の cleanup ref が貼られない race
  - **次回会話の調査方針** (新規 TODO #72):
    - production build を `next start` で local 起動して再現確認 (worktree dev では再現不能を継続)
    - Base UI `@base-ui/react/popover` のソース (`node_modules/@base-ui/react/popover/`) を読み、open/close の internal cleanup 経路で hover-trigger 特殊化があるか確認
    - 別アプローチ: trigger に `onMouseEnter` で `setOpen(true)` を呼ぶ前に triggerRef.current?.click() を 1 度発火する hack で「click 経路を強制通過」させて初期化を補正する案
    - または、page mount 時に `MutationObserver` で `document.body` 直下の `[data-slot="popover-content"]:not([data-open])` を常時監視・自動除去する常駐ガード型対策
    - もしくは hover open そのものを諦めて click open に固定する UX 妥協 (CommentPopover は hover-first 設計だったが、white-frame 残留より click open 体験のほうがマシならトレードオフ)
  - 以下は part3 までの実装履歴 (技術的な経過記録):
  - **症状継続**: part2 (PR [#31](https://github.com/yyamazaki-lym/raid-repository/pull/31)) デプロイ後も「コメント開いた後にホバー外すと白い枠が出続ける」報告継続。part2 の「DOM 残留検知時のみ remount」では key bump (React tree remount) のみで対応していたが、Base UI の Portal 経由で document.body 直下に植えた node が React 側 unmount 後も物理的に残るケース (React 19 + Vercel Edge build での createPortal cleanup 漏れ race) では効かないと判明
  - **修正** ([src/components/portal/comment-popover.tsx](src/components/portal/comment-popover.tsx)):
    - selector を `[data-slot="popover-content"]` → `[data-slot="popover-content"]:not([data-open])` に絞り込み (open 中の他 popover を誤射しない)
    - `querySelectorAll` で複数 stale node を網羅取得
    - 検知時は **`stale.remove()` で物理削除 + `setRemountKey` で React tree remount** の二段重ね (Portal cleanup 漏れに対しては DOM 直接操作が最も確実、加えて Base UI internal state を新規 instance に置換)
    - 待機時間 200ms → 250ms (production の close transition + paint flush 完了をより確実に待つ)
  - **DOM 直接操作の副作用受入**: Base UI の internal state と DOM の整合が取れなくなる懸念は key bump 併用で React tree 全体 remount → Base UI instance も新規生成で解消。古い instance が削除済 node を参照する経路は無し
  - **動作差 (part2 比)**:
    - 通常 close: part2 = remount スキップ / part3 = 同じく remount スキップ (selector ゼロ件で hover 連続反応維持を継続)
    - DOM 残留 (production-only race): part2 = key bump のみ (Portal node に効かない場合あり) / part3 = `stale.remove()` 物理削除 + key bump 併用で確実
    - selector 範囲: part2 = 全 popover-content / part3 = close 状態のみ → 安全性向上
  - **検証**: `tsc --noEmit` PASS。dev preview で通常 close 経路 (open → close → 250ms 後 DOM 0 件 + 連続 click 再 open OK) 維持を `preview_eval` で確認。selector + node.remove() の単独動作も確認済。console error 0 件。production-only race は dev 再現不能のため本番デプロイ後ユーザー実機確認待ち
- **2.1 (2026-05-07 part2)**: #71 follow-up — 常時 remount による hover 連続反応の阻害を「DOM 残留検知時のみ remount」に縮退
  - **症状継続**: part1 (PR [#30](https://github.com/yyamazaki-lym/raid-repository/pull/30)) で白枠残留は消えたが、副作用として hover 経路の UX が劣化。close 後 200ms で必ず `key={remountKey}` bump → `<Popover>` ツリー全体が unmount/remount → trigger 要素も再生成 → cursor が trigger 上にあっても `mouseenter` は新規発火しない (mouseenter は要素境界を新規に跨いだ時のみ発火する仕様) → hover 連続反応が阻害され、再開には click が必要。ユーザー体感「クリック時 Open は割とだるい」
  - **ユーザー認識ズレ**: ユーザーは「白枠残留は新規更新時など稀な場合のみ出る」と想定していたが、part1 の修正は毎回の close で必ず remount する設計。本番運用では白枠残留自体は頻発していたが、毎回 remount は過剰と判断し条件付き化に縮退
  - **修正** ([src/components/portal/comment-popover.tsx](src/components/portal/comment-popover.tsx)):
    - close 後 200ms の `setTimeout` callback 内で `document.querySelector('[data-slot="popover-content"]')` で portal node の生存を判定
    - **残留時のみ** `setRemountKey((k) => k + 1)` で key bump (= 既存の DOM リセット挙動を発火、白枠根絶を維持)
    - **残留なし時** は何もしない (= 通常時 hover 連続反応を維持)
    - close → 200ms 待機中に open=true へ復帰した場合のレース対策で `else if (open && remountTimer.current)` 分岐を追加し timer を clearTimeout (open 中に key bump で popover が瞬間消失するのを防止)
    - `remountKey` の用途コメントを「常に remount」→「DOM 残留検知時のみ remount」に書き換え
  - **動作差 (part1 比)**:
    - 通常 close (DOM 正常 unmount): part1 = 200ms 後に必ず remount / part2 = remount スキップ → 連続 hover で再 open 可能
    - 稀な DOM 残留: 両者とも remount で根絶 (検知ロジック追加のみ、対応経路は等価)
    - 連続 hover で 200ms 内に再 open: part1 = remount → trigger 再生成で hover 復帰失敗 / part2 = timer cancel → スムーズに open 維持
  - **副作用受入**: selector `[data-slot="popover-content"]` は他の同時 open popover (recruitment-templates-button 等) も拾う可能性があるが、自分が残留してない場合 remount しても害は trigger サブツリーの 1 度の再 mount だけ (open 中の他 popover は別ツリーで触らない) なので UX 上ほぼ気付かない。厳密な identification (ref + aria-controls ベース) は Base UI internal id 体系に依存して実装コスト高 vs 効果薄なので不採用
  - **検証**: `tsc --noEmit` PASS。dev preview で click open → outside click close → 250ms / 550ms 後の DOM カウントを `preview_eval` で取得し、通常時に 0 件 (= remount 未発火) + 連続 click 再 open 可能を確認。phantom node を手動 inject した残留シナリオで selector が拾うこと + 再 click open が反応することも確認。console error / warning 0 件。本番デプロイ後にユーザー側で「hover 連続反応が click なしで復元している」+「白枠残留時は引き続き消える」を実機確認予定
- **2.1 (2026-05-07)**: #71 — TODO #70 follow-up: production build のみで残る popover DOM 残留を `<Popover key={remountKey}>` 強制 remount で根絶
  - **症状継続**: TODO #70 (PR [#29](https://github.com/yyamazaki-lym/raid-repository/pull/29)) で Strategy G を popover/tooltip に適用 → 本番 deploy 後も「ページ更新後 hover → カーソル外移動で白枠だけ残る」継続。条件: hover 経路のみ + click 経路では非発生 + scroll でも残り続け、枠外 click や別ウィンドウ選択で消える。dev preview では完全消失するが **production build のみ** で再発
  - **真因仮説**: Base UI Popover の `open` controlled prop 切替時、production build で portal close race が起きるか、もしくは trigger button の `:hover` paint が popover close と競合してブラウザの paint optimization で残留。Strategy G が前提とした「CSS exit transition リバウンド」とは別系統 (CSS は撤去済なのに残るので CSS 由来ではない)
  - **修正** ([src/components/portal/comment-popover.tsx](src/components/portal/comment-popover.tsx)):
    - `remountKey` state (`useState<number>(0)`) を追加、`<Popover key={remountKey} open={open} onOpenChange={setOpen}>` で key driven な force remount
    - `prevOpen` ref で open=true→false の遷移を検出する `useEffect`、close transition 完了後 (200ms) に `setRemountKey(k => k + 1)` を呼び出し → React が `<Popover>` ツリー全体を unmount + 新規 mount → portal / popup / trigger の DOM が完全リセット
    - cleanup の useEffect で `remountTimer` も clearTimeout (アンマウント時の memory leak 防止)
  - **副作用**: 200ms タイマー 1 つ追加 + reconciler の Popover サブツリー再生成 (6〜10 アイコンの小規模 portal なので GC コスト無視可能)。`hoverProps` (cancelClose / scheduleClose 120ms grace) のロジックは変更なし、UX 等価。連続 hover で cursor が trigger 上に残ったまま remount される場合に再 open される可能性あり (200ms 遅延で発生確率は低、許容)
  - **TODO #70 との関係**: Strategy G (popover/tooltip の close transition 撤去) は維持。本修正と相補的 (Strategy G で zoom-out リバウンド排除 + remount で DOM 残留排除)
  - **検証**: `tsc --noEmit` PASS。dev preview で click open → outside click close → 250ms 後 / 650ms 後 (remount timer 完了後) の両時点で `[data-slot="popover-content"]` が DOM から消失することを `preview_eval` で確認、再 click open でも問題なく動作。console error / warning 0 件。dev では DOM 残留が起きないため remount の効果検証は production deploy 後にユーザー側で実機確認予定
- **2.1 (2026-05-07)**: #70 — スケジュール各員コメント popover の close 時に「白枠だけ残る」現象を Strategy G (CSS exit transition 撤去) で根絶
  - **症状**: スケジュールページ TOP のメンバー名行コメントアイコンに hover → コメント popover 表示 → カーソルを popover / トリガーから外側へ移動した際、中身は消えるが `ring-1 ring-foreground/10` + `shadow-md` の輪郭だけが visible に残るフレームが散発的に発生 (`CommentPopover` の 120ms grace period があるため open/close 頻度が高く、特に発火しやすかった)
  - **真因**: TODO #65 (PR [#22](https://github.com/yyamazaki-lym/raid-repository/pull/22), commit `18a338f`) で `dropdown-menu.tsx` に対して同根のバグを「3 段階ちらつき」として既に修正済みだったが、`popover.tsx` / `tooltip.tsx` には同じ Base UI close 時アニメ (`data-closed:animate-out / fade-out-0 / zoom-out-95`) が残存していた。close transition (~100ms) で zoom スケール 95% への縮小と fade-out 透明化のタイミングずれが visual artifact (枠だけ残るフレーム) を生む現象、TODO #65 と完全に同根
  - **修正** (Strategy G の popover/tooltip 版):
    - [src/components/ui/popover.tsx](src/components/ui/popover.tsx): `PopoverContent` の `<PopoverPrimitive.Popup>` className から `data-closed:animate-out` / `data-closed:fade-out-0` / `data-closed:zoom-out-95` の 3 クラスを削除
    - [src/components/ui/tooltip.tsx](src/components/ui/tooltip.tsx): `TooltipContent` の `<TooltipPrimitive.Popup>` className から同 3 クラスを削除 (今回のバグには直接関与しないが、Base UI overlay 三兄弟 dropdown / popover / tooltip で方針統一する予防修正)
  - **副作用受入**: Base UI overlay 全種類で close 時瞬間消滅に統一 (dropdown と一貫性が取れる)。recruitment-templates-button も close 瞬間消滅になるが click open / click outside close の機能上問題なし。`CommentPopover` の hover 制御 (`cancelClose` / `scheduleClose` 120ms grace) のロジック自体は変更なし
  - **再導入禁止リスト追記** (TODO #65 part8 と統合): popover.tsx / tooltip.tsx / dropdown-menu.tsx の `data-closed:animate-out` / `data-closed:fade-out-0` / `data-closed:zoom-out-95` 系列は visual rebound 再発のため再追加禁止。フェードアウト復活したい場合は `duration-50` + `opacity-only` 版 (zoom-out なし) を使う
  - **検証**: `tsc --noEmit` PASS。dev preview (worktree) で `CommentPopover` を `mouseenter` で open → `mouseleave` で close、close 後 250ms で `[data-slot="popover-content"]` ノードが DOM から完全消失することを `preview_eval` で確認。screenshot で popover open / close 後を比較撮影、close 後に白枠が残らないことを目視確認。console error / warning 0 件
- **2.1 (2026-05-07)**: #69 — `schedule_past_sessions` に CANDIDATE 行が混入するバグを修正 (snapshot DECISION-only filter + 既存 CANDIDATE row 自動 cleanup)
  - **真因**: [src/lib/server/schedule-snapshot.ts](src/lib/server/schedule-snapshot.ts) `runScheduleSnapshot()` が `fetchScheduleRaw()` で得た sessions を **status (DECISION/CANDIDATE) を見ずに全件 UPSERT** していた。`mergeStoredPastSessions` ([src/lib/schedule/next-session.ts:185-220](src/lib/schedule/next-session.ts:185)) の「raw_date 照合だけで verified set に入れて `status: \"DECISION\"` 強制」挙動と組み合わさり、CANDIDATE 由来 row が「過去確定日」として表示されていた。`supabase/schema.sql` の `schedule_past_sessions` には status 相当列が無く (`source` のみ)、永続化レイヤで DECISION/CANDIDATE を区別できない設計のため入口 (snapshot) で止める方針
  - **Discord 取り込みは問題なし** — `importDiscordScheduleHistory` は「本日YYYY/MM/DD…は固定活動予定日です」当日通知のみ scrape するため CANDIDATE 混入は構造的に発生しない。問題は snapshot path 単独
  - **修正**:
    - [schedule-snapshot.ts](src/lib/server/schedule-snapshot.ts): `decisionSessions = sessions.filter(s => s.status === \"DECISION\")` で DECISION 行のみ snapshot、`candidateRawDates` に該当する `source='snapshot'` row を delete (次回 snapshot 実行時に自動 cleanup)。`source='discord'` / `'manual'` は touch しない。戻り値に `cleanedCandidates: number` 追加
    - [categories-actions.ts](src/lib/server/categories-actions.ts): `ScheduleSnapshotResult` 型に `cleanedCandidates` 追加、`snapshotScheduleNow` admin gate fallback 戻り値も追従
    - [past-sessions-section.tsx](src/components/portal/settings/past-sessions-section.tsx): snapshot 結果 (toast + 結果パネル) に `候補日 cleanup N` 表示、説明文を「DECISION 行のみ保存 / CANDIDATE 行は自動 cleanup」に書き換え
    - [api/cron/snapshot-schedule/route.ts](src/app/api/cron/snapshot-schedule/route.ts): cron response JSON に `cleanedCandidates` 追加
  - **運用前提**: char-sheets 上で当日 21:50 JST までに DECISION マークされた session のみ snapshot 対象。CANDIDATE のままだと attendance データが永続化されないので「実施前に DECISION マークする」運用ルールでカバー
  - **既存 CANDIDATE row の cleanup**: 次回 snapshot 実行 (cron or settings dialog の「出席状況を即時保存」) で自動削除。手動 SQL 不要
  - **検証**: `tsc --noEmit` PASS。実発火経路 (cron + Supabase + char-sheets) は worktree dev preview で再現不能のため、本番デプロイ後にユーザー側で「snapshot 即時実行 → settings dialog の DB 保存件数で row 一覧を確認 → CANDIDATE 由来 row が消えている」を目視確認予定
- **2.1 (2026-05-02 part10)**: #68 follow-up — 詳細診断 chunk を「details 開時のみマウント」する controlled 構造に強化 (PR #24 の lazy 度を 1 段引き上げ)
  - **狙い**: PR #24 の TODO #68 完了版では `logsResult.diag` 真値時点で `<FflogsDiagnosticsPanel>` が常に mount され、details を開かなくても chunk fetch が発火する設計だった。「details を開いた時に load」を厳密に満たすため、root details を親側に持ってきて `useState diagOpen` で controlled 化、open=true の時だけ panel を mount する形に再構成
  - **実装**:
    - [fflogs-diagnostics-panel.tsx](src/components/portal/settings/fflogs-diagnostics-panel.tsx): root `<details>` + `<summary>` 撤去、内部の `<div>` (詳細診断 body) のみを返す形に変更
    - [fflogs-sync-section.tsx](src/components/portal/settings/fflogs-sync-section.tsx): `useState<boolean>(false)` の `diagOpen` 追加、`<details onToggle={(e) => setDiagOpen(e.currentTarget.open)}>` で wrap、body は `{diagOpen && <FflogsDiagnosticsPanel ... />}` で条件マウント。閉じている間 panel 自体が unmount = chunk も load されない
  - **`<details onToggle>` パターン**: uncontrolled-with-listener 方式で browser native トグル動作を維持しつつ open 状態を React に同期 (controlled `<details open={...}>` だと user click が効かなくなるので avoid)
  - **動作差** (PR #24 比):
    - 連動実行 → details を開かない: PR #24 = chunk fetch / part10 = chunk **fetch されない**
    - 連動実行 → details を開く: PR #24 = 既に fetch 済 / part10 = 開いた瞬間に fetch
    - details 開閉のサイクル: PR #24 = 維持 / part10 = 閉時 unmount (再開で再 mount、chunk は browser cache 経由)
  - **副作用**: 詳細診断 details を閉じる時に内側 nested details (htmlSample / titleDateMissSample / userTypeFields) の open 状態がリセットされる (再度親 details を開いた時、これらは閉じた状態に戻る)。ユーザーが直接見ない状態の話なので UX 等価
  - **検証**: `tsc --noEmit` PASS。dev preview で Settings dialog 開閉 + FFLogs section 主要 UI 全描画 + 連動未実行時に「詳細診断」summary 非表示 + console error 0 件を eval 確認
- **2.1 (2026-05-02 part9)**: #68 `fflogs-sync-section.tsx` 内の詳細診断パネル (~190 行) を `next/dynamic({ ssr: false })` で別 chunk に分離 — クローズ
  - **狙い**: TODO #66 で settings-dialog を 5 つの sub-component に分割した際、最大セクション `fflogs-sync-section.tsx` (962 行) 内の詳細診断パネル (`logsResult.diag` + `userTypeFields` 描画、HTML サンプル / titleDateMissSample / v2OwnersSample 含む ~190 行) が後続最適化として残されていた。FFLogs 連動を実行して結果が「合うレポートなし」になり、かつ詳細診断 details を開いた時にしか見えない稀な UI なので、`next/dynamic({ ssr: false })` で別 chunk 化して true lazy load を実現
  - **実装**: 新規 [src/components/portal/settings/fflogs-diagnostics-panel.tsx](src/components/portal/settings/fflogs-diagnostics-panel.tsx) (203 行) に詳細診断 `<details>` ブロック (内部の HTML サンプル / titleDateMissSample / userTypeFields nested details 含む) を切出し、`FflogsDiagInfo` 型も export。[fflogs-sync-section.tsx](src/components/portal/settings/fflogs-sync-section.tsx) で `dynamic(() => import("./fflogs-diagnostics-panel"), { ssr: false })` でラップし、旧 inline JSX を `<FflogsDiagnosticsPanel diag={...} userTypeFields={...} />` に置換 (962 行 → 802 行、-160 行)
  - **chunk 分離検証**: `.next/dev/static/chunks/0qc1_src_components_portal_settings_fflogs-diagnostics-panel_tsx_*.js` として独立 chunk 生成を確認
  - **Network タブ挙動 (dev preview)**: 初期ページロード時 / Settings dialog open 時は **未 fetch**、「FFLogs と動画を連動」ボタン押下後 (linkFflogsReports → logsResult.diag set → `<FflogsDiagnosticsPanel>` mount) に chunk **fetch される**
  - **UI 動作等価性**: 連動結果として `詳細診断` / `日付抽出に失敗したタイトル` / `User 型のフィールド一覧` などすべての nested details が従前通り render。console error / warning なし。tsc --noEmit PASS
- **2.1 (2026-05-02 part8)**: #65 Film/Logs dropdown スクロール時の 3 段階ちらつきを Strategy G (CSS exit transition 撤去) で根絶 — クローズ
  - **狙い**: PR [#12](https://github.com/yyamazaki-lym/raid-repository/pull/12) (TODO #65 初版) + PR [#13](https://github.com/yyamazaki-lym/raid-repository/pull/13) (capture phase 撤廃 + grace period) でも残った「過去詳細表で dropdown 開 → wheel scroll で 1 度消え → 1 度出 → 最終 close」の 3 段階 re-toggle を解消
  - **真因確定 (PR [#21](https://github.com/yyamazaki-lym/raid-repository/pull/21) debug log で本番観測)**: wheel scroll 時の React state 遷移は `onOpenChange(true) → setOpen(true) → armed → scroll-close fired → cleanup` の **open→close 単一遷移** で完結しており、`IGNORED — locked` も 2 回目の `onOpenChange(true)` も発生していなかった。「現れる」段階は React state 由来ではなく **CSS exit transition のリバウンド** が真因。Base UI Menu が `setOpen(false)` を受けて `data-closed` 属性を付け、`data-closed:animate-out / fade-out-0 / zoom-out-95 / overflow-hidden` の組合せで 100ms かけて消えていく途中で zoom-out のスケール変化が visual rebound を生んでいた
  - **修正 (Strategy G — PR [#22](https://github.com/yyamazaki-lym/raid-repository/pull/22))**: [src/components/ui/dropdown-menu.tsx](src/components/ui/dropdown-menu.tsx) の `DropdownMenuContent` / `DropdownMenuSubContent` の className から `data-closed:animate-out` / `data-closed:overflow-hidden` / `data-closed:fade-out-0` / `data-closed:zoom-out-95` を削除。入場アニメーション (`data-open:animate-in / fade-in-0 / zoom-in-95`) は維持。close 時は瞬間消滅、open 時は従来通り 100ms かけて zoom-in + fade-in
  - **副作用受入**: 全 dropdown で「閉じる時のフェードアウト」が消えて瞬間消滅になる (本来意図せぬ全体仕様変更だが、3 段階ちらつき根絶を優先、本番 UX 判定で許容確認済)
  - **試行履歴 (再導入禁止)**: PR [#19](https://github.com/yyamazaki-lym/raid-repository/pull/19) Strategy A (`disableAnchorTracking`) — 真因と無関係だったが副作用なしで維持 / PR [#20](https://github.com/yyamazaki-lym/raid-repository/pull/20) Strategy B (re-open lock) — debug log 撤去して防御的 guard として維持 / PR [#21](https://github.com/yyamazaki-lym/raid-repository/pull/21) debug log — 真因特定済で撤去
  - **将来妥協案**: フェードアウト復活したい場合は `duration-50` + `opacity-only` 版 (zoom-out なし → リバウンド再発リスク低)、または cubic-bezier で「100 → 0 一直線」のイージング指定で現れフレーム不可避
  - **検証**: `tsc --noEmit` PASS。dev preview は demo data に Film/Logs dropdown が存在せず再現不能 → 本番デプロイ後にユーザー側で過去詳細表 → 動画 dropdown 開 → wheel scroll で 3 段階ちらつき完全消滅 + close 時瞬間消滅 UX 許容を確認 (commit `18a338f`)
- **2.1 (2026-05-02 part7)**: #66 `settings-dialog.tsx` (1,761 行 / 88 KB) を 5 つの sub-component に機能別分割 — クローズ
  - **狙い**: 2026-05-02 の肥大化精査で settings-dialog + schedule-list が src/ 全体の 11.6% を占める件への対応。単一ファイルの編集 / 読解 / レビュー摩擦を解消するため、ロジカルなセクション境界に沿って 5 つの sub-component に分割し、各セクション固有の state を section 内部に閉じ込めて親シェルを薄くする
  - **実装** (新規 [src/components/portal/settings/](src/components/portal/settings/)): `schedule-source-section.tsx` (103 行) / `past-sessions-section.tsx` (352 行) / `fflogs-sync-section.tsx` (962 行 — 最大) / `changelog-footer.tsx` (232 行) / `danger-zone-section.tsx` (58 行)
  - **親シェル**: [settings-dialog.tsx](src/components/portal/settings-dialog.tsx) を 1,761 → **208 行** (-88%) に縮小。保持 state は `open` (Dialog 制御) + `url / channelId / busy` (フッター保存ボタンが両方更新するため共通) のみ。OAuth callback handler (`?fflogs_oauth_connected` 検出 → setOpen(true)) は dialog 制御 state を握る親に残す
  - **state 分散**: 旧 1 つの useEffect [open] で 5 件 Promise.all していた初期 fetch を「親 = url + channelId」「FflogsSyncSection = OAuth + cookie + username」の 2 つに分割 (並列性は維持)
  - **動作影響**: UI 出力は等価。サブコンポーネント分割自体は client bundle 合計サイズを変えない (本 TODO のメイン狙いはファイル肥大化解消 + 認知負荷削減であり、初期 bundle 削減は TODO #67 で実現済)
  - **検証**: `tsc --noEmit` PASS。dev preview で Settings dialog を開き、4 section header 描画 + 全 10+ ボタン / 5 リンク表示 + 更新履歴 archive lazy load (1 件 → 10 件) + Danger Zone confirm dialog 開閉、を eval 経由で確認。console errors / warnings なし
  - **今後の拡張余地**: fflogs-sync-section の詳細診断パネル (logsResult.diag、HTML サンプル含む ~150 行) を `next/dynamic` で別 chunk 化すれば true lazy load 可能。本 TODO スコープ外として別途検討
- **2.1 (2026-05-02 part6)**: #67 `changelog.ts` (629 行 / 234 KB) を最新 1 件のみに削減 + 過去 9 リリースを `src/lib/changelog-archive.ts` に分離 + dynamic import 化 — クローズ
  - **狙い**: 2026-05-02 のプロジェクト肥大化精査で `changelog.ts` が git tracked size リポ全体 2 位 (`package-lock.json` 378 KB 次点)、しかも `settings-dialog` から全件 import されて初期 client bundle に常時混入していた。「使う時だけ load」する dynamic import 化で初期 bundle 縮小
  - **実装**: 新規 [src/lib/changelog-archive.ts](src/lib/changelog-archive.ts) (RELEASES_ARCHIVE export) / [src/lib/changelog.ts](src/lib/changelog.ts) は最新 1 件 (`2.1 (2026-05-02)`) のみ残置 (234 KB → 19.6 KB) / [settings-dialog.tsx](src/components/portal/settings-dialog.tsx) に `archiveReleases / loadingArchive / archiveError` state 追加 + 「↓ 過去の更新履歴を見る」ボタンで `import("@/lib/changelog-archive")` 発火、`displayReleases = [...RELEASES, ...archiveReleases]` を map
  - **graduation 運用**: 今後リリースを追加する時は `RELEASES[0]` を新エントリで置き換え、旧 `RELEASES[0]` を `RELEASES_ARCHIVE[0]` に prepend する (本体ヘッダーコメントに方針記載済)
  - **検証**: `tsc --noEmit` PASS、dev preview で初期 1 件表示 → archive ボタン押下後 10 件結合表示 + ボタン消滅 + console エラーなしを eval 確認
  - **副次変更**: 「↗ これより前の履歴を GitHub で見る」リンクの文言を「↗ commit log を GitHub で見る」に変更 (archive で全更新履歴が見られるようになったため、GitHub link は commit 単位参照に位置付け直し)
- **2.1 (2026-05-02 part5)**: #64 schedule_past_sessions の logs_url を子テーブル `schedule_past_session_logs` に分離 (1:N 化) — クローズ (PR [#11](https://github.com/yyamazaki-lym/raid-repository/pull/11) squash merge `b15e029`、本番 Supabase は MCP `apply_migration` で同日反映)
  - **狙い**: 同 session 日付に対する FFLogs report が複数発生するケース (午前/午後分けた、ロビー失敗等) を素直に扱えるようにする。旧来は `schedule_past_sessions.logs_url` 単数列で 1 URL しか持てず popover が **上書き編集** だった
  - **schema 変更**: 新表 `schedule_past_session_logs` (id/raw_date/url/source/created_at + UNIQUE(raw_date,url) + ON DELETE CASCADE)。旧 `logs_url` / `logs_url_source` 列は info_schema ガード付き seed → DROP。RLS / REPLICA IDENTITY FULL / supabase_realtime publication にも追加
  - **server**: `fetchSessionLogsByDate()` 戻り値を `Record<string, SessionLogEntry[]>` に型変更、`linkReportsToSessions` の auto-link は新表 INSERT (source=auto) に置換、wipe も新表 delete に。1.9.11 bootstrap の sessions ブランチは撤去 (column 自体が無くなるため)。`category_links.logs_url` / `logs_url_source` は動画用なので残置
  - **action 再編**: `setSessionLogsUrl` 撤廃 → `addSessionLogsUrl` (URL バリデート + 親 row upsert + 子 INSERT、UNIQUE 衝突は friendlier reason に変換) / `deleteSessionLogsUrl` (子 PK 単発削除、auto/manual 両方削除可) の 2 関数に分割
  - **popover UI**: 簡素版に書換 — 既存エントリは行ごとに `URL + sourceバッジ + 開く + ×` で表示、末尾 input + 追加 ボタンで append-only。in-place edit は廃止
  - **consumer 追従**: `schedule-list` / `schedule-past-simple` / `schedule-page-body` の `sessionLogsByDate` 型を配列形に。`SessionActionIcons` の Logs dropdown 候補集約は (動画 logsUrl ∪ sessionLogs) を URL dedup する形に書換、auto/manual はラベルで区別
  - **admin-actions**: `initializeAllDataAction` の `DataInitCounts` / steps[] に新表を **親より前** に追加 (FK CASCADE 任せでも消えるが件数別表示用)
  - **共有型**: `src/lib/schedule/session-logs.ts` に `SessionLogEntry` / `SessionLogSource` を切出し (server-only な fflogs.ts と client な popover の両方から import 可能にする)
  - **デプロイ手順 (案 B)**: PR merge → Vercel main デプロイ完了 → MCP `apply_migration` で本番 Supabase にスキーマ反映、という順序。デプロイ完了直後の数十秒だけ「新コード × 旧スキーマ」窓があり `fetchSessionLogsByDate` が空 fallback を返すが、Logs アイコン非表示で凌げる設計
  - **検証**: `tsc --noEmit` PASS。MCP `execute_sql` で本番スキーマ反映後に `schedule_past_session_logs.count=9` (旧 logs_url から自動移行) / `legacy_cols_remaining=0` / `RLS policies=4` / `replica_identity=full` を確認
  - **migration SQL アーカイブ**: `.claude/todos/64-migration.sql` に MCP に投入した本番マイグレーション SQL 全文を保存 (再現性確保)
- **2.1 (2026-05-02 part4)**: #1 schedule の動画/Logs アイコンを同日複数件で DropdownMenu 化 — クローズ (PR [#10](https://github.com/yyamazaki-lym/raid-repository/pull/10) squash merge `4953323`)
  - **狙い**: 同日複数の動画 / FFLogs report が紐付いたとき、旧 UI の `bucket?.shift()` で 1 件目しか描画されない問題を解消
  - **実装**: [session-video-link.ts](src/lib/server/session-video-link.ts) `buildSessionVideoLinkMap()` の戻り値を `Record<string, SessionVideoLink[]>` に配列化、[schedule-list.tsx](src/components/portal/schedule-list.tsx) の `SessionActionIcons` で `0 件 → spacer` / `1 件 → 直行 link` / `2+ 件 → DropdownMenu (件数バッジ付き)` の 3 経路に分岐。Logs 候補は (A) 各動画 `logsUrl` + (B) `sessionLogsUrl` を URL dedup
  - **マージ過程**: `claude/loving-mirzakhani-8bc971` を main (5/02 part1-3 進行) と merge した際 schedule-list.tsx / changelog.ts / HANDOFF.md で 3 ファイル衝突 → `EMPTY_VIDEO_LINKS` (TODO #1) と `ATT_TONE_FALLBACK` (TODO #60) を統合する形で解消、`ATT_TONE` 型は `Record<string, string>` を採用
  - **検証**: tsc PASS + worktree 本番 next build PASS + 本番デモ環境 (5/30 → 5/02 訂正後の 3/28 行で 2 件) で dropdown が両 item 表示 + クリック動作することを実確認
- **2.1 (2026-05-02 part3)**: #55 スケジュールページ軽量化 — Vercel Data Cache を `updateTag` 即時無効化方式で復活 — クローズ
  - **狙い**: TODO #61 で `cache: "no-store"` 固定にしたため Speed Insights `/` route FCP が 2.86s に悪化していた点を解消
  - **真因**: `no-store` で character-sheets HTML scrape が毎回 1〜3s。Vercel Data Cache を使えれば cache hit 時はほぼ瞬時だが、TODO #61 の `revalidatePath("/")` が fetch cache key を外せない問題で stale 化リスクがあった
  - **修正**:
    - [next-session.ts](src/lib/schedule/next-session.ts): fetch options を `next: { revalidate: 60, tags: [SCHEDULE_CACHE_TAG] }` に変更、`SCHEDULE_CACHE_TAG = "schedule"` を新 export
    - 新規 [schedule-cache-actions.ts](src/lib/server/schedule-cache-actions.ts) (`"use server"`): `invalidateScheduleCache()` で Next.js 16 の `updateTag(SCHEDULE_CACHE_TAG)` 呼出 (read-your-own-writes セマンティクス)
    - [schedule-edit-frame-dialog.tsx](src/components/portal/schedule-edit-frame-dialog.tsx): onOpenChange close ハンドラで `invalidateScheduleCache().then(() => router.refresh())` 呼出。portal 経由の編集はキャッシュ即時無効化 + RSC 再 fetch
  - **TODO #61 との整合**: `updateTag` は tag-based で cache key 単位に直接効くため stale 問題は再発しない。HANDOFF にも明記済の future option を採用
  - **lag 設計**: TTL 60s なので外部編集 (portal を介さず character-sheets を直接編集) は最大 1 分遅延、portal iframe 経由はほぼ即時
  - **副次変更**: 設定タブの更新履歴 UI を簡略化 — 各 part の `<details>` 折りたたみ + body 撤去、title 1 行のフラット箇条書きに変更 ([settings-dialog.tsx:1610](src/components/portal/settings-dialog.tsx))。release 単位の折りたたみと最新 1 件 default open は維持
  - **検証**: `tsc --noEmit` PASS、dev preview で page render + console エラーなし + 更新履歴 1 行表示を確認
- **2.1 (2026-05-02 part2)**: #62 schedule 凡例を character-sheets `/schedule/edit` の「日程オプション」から動的生成 — クローズ
  - **狙い**: `/schedule/edit` の `<input id="choiceValues" value="全昼夜">` で管理者が登録した記号マスターを portal 凡例 + セル描画に反映 (TODO #60 で許容したカスタムラベルが「色は付くが凡例で説明されない」状態の解消)
  - **真因**: portal の凡例情報源が `/schedule/list` HTML だけで、マスターが書かれている `/schedule/edit` を一切 fetch していなかった (list 側にはマスターも凡例ブロックも無い)
  - **実装**:
    - [src/lib/schedule/parse.ts](src/lib/schedule/parse.ts): `ScheduleAttendanceOptions` 型 (`choices: string[]` + `source: "edit-page" | "fallback-from-list" | "unavailable"`) を新設、`ParsedSchedule.attendanceOptions` 必須化。`parseAttendanceChoicesFromEditHtml(editHtml)` で `id="choiceValues"` の value を codepoint 単位 split (× / ー は除外)、`resolveAttendanceOptions()` で edit 失敗時は sessions の出欠集合から fallback、両方失敗で `unavailable`
    - [src/lib/schedule/next-session.ts](src/lib/schedule/next-session.ts): `deriveEditUrl()` で list URL から `/schedule/edit?key=...` を派生、`fetchScheduleRaw()` で list と edit を `Promise.all([fetchHtmlOrNull(list), fetchHtmlOrNull(edit)])` で並列 fetch (edit は null 許容、`cache: "no-store"` 維持)
    - [src/components/portal/schedule-list.tsx](src/components/portal/schedule-list.tsx): `ATT_LEGEND` ハードコード撤去 → `buildAttendanceLegend(choices)` 関数で動的生成 (choices 先頭 + `×` `－` 末尾固定、空なら従来 5 種にフォールバック)。`ATT_LABEL_DICT` に portal 側ラベル辞書 (`◯→参加可` 系 5 種 + `全→全日参加可` `昼→昼参加可` `夜→夜参加可` `早→早朝参加可`)、辞書外は記号のみ表示。`ATT_TONE` に 全/昼/夜/早 を amber fallback トーンで明示マッピング、辞書外も同 fallback
  - **ラベル方針**: マッピング外は説明なし (記号のみ凡例表示) — ユーザー要望
  - **表示順**: edit choiceValues の文字順 → 末尾固定 `×` `ー`
  - **Cache 戦略**: list と同じく `cache: "no-store"` で fresh fetch (TTFB +1〜3s 増、TODO #61 と整合)
  - **検証**: `tsc --noEmit` PASS。デモ `/schedule/edit` を curl で取得し parser ロジックを Node 単体実行 → `choiceValues="全昼夜"` から `choices=[全,昼,夜]` 抽出 + 凡例 5 件 (`全→全日参加可 / 昼→昼参加可 / 夜→夜参加可 / ×→不可 / －→未回答`) 構築を実証。portal 上 (本番固定 = 標準 5 種) で従来表示と同等の凡例 + regression なしを画面 screenshot で確認
- **2.1 (2026-05-02)**: #61 DECISION 行 CANDIDATE 描画 + ルール popover「日程状況一覧」混入 — クローズ
  - **真因 (1) Vercel Data Cache stale**: `fetch({ next: { revalidate: 1800 } })` で 30 分 TTL の Data Cache が character-sheets の DECISION 更新を反映できず古い CANDIDATE 一色 HTML が居座り続ける。`revalidatePath("/")` の mutate trigger でも fetch cache key 単位では invalidate されないケースが Edge + Next.js 16 の組み合わせで再現。再 deploy しても Data Cache は別ストレージに persist されるため消えない (TODO #61 起票時の「fresh deploy 後も再現」も同根)
  - **真因 (2) parseTopText の regex 漏れ**: `parseTopText()` の block re が `<table>` 直前の `<p|pre|blockquote|h2|h3|h4>` を拾うヒューリスティック。character-sheets が table 直前に「日程状況一覧」というラベル見出しを出していると `■コメント` 切り捨てより前に混入
  - **切り分け**: temp `[parse-debug]` log で 5/02 の statusRaw=`CANDIDATE` (length=9, 完全一致) を観測 → regex は問題なし、HTML 自体が違う (c) で確定。`cache: "no-store"` 切替で `decisionCount: 0 → 3` に変化 + ブラウザ確認で 5/02・5/17・5/30 全件確定 chip 描画 → c-1 (Cache stale) 確定
  - **修正**:
    - [src/lib/schedule/next-session.ts](src/lib/schedule/next-session.ts) `fetchScheduleRaw()` の fetch を `cache: "no-store"` に固定。毎リクエスト fresh fetch (TTFB +1〜3s) を許容して stale 問題を根絶 (single-tenant 低トラフィック portal なので運用許容範囲)
    - [src/lib/schedule/parse.ts](src/lib/schedule/parse.ts) `CHARSHEETS_LABEL_NOISE` Set 新設 (現状「日程状況一覧」のみ)、`parseTopText` の block ループ内で完全一致時のみ skip
  - **TTFB トレードオフ**: TODO #55 の cache TTL 延長 (10→30 分) と相反するが stale で機能しないより fresh 優先。将来 `revalidateTag` ベースで iframe edit 完了時 / admin mutate 時に明示 invalidate する形に戻す余地は残す
  - **検証**: tsc PASS。Claude in Chrome で demo を直接確認、5/02・5/17・5/30 全件確定 chip + 次回開催 = 2026/05/02 確定 + ルール popover に「日程状況一覧」非表示を確認 (commit 直前)
- **2.1 (2026-05-01)**: #60 schedule 出欠記号にカスタムラベル (昼/夜/全 等) を許容 — クローズ
  - **真因**: `parse.ts` の `Attendance` 型 union が `◯ / ⏰ / △ / × / －` の 5 種固定で、`isAttendance()` がそれ以外を全 reject していた。character-sheets 側で運用カスタムとして「昼 / 夜 / 全」のような任意ラベルが入っても portal 上で `―` フォールバックに上書きされる挙動だった
  - **修正**:
    - [src/lib/schedule/parse.ts](src/lib/schedule/parse.ts): `Attendance` 型を string union から `string` に拡張、`isAttendance()` を「空文字以外なら通す」に縮小
    - [src/components/portal/schedule-list.tsx](src/components/portal/schedule-list.tsx): `ATT_TONE` を `Record<string, string>` 化 + `ATT_TONE_FALLBACK` (amber) 新設、`ATT_TONE[att] ?? ATT_TONE_FALLBACK` で安全 lookup
    - 副次: parseSessions push の status を bucket 済 (DECISION/CANDIDATE) に統一、空 value="" 行が status="" になる経路を除去 (defensive)
  - **検証**: tsc PASS + デプロイ後 (dpl 2abda84bd01f) demo サイトで 夜=18 / 昼=6 / 全=11 件が amber トーンで描画されることを確認 (commit 2abda84)
  - **残課題**: 確定/次回開催 反映が「再デプロイ + Data Cache クリア後も改善されない」問題が残存。当初は cache stale 仮説だったが新 deploy でも全 31 行 `·` (CANDIDATE)、`>確定<` は列ヘッダーの 1 件のみ → 別 TODO #61 として起票 (下記)
- **2.1 (2026-05-01)**: #59 デモサイトでスケジュールメンバー取得が動作しない不具合修正 — クローズ
  - **真因**: `parse.ts` の `RAW_DATE_RE` が `HH:MM~HH:MM` の時間レンジを必須にしていたが、character-sheets では時間未入力のまま運用するスケジュールが存在し (本番でも想定される)、その場合 datetitle は `2026/05/01(金)` のように日付+曜日のみ。`parseRawDate()` が全行で null → `parseSessions()` 全 skip → sessions=0 → メンバー描画不能、という silent skip パスに落ちていた。throw されないため Runtime Logs にも痕跡なし、(d) 派生
  - **切り分け方法**: 当該 character-sheets URL を curl で取得 (HTTP 200, 66KB, 31 行 + 4 ユーザー、構造正常) → parse.ts 同等ロジックを node mjs で再現 → `rawDateOk: 0` で `RAW_DATE_RE` 不一致を特定。datetitle 31 件すべて時間部分なしと確認
  - **修正**:
    - [src/lib/schedule/parse.ts](src/lib/schedule/parse.ts): `RAW_DATE_RE` の時間レンジ部分を `(?: ... )?` で optional 化、`parseRawDate()` で時間未入力時は `startTime`/`endTime` に空文字、Date は JST 当日 00:00 をフォールバック
    - [src/components/portal/schedule-list.tsx:650](src/components/portal/schedule-list.tsx) / [src/components/portal/next-session-card.tsx:74](src/components/portal/next-session-card.tsx): 両方空のとき時間レンジ span 自体を render skip (「 ~ 」だけが残る不格好な表示を回避)
  - **検証**: tsc PASS + 同 curl → 修正後再現スクリプトで sessions=31 件正常抽出を確認。本番動作確認は次回会話で実施
  - **DB 影響**: `schedule_past_sessions.start_time/end_time` は `text NOT NULL` なので空文字 (NOT NULL を満たす) で互換、schema 変更不要
- **2.1 (2026-05-01)**: #8 Vercel/Supabase 自動導入 + モックサイト — クローズ (part A〜E 完了 + デプロイ実施)
  - **part A〜D (commit 51f8142 / abaec6d / 1f389be)**: `.env.local.example` に FFLogs v2 OAuth + `NEXT_PUBLIC_SCHEDULE_URL` 追記、schema.sql に Section 11 サンプルカテゴリ 5 件 seed、README に Vercel Deploy Button 追加
  - **part C-ii (commit e494347)**: schema.sql Section 12 を新設、Section 11 のサンプル 5 カテゴリに紐付ける demo data bulk seed (category_links 37 / loot_items 18 + entries ~36 / mitigation_phases 20 + entries ~60 / strategy_docs 5 / category_macros 10 / recruitment_templates 5 / tags 11 / past_sessions 18 + memos 8 / app_settings 2)。`DO $$ BEGIN ... END $$` block + sentinel `app_settings.demo_seed_applied=1` で冪等
  - **part E (commit e494347)**: `PUBLIC_DEMO_MODE=true` フラグ追加。proxy.ts に `isPublicDemoModeEnabled()` 追加 (NODE_ENV ガード無し → 本番でも有効、dev bypass の後段配置)、auth.ts に `publicDemoModeUser()` 追加 (roles=[] 固定で書き込みは admin gate + RLS で 4 層防御)。`.env.local.example` に PUBLIC_DEMO_MODE セクション追記
  - **schema fix (commit 429700e)**: 副次発見の長期 bug 修正 — `ALTER TABLE public.category_links` / `schedule_past_sessions` の logs_url_source 関連 ALTER が CREATE TABLE より前に配置されており、新規 fork 時に `ERROR: 42P01: relation does not exist` で失敗していた。各 CREATE TABLE 直後に移動
  - **デプロイ実施 (commit 4b9ff27 / dbbdda5)**: モックサイト用 Vercel + Supabase 別インスタンスをデプロイ → https://demo-raid-repository.vercel.app/ 稼働。Vercel deploy phase の transient 障害 (`Deploying outputs...` で 4 連続 fail) を空 commit push で回避。動作確認: HTTP 200 + demo data 表示 + `/login` リダイレクト無し (PUBLIC_DEMO_MODE bypass OK)。README に Live demo セクション追記
  - **データ修正 (commit 94a9ce5)**: 旧 `arc-heavy/cruiser/lightheavy` (name `アルカディア:〜`) と新 `arcadion-heavy` (name `至天の座アルカディア：ヘビー級`) の重複解消 → arcadion-* に統合 (cruiser/lightheavy 新規追加)。Section 9 の INSERT を migration DELETE に置換 (旧 seed name のみ削除する安全弁つき)。Section 13 を新設してユーザー指定の追加コンテンツ 6 件 (3 動画 + 3 攻略、URL ベース NOT EXISTS guard) を投入
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
