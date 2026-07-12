# Raid Repository — 引き継ぎノート

> 2.9 (2026-07-12) 時点。完了済 TODO の詳細は `src/lib/changelog.ts` / 過去版番号は `.claude/done.md`。
>
> **新規会話の手順**: このファイルを読んだ後、TODO 一覧は自動表示せずユーザーの要望を待つ。新規 TODO 追記時は part 単位ではなく TODO 完了時のみ統合追記する (part 細分は commit log に任せる)。

## プロジェクト概要

**Raid Repository** — FFXIV レイド固定向け portal (Next.js 16 + Supabase, single-tenant)

- **Repo**: https://github.com/yyamazaki-lym/raid-repository
- **Path**: `D:\workd\raid-repository`
- **Stack**: Next.js 16.2.9 (Turbopack) / React 19.2 / Supabase / Tailwind v4 / @base-ui/react
- **Deploy**: Vercel auto-deploy from `main`
- **Version**: `2.9 (2026-06-15)`。`package.json#version` は `1.9.38` のまま (履歴マーカー)、UI は `RELEASES[0].version + .date` を表示
- **Next.js 16 注意**: 破壊的変更含む。`node_modules/next/dist/docs/` を参照すること (詳細は `AGENTS.md`)

## 🔄 保留オペレーション

**TODO #2 close 後の本番運用観察 + Vercel deploy 障害復旧** (2026-05-08):

1. ⏳ Discord 通知 ON/OFF トグル **現在 OFF**、手動 Bell button で初期検証中。問題なければ ON に戻す。**24h 観察 (項目 2-iv) 期間中も OFF 維持**: ユーザー判断 (2026-05-08) で「Discord 投稿到達確認は 24h 観察と切離し、ON 切替は別タイミング」。24h 観察の検収条件は `cron.job_run_details` に毎時発火 24 行が `status='succeeded'` で並ぶことのみ
2. ✅ **完了 (2026-06-10 観察結果確定)** 候補 B 本対応 ([PR #71](https://github.com/yyamazaki-lym/raid-repository/pull/71) — 案 D: Supabase pg_cron): Vercel Hobby cron sub-daily 制約 (PR #69 で daily 暫定 revert 済) を回避するため、毎時 trigger を Supabase pg_cron + pg_net に移管。当初検討した案 C (GitHub Actions hourly cron) は通常 5–15 min 遅延・ピーク 1h+ で精度不足のため却下、pg_cron は DB 内 scheduler で秒単位精度。**Supabase Dashboard 手動操作が必要だった経路**:
   1. ✅ **完了**: SQL Editor で `SELECT vault.create_secret('<Vercel Env の CRON_SECRET と同値>', 'cron_notify_native_schedule_bearer');` を 1 回実行 (vault `secret_len=48` 確認済)
   2. ✅ **完了**: SQL Editor で `supabase/schema.sql` の追記された **13 章「Hourly cron for native schedule Discord notify」** (extensions + DO block + cron.schedule) を実行
   3. ✅ **完了 (2026-05-08)**: `SELECT * FROM cron.job WHERE jobname = 'notify-native-schedule-hourly';` で `jobid=1 / schedule='0 * * * *' / active=true` 確認、手動 trigger 200 OK 確認済
   4. ✅ **完了 (2026-06-10 確認)**: jobname='notify-native-schedule-hourly' 全 jobid 跨ぎ集計で **累計 786 succeeded / 0 failed** (2026-05-08 06:00 UTC 〜 2026-06-09 23:00 UTC、期待値 24 × 33 ≈ 792 に対し ~99% カバレッジ)。観察 24h ウィンドウ (2026-05-08 06:00〜2026-05-09 06:00 UTC) 内も jobid={1,4,5,6} の 4 jobid 跨ぎで **24 succeeded / 0 failed** で検収条件 (23–25 succeeded / 0 failed) 満たす。現行 `jobid=15 / active=true` で直近 24h も連続 succeeded、健全運転中
      - **⚠ 観察 SQL 注意 (将来の確認時)**: `supabase/schema.sql` 13 章の `cron.unschedule` + `cron.schedule` パターンが **schema 再 deploy 毎に新規 jobid を採番** する (jobid=1 → 4 → 5 → 6 → 7 → 8 → 9 → 11 → 12 → 13 → 14 → 15 と 1 ヶ月で 12 回切替)。初回 plan の固定 `jobid=1` 観察は 2 件しか拾えなかった (再 deploy で jobid が変わるため)。今後の観察は `jobname` 単位 (`SELECT ... FROM cron.job_run_details jrd JOIN ... ON jobname = ...` または `WHERE start_time >= '<起点>'` で jobid 跨ぎ累計) で集計する。再 deploy 切替窓 (unschedule → schedule 間の数秒) で 1〜2 hour 単位の発火欠落が累計 6 hour 程度発生したが、failed ではなく未発火扱いで運用影響なし

**FFLogs cron scrape の Edge proxy 化後の初回観察** (2026-06-11、PR #182):

3. ✅ **完了 (2026-06-12 DB 実測確認)** cron (/api/cron/fflogs-sync) の Edge proxy 経由 scrape の初回発火を確認 — 2026-06-11 19:58 UTC (= JST 04:58。Vercel Hobby の cron は指定時刻から 1h 以内に発火する仕様で、19:00 指定に対し +58 分は正常) に auto 紐づけが再生成された (`schedule_past_session_logs` source='auto' 10 件 + `native_schedule_session_logs` source='auto' 1 件、created_at が同時刻で揃う)。直近セッションへの紐づけには Private/Unlisted レポート (scrape でしか取得不可、v2 API の公開レポートは 2017-2022 の stale 12 件のみ) が必要なため、Edge proxy 経由 cron scrape の end-to-end 成功の実証になる。TODO #86 の「UTC 19:00 自動発火確認」もこれで完了

(項目 1 (Discord 通知 ON 切替) 完了でこの節を `_(現在なし)_` に戻す)

**Pre-check 結果サマリ (2026-05-08 14:25 JST 実行)** [historical]:
- `cron.job`: jobid=1, jobname='notify-native-schedule-hourly', schedule='0 * * * *', active=true
- `app_settings`: enabled='false' / channel_id='924575227306975232' / role_id='1497960832284360706' / hour 未 seed (route 側 default=12)
- `vault.decrypted_secrets`: cron_notify_native_schedule_bearer 登録済 (secret_len=48)
- `cron.job_run_details`: 0 行 (自動発火未到来)

## 📌 次回の作業優先度

未完了 TODO は **#11 (パフォーマンス、休眠中 = 新ボトルネック発見時のみ再開) のみ**。TODO #86 の 24h 観察 (UTC 19:00 自動発火確認) は 2026-06-12 に DB 実測で完了 (保留オペレーション項目 3 参照)。**非 admin メンバーの実機確認 2 件 (出欠「未回答に戻す」 #189 / 日付メモ CRUD #213 A-4) は 2026-06-15 ユーザー実機確認 OK で検収完了** (詳細は下記「完了済み TODO」2.9 (2026-06-15))。残作業は:
1. 保留オペレーション項目 1 (Discord 通知 ON 切替、ユーザー判断)
2. **総合レビューレポート (`docs/code-review-2026-06-13.md`) の P2/P3 を消化完了 — 残課題なし** (P0+P1+P2 主要に続き、残 P2/P3 を 2026-06-15 に実装。下記「完了済み TODO」2.9 (2026-06-15) 参照)。完了: C-4 Realtime 集約 (#219) / F-1 生 Tailwind 色 (#220) / B-3 login 軽量化 (#221) / C-5 ファイル分割 (maintenance-menu #222 / schedule-list 1943→1155 #224 / session-memo-popover 967→782 #225)。**見送り確定 (ユーザー判断 2026-06-15)**: ① B-3 の ISR — mitigation/loot は per-user 認証=canEdit + cookie 読みで Next が動的化し ISR 不可 (cold start は #181 済) ② C-5 の残り 2 ファイル (category-form-dialog 1185 行 / fflogs-sync-section 879 行) — 本体が単一の巨大 state マシン (25 / 13 useState) で安全分割不可
3. **✅ F-4 ONLINE ドットに意味付け (presence) — 完了 ([#228](https://github.com/yyamazaki-lym/raid-repository/pull/228))**: 常時装飾だった ONLINE 表示を Supabase Realtime Presence で「オンライン中のメンバー数」表示に変更 (新 `src/lib/use-online-presence.ts` / `src/components/portal/online-presence-indicator.tsx`、presence key = Discord ID で複数タブ=1カウント、DB/RLS 変更なし)。dev preview + **実機で self=1 (オンライン 1 人) 表示をユーザー確認 OK (2026-06-15)**。複数人時の増分は実メンバーが集まった際に目視。
4. **✅ Discord 取り込み除外 (blocklist) — 実装完了 ([#232](https://github.com/yyamazaki-lym/raid-repository/pull/232))**: 特定の動画/攻略 URL を「今後取り込まない」除外する機能 (ユーザー要望 2026-06-15)。削除しても dedup は URL 在不在しか見ず cron で復活する問題への対処。新テーブル `category_discord_blocklist` (admin-only RLS、汎用ループ外の独立章) + 取り込み skip (service role 読取) + ⋮ メニュー「今後取り込まない」(source='discord' 限定) + 編集ダイアログの「取り込み除外 URL」管理 (lazy fetch + 解除)。schema は本番/demo 自動デプロイ成功、本番で **admin policy 3 種 (select/insert/delete) + UNIQUE + RLS 有効** を SQL 実査済。**実 admin での除外操作は 2026-06-15 ユーザー実機確認 OK** (除外 → 消える + 以後取り込まれないことを確認済)。import skip 読取は service role で RLS 非依存。

**→ 実質の残作業は項目 1 (Discord 通知 ON 切替、ユーザー判断) のみ。** 総合レビュー (P0/P1/P2/P3) は実施対象を全消化、追加機能 (presence / blocklist) も実機検収完了 (見送り確定分を除く)。

5. **✅ 全体再監査 (2026-06-19) — 確定 20 件を全修正・実機検収済 (#242–#248)**: 13 領域マルチエージェント監査で P0/P1 ゼロを再確認し、確定した P2 2 件 (SSRF #242 / FFLogs wipe #243) + P3 18 件 (#244–#248) を 7 PR で全修正・merge (changelog 据え置き = #245 のユーザー可視分も載せない確定)。dev preview 再現不可だった実機確認 5 点 (出欠コメント保存 / 未来日確定の「本日」非表示 / 無効タブ直URL 404 / reduced-motion / 画像孤児掃除) は **2026-06-19 ユーザー実機確認 OK で検収完了**。詳細は下記「完了済み TODO」2.9 (2026-06-15) の 2026-06-19 エントリ。

## 未完了 TODO 一覧

ページ / 領域ごとに分類。番号は履歴上の通番なので連続しないが、`changelog.ts` の参照キーとしてそのまま維持する。

### 🗓 スケジュールページ (`/` = top)

| # | 項目 | 規模 |
|---|---|---|
| _(現在なし)_ | — | — |

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

- **2026-07-12 (2): 日付登録 Logs ↔ 同日動画の橋渡し** — ユーザー報告「日付から登録した Logs が同日の動画と紐づいていない」(観測面 = 動画ページのバッジ)。原因は **保存先 2 系統の構造ギャップ**: 手動の日付登録 (`addSessionLogsUrl` 系) は `schedule_past_session_logs` にのみ書き、動画カードのバッジが参照する `category_links.logs_url` を更新しない (auto 同期だけが両方に書く非対称。#259 のリグレッションではないと差分検証で確定)。修正:
  - **書込時橋渡し**: 日付登録時に同日 (JST) の `logs_url IS NULL` 動画へ `logs_url` + `source='manual'` を設定 (既存リンクは上書きしない)。**削除対称 (ユーザー決定)**: manual 行の削除時、同日動画の `logs_url == URL AND source='manual'` をクリア。sync/native 4 アクション対応、toast に件数表示
  - **同日判定の共有化**: `resolveVideoJstYmd` 等を新規 `src/lib/video-jst-date.ts` に抽出し、TOP の `buildSessionVideoLinkMap` と橋渡し (`src/lib/server/session-logs-video-bridge.ts`) で完全同一ロジックに (タイトル日付優先 → posted_at JST fallback)
  - **cron 第4ステップ**: fflogs-sync の 3 リンカー後に manual logs → 同日 NULL 動画のバックフィルを追加 (Discord 取込で動画が翌日入るケース + 既存登録分を毎晩自己修復。時間予算 deadline 尊重・冪等・auto wipe 非干渉)。結果パネル/cron JSON に `manualLogsBridged` 追加
  - schema.sql / RLS / publication 変更ゼロ。**[PR #260](https://github.com/yyamazaki-lym/raid-repository/pull/260) squash merge `a89d9d5`**
  - **✅ 2026-07-12 ユーザー実機検収 OK (3 点全て)**: ① 日付登録 → videos ページに realtime でバッジ即出現 ② 削除でバッジ解除 ③ 手動 sync で「**日付登録 Logs から動画 3 件に補完**」を確認 = cron 第4ステップ (バックフィル) の実データ動作を実証。橋渡し機能はエンドツーエンドで検収完了
- **2026-07-12: 全体監査 (動作性/安定性/堅牢性) + TOP 高速化 + DB 最適化** — ユーザー要望「全体を精査、特に TOP が重い、DB 最適化も」を受けた 3 領域並列精査 → 確定約 20 件をバッチ 4 コミットで実装 (ブランチ `claude/site-performance-stability-audit-fcobyi`)。**レポート全文 = `docs/audit-2026-07-12.md`**。TODO #11 (パフォーマンス) の新ボトルネック発見に相当。骨子:
  - **TOP レイテンシ (A)**: 外部 fetch timeout 8s / app_settings 6 キーを 1 SELECT に統合 (`fetchPortalSettings`) / native placeholder 書込を cron 移設 (描画パスは空月フォールバックのみ) / **過去履歴を直近 12 ヶ月に窓化 (ユーザー決定、データは削除しない)**
  - **DB (B)**: `category_links(kind, posted_at)` index / Realtime publication を実購読 6 テーブルへ縮小 + 非購読 13 を REPLICA IDENTITY DEFAULT 化 / RLS `auth.jwt()` の initPlan 化 (全 write + self-row + storage) / 冗長 index 4 本削除 / memos・native comment/note の長さ CHECK / backgrounds DELETE policy + カテゴリ削除時 Storage 掃除 / 練習時間集計の RPC 化。**fix: seed-demo.sql が DROP 済み legacy 列へ INSERT しており再適用が必ず失敗する潜在バグを修正** (ローカル PG16 で 2 回適用 + pg_* 実査済)
  - **バンドル (C)**: @dnd-kit を popover 中身ごと lazy 化 (トリガー静的維持) / native 系 8 コンポーネント + memo-popover (828 行) を ssr:true dynamic 分離 (sync モードから ~1,700 行が chunk ごと消滅) / recruitment realtime 重複購読解消 / nuqs 削除。**実測 raw 247.6KB / gzip 78.6KB を初期→async へ移動**
  - **堅牢性 (D)**: ログイン callback 2 fetch に timeout / addSessionLogsUrl 孤児親 rollback / fflogs 同期に 240s 時間予算 (truncated 時は wipe スキップ + cookie 温存) / Supabase env の fail-fast (`requireSupabaseEnv`)
  - **見送り**: getClaims 化 (ユーザー決定②) / unstable_cache (利得 < ステール事故リスク) / gphoto RPC 化
  - **[PR #259](https://github.com/yyamazaki-lym/raid-repository/pull/259) squash merge `71ecb35`**。⚠ **実機確認依頼 6 点は未検収 (次回持ち越し)** — `docs/audit-2026-07-12.md` 末尾参照 (① TOP sync/native 表示 + 過去 12 ヶ月窓 ② メモ popover CRUD ③ 募集テンプレ popover ④ /category バッジ値一致 ⑤ カテゴリ削除 Storage 掃除 ⑥ 本番 EXPLAIN で新 index 使用)。今回ユーザーが検収したのは #260 の 3 点のみで #259 分とは別
- **2.9 (2026-06-15)**: ユーザー要望「全体を通してエラー / バグ / 認証 / デザイン / 機能に問題がないかチェック」を受けた **13 領域 × (専門レビュー → 敵対的検証) のマルチエージェント全体監査** と、確定した **P2 2 件 + P3 18 件** の修正 (7 PR、いずれも squash merge、2026-06-19)。レポート全文 = `.claude/plans/snoopy-twirling-cupcake.md`
  - **監査 (2026-06-19)**: #240 以降の main を対象に、セキュリティ/認証・バグ/挙動・Next16/React19 適合・デザイン/a11y・機能の 13 領域を並列レビュー → 各検出を実コードまで辿って敵対的に検証する workflow を実行 (36 エージェント)。総検出 23 → **確定 20 (P2 2 / P3 18)、誤検知 3 を反証棄却**。**P0/P1 はゼロ** (認証 4 層・RLS/GRANT・secrets/暗号・Next16 適合はクリーンと再確認)。棄却 3 件 = discord-schedule の DELETE/INSERT は対象集合 disjoint で損失なし / native TIME_RE は分グループが 2 桁必須で正常 / jstDateTimeString hour==24 は現行 V8 で到達不能な dead code。
  - **P2 2 件**:
    - **#242 SSRF (`url-safe.ts`)**: `isPublicHttpUrl` が IPv4-mapped IPv6 (`http://[::ffff:127.0.0.1]/` → WHATWG 正規化で 16 進形 `::ffff:7f00:1`) で loopback/private/**IMDS** ブロックを迂回していた (10 進専用正規表現が hex 形を取りこぼし `return true`)。`::` 始まりの埋め込み IPv4 を一律ブロック + link-local を `fe80::/10` 全体に拡張。node 18 ケース実測 pass。
    - **#243 FFLogs wipe 順序 (`fflogs.ts`)**: `linkFflogsReportsToVideos` が report 取得**前**に source='auto' リンクを無条件 wipe → 一過性障害 (OAuth 失効 / API 障害 / scrape 403) で「削除だけ確定」し日次 cron の度に Logs アイコン全滅していた。wipe を取得成功確認後 (失敗系の早期 return 通過後) に移動し、失敗時は既存 auto を温存。manual リンク・戻り値契約は不変。
  - **P3 18 件 (5 PR)**:
    - **#244 (P3-c/d)**: `useRealtimeChannel` の subscribe エラー判定を `if(err)` から status ベースに変更 (CHANNEL_ERROR のみ err 付与で TIMED_OUT/CLOSED を取りこぼしていた) + refetch モード 3 フック (categories/macros/templates) と schedule-memos に subscribe 失敗フォールバックを付与。
    - **#245 (P3-i/o/q、一部ユーザー可視)**: default ボタン hover の `[a]:hover:` (anchor 限定で素の `<button>` に効かない) → `hover:` で全域 primary ボタンの hover 復活 / お気に入りフィルタ ON 中の一括★解除で表示集合から外れたカードを選択集合から掃除 / on-decision 自動通知を開催日が JST 今日のセッションのみに限定 (未来日確定で「本日の固定活動予定日です」誤投稿の解消、cron と同じ範囲判定を Postgres 側で)。
    - **#246 (P3-a/b/e/f)**: rate-limit の client IP を `x-real-ip` 優先 (spoofable な XFF leftmost 回避対策) / `countStoredPastSessions` に admin gate 追加 (兄弟と一貫) / fflogs session・native linker を `upsert(ignoreDuplicates).select()` 化 (競合時の 23505/matched 過少を解消) / `setNativeScheduleSessionStatusAction` を `.select().maybeSingle()` で 0 行検知し通知を行ヒット時のみに。
    - **#247 (P3-j/k/l/r)**: Dialog/Popover/Dropdown の入場アニメを reduced-motion で zoom/slide/blur 抑止 (tw-animate CSS 変数を中立値化、fade のみ残す) / `MainActionSlot` の sticky 閾値を magic number から `--header-h`+`--nav-h` 導出に (F-3 #206 の取り残し) / legend 運用ルール popover に Escape 閉じ + aria-controls / native settings/通知系 5 ファイルの `window.confirm` を `useConfirm()` に統一。
    - **#248 (P3-g/h/m/n/p、schema 変更)**: 無効タブ (`tab_config.enabled=false`) の直 URL/ブックマークを各 sub-page で `notFound()` (ナビ非表示と到達性の一致) / 画像アップロード孤児を storage の admin DELETE policy + ダイアログ後始末で掃除 / gphoto 編集時も Discord CDN URL を Storage 退避 (image kind と対称、24h 失効防止) / `attendance.comment` に sanitize + DB CHECK (symbol と対称、将来の注入面を予防) / 祝日 fallback 表を 2029-2030 まで延長 (天文計算式で算出・既存と整合確認)。**schema 2 件 (comment CHECK / storage DELETE policy) は本番/demo 自動デプロイ成功**。
  - **検証**: 各 PR で tsc / eslint (0 errors) / build / CI lint pass。#242 は node 実測 (18 ケース)、サーバ系 (#243/#246 等) は制御フロー/ロジックレビューで担保。実 cron 競合・RLS・UI 操作系は dev preview 再現不可のためロジック検証 + 本番実機はユーザー委任。
  - **changelog / 版番号**: **据え置き** (P2/P3 ともバグ硬化・予防で非ユーザー可視寄り。#238/#240 同方針)。**#245 の 3 件 (ボタン hover / お気に入り選択 / 確定通知文言) も更新履歴へ載せない確定 (ユーザー判断 2026-06-19)** — 再提案不要。
  - **実機確認 OK (2026-06-19、ユーザー確認済)**: dev preview 再現不可だった 5 点 — ① 非 admin の出欠コメント保存 (P3-g sanitize) ② 未来日を確定したとき「本日」表記が出ない (P3-q) ③ 無効化したタブを直 URL で開くと 404 (P3-m) ④ reduced-motion 設定でダイアログの拡大/スライドが止まる (P3-j) ⑤ 画像アップロード→キャンセルで Storage に残骸が残らない (P3-n) — をユーザー実機で確認 OK。これで本監査 (#242–#248) の検収完了。

- **2.9 (2026-06-15)**: 上記 #238 後の **多角的バグ再点検 (11 エージェント × 敵対的検証)** で確定した低重大度 P3 3 件を修正 ([PR #240](https://github.com/yyamazaki-lym/raid-repository/pull/240) `6cf0f97` squash merge、2026-06-16)
  - **発端**: ユーザー要望「バグがないか再確認」。#238 マージ後の main を対象に、presence ハッシュ化 / dead code 削除を中心へ #223 以降の新規分を 5 次元 (presence-hash / deadcode / blocklist / presence-228 / 広域スイープ+批評) で並列バグ探索 → 各検出を敵対的に検証する review workflow を実行。結論: **P0/P1/P2 級なし** (#238 の変更が新規バグを入れた事実もなし)。確定 P3 3 件を本 PR で解消、誤検知 3 件は反証。
  - **修正 (P3 3 件、いずれも非ユーザー可視)**:
    - **presence 通信断時の stale 凍結**: `use-online-presence.ts` の subscribe が `SUBSCRIBED` のみ処理していたのを `CHANNEL_ERROR`/`TIMED_OUT`/`CLOSED` で `setCount(0)` するよう追加。再接続の sync 再発火で自己回復、docstring とも整合。
    - **demo の「ONLINE 1」固定誤カウント**: 全 demo ゲストが固定 presence key に畳まれるため `useOnlinePresence(selfKey, enabled=false)` で購読をオフ (装飾「ONLINE」のみ + 無駄な WS 接続削減)。`online-presence-indicator` に `isDemoGuest` prop 追加、`site-header` から既算出値を渡す。本番は全員実セッションで非該当。
    - **confirm() 並行呼び出しの Promise リーク**: `confirm-dialog.tsx` の `confirm()` に旧 pending を `resolve(false)` してから上書きするガードを追加し、未解決 Promise (await 永久ハング) を防止。現 caller は全て直列 await で発火経路なしの潜在欠陥への保険。
  - **棄却した誤検知 3 件 (修正不要)**: blocklist add の RLS silent-fail (INSERT/DELETE が同一 client・JWT・RLS 述語で片側抜け不可) / presence 再接続後の re-track 漏れ (P2 申告、Phoenix `resend` が recHooks 経由で `SUBSCRIBED` 再発火) / StrictMode の channel 競合 (`removeChannel` が cleanup 内で同期 teardown 完了) — いずれも `@supabase/realtime-js 2.104.1` 実コードまで辿って反証。
  - **検証**: tsc / eslint (0 errors) / build pass + CI lint pass。changelog / 版番号は据え置き (非ユーザー可視、#231 同方針)。

- **2.9 (2026-06-15)**: 総合レビュー後の追加確認で検出した **presence key の Discord ID 露出** を解消 + 周辺 dead code 掃除 ([PR #238](https://github.com/yyamazaki-lym/raid-repository/pull/238) `147d9b5` squash merge、2026-06-16)
  - **発端**: ユーザー要望「色々追加したので全体的にエンバグ / バグ / デザイン崩れ / セキュリティ抜け / チェック漏れを確認」。#223 以降の新規分 (blocklist #232 / presence #228 / ファイル分割 #224 #225 / UI #231 #234 / ラベル #236) を専門レビュー 3 系統 (RLS / Next16 整合 / 分割挙動保持) + 自己精査。結果 **P0/P1 級のエンバグ・認可漏れ・デザイン崩れなし**、blocklist の RLS/認可も三層防御 (app gate + is_admin RLS + 汎用ループ外で非公開) で健全と確認、分割 #224/#225 もバイト単位一致で挙動保持。検出した低重大度 1 件 + 既存 dead code をこの PR で解消。
  - **① presence key のハッシュ化 (情報露出、Low)**: ヘッダー ONLINE 表示 (#228) は presence key に**生の Discord ID** を使用していた。presence チャンネル `online-presence` は公開 anon key だけで join でき `presenceState()` のキーが列挙可能なため、オンライン中メンバーの Discord ID が誰にでも見えうる新規露出面だった (単一テナント・低重大度だが #228 で装飾→実データ broadcast 化した分)。`auth.ts` の `getCurrentUserDiscordId()` を廃止し `getCurrentUserPresenceKey()` を新設 (`HMAC-SHA256(discordId, salt=SECRET_ENCRYPTION_KEY)` の hex、salt 未設定 fork は plain SHA-256 fallback、**既存 server secret 流用で本番/demo への新規 env 追加不要**)。`site-header.tsx` の selfKey を opaque ハッシュに差替えて生 ID を RSC payload / client bundle に一切載せない。同一 ID → 同一ハッシュなので「複数タブ=1カウント」「distinct数=メンバー数」は不変、hook (`use-online-presence.ts`) / indicator はロジック不変 (docstring のみ更新)。
  - **② dead code 掃除 (確認の副産物)**: `currentUserComment` (schedule-list の dead prop。#105 で `NativeMemberCommentPopover` にコメント機能を移管した際の消し忘れ orphan を git archaeology で特定) + 連動して orphan 化した `commentsByPair` (`native-fetch.ts` / `parse.ts`、attendances SELECT からも comment 列を落として 1 列軽量化) + 未使用 `daysApart` (`fflogs.ts`) を除去。member 全体コメント (`user.comment` → `NativeMemberCommentPopover`、現役) は別系統で不変。
  - **検証**: tsc / eslint (0 errors) / build pass + CI lint pass。presence ハッシュの 7 性質 (決定的・64hex・別ID別key・salt有効・fallback健全・**生ID非含有**・固定値もハッシュ化) を node で実証。`(portal)/layout` は `runtime="nodejs"` のため `node:crypto` 完全互換を build で確認。
  - **changelog / 版番号**: **据え置き** (非ユーザー可視のセキュリティ硬化 + 内部掃除のため changelog 省略。#231 同方針)。
  - **残 (低・据え置き)**: eslint warning 1 件 (`category-form-dialog.tsx:335` exhaustive-deps の false-positive)。`buildInitialTabSettings` がコンポーネント内 const のため依存配列に無い指摘だが、素直に追加すると毎レンダー再初期化のバグ化 → 据え置きが正解。きれいに消すなら同関数のモジュールスコープ巻き上げという別リファクタが必要。

- **2.9 (2026-06-15)**: スケジュールソースモードの「自前作成式」を**準備中表記から正式メニューに格上げ** ([PR #236](https://github.com/yyamazaki-lym/raid-repository/pull/236) `a8738ec` squash merge)
  - **発端**: ユーザー要望「自前作成式のスケジュールはある程度実用レベルになったので分掌変更を求む」。native モードは候補日追加・出欠入力・開催確定・FFLogs 連携・Discord 通知まで実装済 (TODO #2 phase 1〜4 + #73/#77/#81/#85 等で完成) だが、設定ダイアログの**ラベル/説明文だけが当時の「(準備中) / Phase 1 では空の表示のみ / Phase 2 で実装予定」のまま取り残されていた**。スコープはユーザー確認で **ラベル/説明文の格上げのみ** (デフォルト sync 据え置き・本番挙動不変。native をデフォルト化する案は不採用)。
  - **変更**: `schedule-source-mode-section.tsx` のラベル `自前作成式 (準備中)` → `自前作成式`、説明文を実機能 (候補日追加・出欠入力・開催確定・FFLogs 連携・Discord 通知) に更新、ヘッダーコメントの旧記述 (`phase 2 以降で UI 拡充`) も実態に更新。**機能変更なし** (admin が設定で native へ切替えた時だけ反映)。
  - **検証**: tsc / eslint / build pass + CI lint pass。dev preview (admin 視点) で設定ダイアログのソースモード欄に「自前作成式」が準備中表記なし + 新説明文で表示・`sync` 選択のまま (デフォルト不変)・3 択の並び順不変を実測。
  - **changelog**: 2.9 (2026-06-15) に user-facing part 同梱。

- **2.9 (2026-06-15)**: Discord 自動取り込みに **特定 URL の除外 (blocklist) 機能** を追加 ([PR #232](https://github.com/yyamazaki-lym/raid-repository/pull/232) `fc4df6b` squash merge)
  - **発端**: ユーザー要望「特定動画のみ取り込ませないフラグ」。取り込みの dedup (discord-import §3) は URL の在不在しか見ないため、動画を削除しても Discord メッセージが残れば翌日 cron で復活する問題があった。方式は B (専用 blocklist テーブル) をユーザー選択。
  - **schema (2d 章)**: 新テーブル `category_discord_blocklist` (category_id FK CASCADE / url / reason / UNIQUE(category_id,url) + index)。RLS は **admin の is_admin claim のみ・anon deny** で、汎用ループ (anon に SELECT 全開) の外に secrets 同型の独立章で定義。取り込みは service role 読取で RLS bypass。GRANT / publication / updated_at トリガ不要。冪等。
  - **import skip**: `discord-import.ts` importChannel の filter 先頭で blocklist URL を除外 (service role、category 単位 1 SELECT)。`filtered` が除外済みになり空判定・insert・first-clear がすべて従う。
  - **server actions / client**: `add` / `remove` / `list` を admin-gated (assertAdminResult + cookie client。add は 23505 を冪等扱い + 同 URL の `source='discord'` リンク削除、remove は `.select()` で silent-fail 対策) + client wrapper 3 本。
  - **UI**: link-card-menu の ⋮ に「今後取り込まない」(`source='discord'` 限定) / category-form-dialog に「取り込み除外 URL」`<details>` (lazy fetch + 解除)。
  - **検証**: tsc / eslint / build pass。dev preview で ⋮ 条件表示 (manual 非表示) + 除外セクション描画・展開を確認 (console エラー 0)。schema 本番/demo 自動デプロイ成功、本番で **admin policy 3 種 (select/insert/delete) + UNIQUE + RLS 有効** を SQL 実査。**実 admin 動作 (除外 → 消える + 以後取り込まれない) は 2026-06-15 ユーザー実機確認 OK**。import skip 読取は service role で RLS 非依存。
  - **changelog**: 2.9 (2026-06-15) に user-facing part 同梱。

- **2.9 (2026-06-15)**: 総合レビューレポート (`docs/code-review-2026-06-13.md`) の **残 P2/P3 を 4 PR で消化** ([PR #219](https://github.com/yyamazaki-lym/raid-repository/pull/219) C-4 / [PR #220](https://github.com/yyamazaki-lym/raid-repository/pull/220) F-1 / [PR #221](https://github.com/yyamazaki-lym/raid-repository/pull/221) B-3 / [PR #222](https://github.com/yyamazaki-lym/raid-repository/pull/222) C-5、いずれも squash merge)
  - **発端 / 進め方**: 非 admin 検収 OK 後、ユーザー要望で未着手 P2/P3 に着手。ユーザー判断で「1 PR ずつ merge→検証→次へ」、各 PR の着手順・スコープを都度確認。検証は Claude 実施 (dev preview + tsc/eslint/build)。HANDOFF はこの 1 エントリに集約 (per-PR docs PR は出さない)。
  - **#219 (C-4)**: Realtime 購読フック 6 本 (categories / category-links links+albums / category-macros / recruitment-templates / schedule-memos) を共通土台 `src/lib/use-realtime-table.ts` (`useRealtimeChannel` = channel ライフサイクル / `useRealtimeTable<Row,T>` = フラットリスト state + initial 追従 + refetch/incremental 両モード) に集約。schedule-memos の rawDate グループ Map だけは `useRealtimeChannel` 直使い。公開シグネチャ不変、重複スケルトン ~470 行 → 共通土台 207 行。DnD 集約 (#212) の対。
  - **#220 (F-1 残り)**: category-list メトリクスバッジ (Lock/Trophy=amber, Hourglass クリア=emerald/未=violet, recent=indigo, ロック ring=amber) の生 Tailwind 色を #216 同様の**全テーマ共通固定**のセマンティックトークン (`--color-badge-*` + `-fg`) に集約。値は Tailwind 既定パレットの**厳密 oklch ソース値** (node_modules 由来) で**見た目不変** (dev preview で amber/violet/emerald の computed color 完全一致を実測)。削除メニューの rose はメニューアクションのため対象外。
  - **#221 (B-3)**: /login の `LoginButton` で Supabase client を動的 import 化し未認証エントリの初期バンドルから `@supabase/ssr`/`supabase-js` を遅延チャンクへ分離。**ISR サブ課題は見送り確定**: mitigation/loot は per-user の `canEdit` + 認証ゲートに依存し単一 HTML 配信の ISR と相性が悪く安全に行えない (cold start は #181 の nodejs runtime で対処済)。
  - **#222 (C-5 その1)**: `maintenance-menu.tsx` (1025 行) の結果パネル 4 種 (Discord/VideoMeta/FirstClear/StrategyThumb) + 共有型を `src/components/portal/maintenance/` 配下 5 ファイルに分割 (本体 615 行)。逐語コピーで挙動・見た目不変、`MaintenanceMenu` signature 不変。
  - **#224 (C-5 その2)**: 最大ファイル `schedule-list.tsx` (1943→1155 行) から `Legend` / `SessionActionIcons` (+`renderSingleVideoLink`) を `src/components/portal/schedule/` へ、出欠色定数 (`attendance-ui.ts`) / 純関数 (`session-utils.ts`) を `src/lib/schedule/` へ抽出。`ScheduleList` / `SessionRow` は無改修。**`schedule-past-simple` も `SessionActionIcons` を import していた点を tsc が捕捉** (import 元差替)。**eslint-suppressions: `Legend` 移動で `set-state-in-effect` 抑制を legend.tsx へ移設** (schedule-list 側 prune、`purity` 抑制は残置)。
  - **#225 (C-5 その3)**: `session-memo-popover.tsx` (967→782 行) から `SessionMemoDot` / `DeleteConfirmModal` / `formatRelativeTime` を `schedule/` + `lib/schedule/` へ抽出。`SessionMemoPopover` / `MemoList` は無改修。set-state 違反は残置側にあり移動していないため suppressions 変更なし。
  - **#228 (F-4 presence)**: 常時装飾だったヘッダー ONLINE 表示を Supabase Realtime Presence の「オンライン中のメンバー数」表示に意味付け (新 `src/lib/use-online-presence.ts` フック + `online-presence-indicator.tsx`、presence key = Discord ID で複数タブ=1カウント、DB/RLS 変更なし)。ユーザー判断で realtime 接続状態案より presence 案を採用。名前一覧は非対象 (Discord 名 ≠ 予定表メンバー名)。dev で self=1 確認、複数人増分は本番目視。
  - **教訓**: ①Tailwind v4 の色トークンは `@theme inline` + 厳密 oklch literal で見た目不変を保証する (`var(--color-amber-400)` 参照方式は raw クラス削除で Tailwind が tree-shake し参照が壊れうる) ②**per-user 認証 / `canEdit` に依存するページは ISR 不可** (単一 HTML を全員配信のため admin UI 漏れ等) ③React 19 で「最新コールバックを async 購読から参照する」latest-ref は render 中の `ref.current=` 代入が `react-hooks/refs` で error になるため effect 内で更新する ④**eslint-suppressions.json はファイル path キーなので、suppress 済み違反を含むコードを別ファイルへ移すと抑制が外れ「新規 error」化する → 移動先で `--suppress-all`、旧 path を `--prune-suppressions` で reconcile** ⑤**ファイル分割は移動コンポーネントの外部 import 先を grep だけでなく tsc で確認** (今回 schedule-past-simple の取りこぼしを tsc が検出)。
  - **changelog**: 2.9 (2026-06-15) に 7 part 同梱。

- **2.9 (2026-06-15)**: 非 admin メンバーの本番実機検収 2 件 OK — 出欠「未回答に戻す」([PR #189](https://github.com/yyamazaki-lym/raid-repository/pull/189)) / 日付メモ CRUD ([PR #213](https://github.com/yyamazaki-lym/raid-repository/pull/213) A-4)。いずれも実 JWT 必須で dev preview bypass 再現不可だった残検収項目 (本番 policy/制約反映は SQL 確認済)。これで総合レビュー (`docs/code-review-2026-06-13.md`) の P0/P1/P2 主要の実機検収が全て完了。**コード変更なし** (merge 済み PR の検収記録のみ、changelog.ts / 版番号は据え置き)。

- **2.9 (2026-06-14)**: 総合レビューレポート (`docs/code-review-2026-06-13.md`) の **P2 主要項目を 7 PR で消化** ([PR #210](https://github.com/yyamazaki-lym/raid-repository/pull/210) `53c7a4f` / [PR #211](https://github.com/yyamazaki-lym/raid-repository/pull/211) `d2011c7` / [PR #212](https://github.com/yyamazaki-lym/raid-repository/pull/212) `8e0c562` / [PR #213](https://github.com/yyamazaki-lym/raid-repository/pull/213) `dc2fbc0` / [PR #214](https://github.com/yyamazaki-lym/raid-repository/pull/214) `d15a50b` / [PR #215](https://github.com/yyamazaki-lym/raid-repository/pull/215) `5ed1f55` / [PR #216](https://github.com/yyamazaki-lym/raid-repository/pull/216) `49ea149`、いずれも squash merge)
  - **発端 / 進め方**: P0+P1 消化後の続きとして P2/P3 に着手。実装計画 = `.claude/plans/md-splendid-starlight.md`。ユーザー判断で「correctness/掃除 先行 → 1 PR ずつ merge→検証→次へ」。検証は Claude 実施 (dev preview + 一部 node 単体)、非 admin 実機等の一部はユーザー委任。
  - **#210 (C-2/C-3)**: クリア日ジャンプ等の日付処理を JST 暦日に正規化 (新 `src/lib/jst-date.ts`、Intl Asia/Tokyo)。**※素の getUTC* は JST ユーザーも前日にずれるため不可、JST オフセット正規化が正解** (`formatFirstClear` / `onJumpToFirstClear` / category-form-dialog の round-trip / strategy-images の最終同期表示を統一) / `title-date.ts` の validate を月別実在日チェックに (2/31・4/31 を弾く)。
  - **#211 (D/E)**: forwardRef→ref prop (session-memo-popover) / `<Ctx.Provider value>`→`<Ctx value>` (action-slot) / lib/server 外部 GET fetch に `cache:"no-store"` 明示 (**Next16 既定は no-store でなく `auto no cache` と docs 確認**、消費側は全て動的なので挙動不変・防御的明示) / 未使用 `badge.tsx` 削除。
  - **#212 (C-1/C-4)**: DnD 並び替え 8 箇所 (6 ファイル) を共通フック `src/lib/use-sortable-reorder.ts` に集約。**C-1**: `setTimeout(1500)` の楽観巻戻りちらつきを schedule-list と同じ「DB 確定順が楽観順に追いついたら畳む」値マッチ方式に統一。高レベル `handleDragEnd` (単純) + 低レベル `commit` (videos の reverse / macros の filtered→global / recruitment の group・row) を公開。
  - **#213 (A-4、schema 変更)**: `schedule_session_memos` をログイン済みメンバー全員が編集可に (schema 7a-2 に `authenticated` 書込 policy 追加、汎用ループの admin policy と OR 評価、**anon は read-only 維持**)。本番/demo へ自動デプロイ + 本番 `pg_policies` で member policy 反映確認済 (read=全員 / 書込=admin∪member)。コメント (schema 5c-2 / schedule-memos-client) を実 policy に整合。**非 admin メンバーの UI 実機編集 OK (2026-06-15 ユーザー実機確認)**。
  - **#214 (F-4)**: 破壊的操作の `window.confirm` 14 箇所を共通 ConfirmDialog (`src/components/portal/confirm-dialog.tsx` の Promise ベース `useConfirm()`、`(portal)/layout` に 1 mount) に統一。destructive は実行ボタン赤系 + 初期フォーカス cancel。maintenance の強制再取得は確認を `startTransition` の外へ、サインアウト form は「承諾時のみ `form.submit()`」化。
  - **#215 (F-1、見た目大)**: portal 全体の日本語ラベルの `font-mono`+`uppercase`+`tracking` を `font-sans`+`tracking-normal` に統一 (約 170 箇所/40 ファイル)。**当初タブ/バッジ限定 → ユーザー指摘の不統一を受け portal 全体に拡大** (判定基準「日本語=sans / 英字・数値・日付等のデータ値=mono / 迷ったら mono」を統一し並列エージェント 6 系統で分担→中央検証)。globals.css に型スケール規約 (最小 11px 床 + mono は英字専用) 明文化、status バッジ 9-10px→11px。
  - **#216 (F-1/F-4)**: status バッジ色を `globals.css @theme` の `--color-status-*` トークンに集約 (**意味色は全テーマ共通で固定** = 信号機的明確さ優先、テーマ可変にはしない=ユーザー判断) / カテゴリ名を `font-medium` で強調 (15px だと長名が 2 行折返しのため weight のみ)。**F-4 ONLINE ドットはユーザー判断で現状維持**。
  - **教訓**: ①ナビタブのサイズは F-3 の sticky offset (`--header-h`/`--nav-h`) 高さ依存のため変えない (font/tracking のみ) ②**branch 切替後の Turbopack stale chunk は HMR/リロードでは消えず `.next/dev` 削除 + preview 再起動で解消** (今回 3 回発生、`dev-preview-verification-quirks` memory の追補) ③日本語 mono 解消は部分適用だと周囲と不統一になる ④client 直 supabase の RLS 系は dev preview bypass (実 JWT 無し) で検証不可。
  - **changelog**: 2.9 (2026-06-14) に 7 part 同梱済。**スコープ外 (残)**: 次回の作業優先度 の P2/P3 項目参照。

- **2.9 (2026-06-13)**: 総合レビューレポート P1 残り 3 件 (F-3 / F-2 / A-5) を完了 — これで報告書の **P0 + P1 を全消化** ([PR #206](https://github.com/yyamazaki-lym/raid-repository/pull/206) squash merge `e0c17c8` / [PR #207](https://github.com/yyamazaki-lym/raid-repository/pull/207) `6d77517` / [PR #208](https://github.com/yyamazaki-lym/raid-repository/pull/208) `c553584`、検証は Claude 実施でユーザー委任 2026-06-13)
  - **F-3 sticky 定数の単一ソース化 (#206)**: sub-tabs の `top-[102px]/sm:top-[110px]` + JS `STICK_AT=102/UNSTICK_AT=118` のヘッダー高手計算依存を解消。globals.css に `--header-h` (3.5rem/sm:4rem) / `--nav-h` (2.875rem=46px) を定義し、site-header 高・main-tabs/sub-tabs の sticky top・JS hysteresis 閾値 (getComputedStyle + resize 再計算) を全て導出。見た目・挙動不変
  - **F-2 prefers-reduced-motion (#207)**: `@media (prefers-reduced-motion: reduce)` が 0 箇所だったのを追加。背景アニメは全テーマで `.bg-grid-animate`/`.bg-scanlines` に乗るため 2 クラスを `animation:none !important` で一括停止 (!important が theme 別の高 specificity に勝つ)。link-pending は `animation:none + opacity:0.7` で静止可視維持。ONLINE ドットは `motion-reduce:animate-none`、tab underline は 3 コンポーネントの `useReducedMotion()` で spring 即時化。reduce OFF 時は完全不変
  - **A-5 冪等性 2 件 (#208、schema 変更)**: ① `category_links` に `UNIQUE(category_id, kind, url)` 追加 (NOT VALID 不可のため ctid ベース dedup DELETE を先行。再デプロイ時 0 行の冪等) + discord-import を `upsert(onConflict ignoreDuplicates)` 化で cron×手動の race window でも二重挿入を防止 ② native 通知 (`respectDedup=true`=cron) を「先取り条件付き UPDATE (`is last_notified_at null`) → claim 成功時のみ POST、失敗で rollback」に反転して二重通知を行ロックで排他。手動 Bell 再通知 (`respectDedup=false`) は従来どおり
  - **検証 (Claude 実施、ユーザー委任)**: 各 PR で tsc/eslint/build/CI pass。merge 後 dev preview (merged main) で実測 — F-3: sub-tabs top 102px(375)/110px(1280)・scroll で stuck false→true→false / F-2: reduced-motion `@media` ブロックが served CSS に存在 (`.bg-grid-animate/.bg-scanlines`→none, link-pending→opacity 0.7)・デフォルトは ec-snow-big 稼働・更新履歴に 5 part 表示・console error 0 / A-5: **本番 DB 実測で UNIQUE 制約存在 + 756→755 行 (asphodelos 重複 1 圧縮) + 重複グループ 0**。schema 自動デプロイは本番/demo 両 success。※ reduced-motion ON 時の実視覚は preview がメディアをエミュレートできず未確認 (CSS 出荷は prod build + dev CSSOM で確認済)、cron 競合・自動通知の実地挙動はロジック/コードレビューで担保
  - **方針メモ**: B-1 motion バンドルはスキップ確定 (過去 2.3 で CSS 化 -46KB → 視覚価値優先で再導入した経緯を尊重)、B-2 は lucide-react が Next 16 既定最適化のためスコープ外。残りは報告書 P2/P3 (次回の作業優先度 の P2/P3 項目参照)
  - **changelog**: `2.9 (2026-06-13)` に 5 part 統合 (P0 セキュリティ / A-3 / F-3 / F-2 / A-5。各 PR の changelog 先頭衝突は merge 時 rebase で 1 entry に統合)

- **2.9 (2026-06-13)**: 総合レビューレポート (`docs/code-review-2026-06-13.md`) 対応開始 — P0 セキュリティ 2 件 + P1 A-3 を実機確認 OK で merge ([PR #203](https://github.com/yyamazaki-lym/raid-repository/pull/203) squash merge `bf62ef7` / [PR #204](https://github.com/yyamazaki-lym/raid-repository/pull/204) squash merge `38f2270`、本番実機確認 OK 2026-06-13)
  - **発端**: #202 で統合した総合レビューレポートの指摘事項に着手。ユーザー判断でスコープを段階化 (P0 → P1)。実装計画 = `.claude/plans/p1-structured-mccarthy.md`、進め方は「1 PR ずつ merge → 検証 → 次へ」
  - **#203 (P0 セキュリティ 2 件)**:
    - **A-1 OAuth callback オープンリダイレクト** ([auth/callback/route.ts](../src/app/auth/callback/route.ts)): `sanitizeNextParam` が `?next=/%5Cevil.com` を取りこぼし、`new URL(next, req.url)` の WHATWG 正規化でバックスラッシュが `//evil.com` (protocol-relative) → 外部オリジンに解決されていた (実機 PoC 済)。バックスラッシュ拒否 + 解決後 origin 一致検証で二重防御。Node でロジック実証 (有効な OAuth code を伴わないと最終リダイレクトに到達しないため手動再現は不要扱い)
    - **A-2 SECURITY DEFINER RPC の admin 迂回** ([schema.sql](../supabase/schema.sql) `update_native_placeholder_raid_times`): authenticated 全体に GRANT + 関数本体に admin 検査なしで、非 admin の guild メンバーが自身の JWT で PostgREST RPC を直叩きすると app 層 `assertAdminResult` を迂回して未来 placeholder の時刻書換 / 衝突 DELETE / memo 追従書換ができた (表示改竄ベクタ)。PR #187 の REVOKE は anon 除外のみで authenticated 非 admin は素通りだった。RLS と同じ is_admin claim 検査を関数冒頭に追加 (`auth.jwt() ->> 'role' = 'authenticated'` かつ `is_admin != 'true'` のみ RAISE 42501、service_role / SQL Editor 等 JWT 無し経路は維持)。**schema 自動デプロイ成功 (本番/demo 両 success 確認)**
  - **#204 (P1 A-3 silent fail)**: RLS の UPDATE/DELETE は USING で行が見えなくなるだけなので、非 admin 実行時に 0 行更新 + error=null → `{ok:true}` + 成功 toast になっていた (INSERT は WITH CHECK で正しくエラー)。マクロ / 募集テンプレ / メモ / スケジュール上部テキストの client 関数 4 ファイルの update/delete/upsert に `.select("id"/"key")` を付け返却 0 件を `{ok:false}`「権限がない可能性があります」に変換。reorder は各 update に付けて 1 件でも 0 行なら失敗扱い。top-text の upsert も既存キーの `ON CONFLICT DO UPDATE` が USING で 0 行 silent fail し得るため両ケース対応 (計画より踏込み)。admin 正規操作は対象行が見えるため挙動不変
  - **検証**: 各 PR で tsc / eslint / build / CI pass。本番実機で admin 経路の無回帰 (デフォルト時刻変更・各種編集/削除/並び替え・更新履歴表示) を確認 OK。非 admin 経路は実 RLS への非 admin セッションが必要で dev preview (demo + bypass = admin 視点) では再現不可のため、ユーザー判断で OK 扱い (2026-06-13)。changelog 2.9 (2026-06-13) に 2 part 同梱 (#204 は #203 と changelog 先頭が衝突するため rebase で 1 entry 2 part に統合)
  - **残り P1 (計画済・未着手)**: PR-B F-3 sticky 定数の単一ソース化 / PR-C F-2 prefers-reduced-motion / PR-D A-5 冪等性 2 件 (schema 変更)。B-1 motion はスキップ確定、B-2 はスコープ外 (次回の作業優先度 の P2/P3 項目参照)
  - **教訓**: SECURITY DEFINER 関数を admin 限定にするには GRANT/REVOKE だけでなく**関数本体の claim 検査が必須** (authenticated GRANT は「ログイン済み全員」を意味する)。client 直 supabase の UPDATE/DELETE は RLS USING で silent fail するため `.select()` で返却行数確認が定石 (PR #189 の出欠 silent fail と同クラス)

- **2.9 (2026-06-12)**: 上部タブの余白偏り修正 + UI 全体のデザイン整合性総点検・一括調整 13 箇所 ([PR #197](https://github.com/yyamazaki-lym/raid-repository/pull/197) squash merge `0836e1a` / [PR #199](https://github.com/yyamazaki-lym/raid-repository/pull/199) squash merge `de56507`、本番実機確認 OK 2026-06-12)
  - **発端**: ユーザー報告「上部タブのスケジュール、コンテンツの前後空白が一致していないバランスなのが気になる」→ 修正後「他にもデザイン的におかしい部分がないか確認してみて」で全体総点検に拡大
  - **#197 (上部タブ)**: 原因は 2.9 の遷移 pending ドット (非 pending 時も visibility: hidden でスペース確保する方式) が flex フロー内にあり、`gap-2 8px + ドット 6px = 14px` が右側だけ常時挟まって内側余白が左 16px / 右 30px に偏っていたこと + スケジュール `py-1.5` / コンテンツ `py-2` の高さ不一致。ドットを absolute (`right-1.5` 垂直センター) で右 padding 域に重ねてフローから除外 ([main-tabs.tsx](../src/components/portal/main-tabs.tsx) / [category-switcher.tsx](../src/components/portal/category-switcher.tsx))、`py-2` に統一。layout shift 回避は absolute 配置自体で担保 (点灯時もタブ幅不変を実測)。SubTabs の sticky 定数 (102/110px) は nav 高さ不変のため影響なし (実測一致)
  - **#199 (総点検 13 箇所)**: dev preview 実測 + 並列コードレビュー 2 系統で「並んで表示される要素同士の数値の不揃い」を横断検出。**方針 (ユーザー確認済)**: 確定バッジは emerald 様式に統一 (次回開催カード側を予定表 status 列に合わせる) / セクション内保存ボタンは mono 10px tracking uppercase に統一 (ダイアログ footer 保存は 11px のまま階層差として維持) / 意図的可能性の高い 3 件 (dropdown 内アイコン主従サイズ差・出欠 amber 2 シェード・メモスロット幅 h-4 vs h-5) は現状維持。主な修正: 予定表ヘッダー th py 全列 `py-2` 統一 / 設定ダイアログ入力欄 `h-7` 統一 (隣の h-7 保存ボタンと整列) / Danger Zone 見出しを見出し規約 (10px・0.22em・border-b) に統一 / 「更新履歴」ボタンを隣接チップと同じ `h-8 px-3 rounded-md` に / past-sessions 同一行 3 ボタンの文字・アイコンサイズ統一 + 取り込み結果パネルに閉じる × 追加 / タブ設定 checkbox に accent-cyan + cursor-pointer / FFLogs マッチワードを共通 Textarea 部品化 / FFLogs popover 見出しを他 popover 4 種と統一 + 追加ボタン寸法統一 / OAuth 接続ボタン寸法を切断側と統一 / PT 募集 drag handle `h-7` 統一 / キャンセル済み候補日の復帰 spinner を押したボタン側のみに表示 / tracking 0.2em・gap の揺れ解消
  - **検証**: tsc / eslint / CI pass + dev preview 実測 (タブ左右余白 17px・高さ 36px 一致 / th padding 全列 8px / past-sessions 3 ボタン 11px・h-28 / 全セクション見出し 10px・2.2px・border-b 1px / footer チップ 4 個 h-32 / fflogs Input + 保存 h-28 整列)。native 系セクションは demo が sync モードで未描画のためクラス変更 + tsc/eslint のみ → 本番実機確認 OK で検収。注: 当初の #198 は #197 の base ブランチ削除で GitHub に自動 close されたため main rebase 後 #199 として再作成 (内容同一)。changelog 2.9 同日 part 2 件を各 PR に同梱
  - **点検の副産物 (未対応・低優先)**: コードレビューで検出したが今回スコープ外とした低確信指摘 — schedule-onboarding コールアウト 2 種のアイコン/文字サイズ差、フォーム Label の 2 系統 (text-xs vs mono 10px)、data-init-confirm-dialog のコンテナが親 settings dialog の glass 様式と不一致。視認性が低く必要になったら対応

- **2.9 (2026-06-12)**: FFLogs 日次自動連動 cron の ON/OFF トグルを設定ダイアログに追加 — TODO #86 の将来余地 (UI Switch) を消化 ([PR #195](https://github.com/yyamazaki-lym/raid-repository/pull/195) squash merge `d9e17d6`、本番実機確認 OK 2026-06-12)
  - **発端**: ユーザー相談「Logs のログ取得 cron を ON/OFF 切替できるようにした方が良いか」。cron route 側の skip 機構 (`app_settings.fflogs_cron_enabled='false'` で no-op) は TODO #86 (2.6) から実装済みだったが、切替手段が Supabase Dashboard での値直接編集のみで toggle UI は当時スコープ外だった
  - **変更内容**: [categories-actions.ts](../src/lib/server/categories-actions.ts) に `getFflogsCronEnabled` (現在値、fail-open で boolean 化) / `setFflogsCronEnabledAction` (upsert) を追加 (いずれも `assertAdminResult` ゲート)。[fflogs-sync-section.tsx](../src/components/portal/settings/fflogs-sync-section.tsx) の連動ボタン直上に「日次自動連動 (cron)」toggle を追加 (TODO #2 phase 4 の `native-discord-notify-section.tsx` toggle パターン踏襲、ダイアログ open 時の一括 fetch に現在値取得を追加)。fail-open 設計 (未設定 = ON) は変更なし、ON は行 DELETE ではなく `'true'` 明示保存。手動「FFLogs と動画を連動」button は toggle と無関係に常時動作 (cron route / vercel.json は無改修)
  - **検証**: tsc / eslint / CI pass + dev preview (demo DB) で OFF/ON 両方向の `app_settings` 保存を PostgREST SELECT で実測、ダイアログ再オープン時の状態復元と toast 表示も確認。検証で書き換えた demo DB の値は `'true'` に復元済み (= 未設定時と同挙動、本番 DB は未変更)。changelog 2.9 同日 part 追記を同 PR に同梱

- **2.9 (2026-06-12)**: 非表示設定タブのアイコンがコンテンツカード / コンテンツ切替メニューに出ていた問題の修正 ([PR #193](https://github.com/yyamazaki-lym/raid-repository/pull/193) squash merge `9dc258c`、本番実機確認 OK 2026-06-12)
  - **発端**: ユーザー報告「コンテンツのカードに非表示に設定した項目を出さないようにしたい」。タブ設定 (Phase 17, 2.6) の enabled=false 判定は詳細ページのタブ列 ([sub-tabs.tsx](../src/components/portal/sub-tabs.tsx)) にしか実装されておらず、/category カードのショートカットアイコン行 ([category-list.tsx](../src/app/(portal)/category/category-list.tsx) `SubPageShortcuts`) とヘッダーのコンテンツ切替メニュー内アイコン行 ([category-switcher.tsx](../src/components/portal/category-switcher.tsx)) は `tab_config` を見ずに常時 5 アイコン全部描画していた
  - **修正**: 両箇所で sub-tabs.tsx と同一判定 (`enabled === false` を除外、label 上書きを tooltip / aria-label に反映) を適用。切替メニュー側はクリック先の defaultTab フォールバック判定のみ実装済でアイコン行が未対応だった
  - **検証**: tsc / eslint / CI pass + dev preview 実測 — `rowToCategory` に一時 tabConfig 注入 (DB 書き込みなし、検証後復元) でカード / 切替メニュー双方からアイコンが消え、ラベル上書きが tooltip に反映されることを確認。changelog 2.9 同日 part 追記を同 PR に同梱

- **2.9 (2026-06-12)**: ページ下部でメモポップアップが見切れて読めない問題の修正 ([PR #191](https://github.com/yyamazaki-lym/raid-repository/pull/191) squash merge `c9faa94`、本番実機確認 OK 2026-06-12)
  - **発端**: ユーザー報告「ページ下部でコメントを開くと見切れて読めなくなる」(過去の出欠表など下端付近の行)。[session-memo-popover.tsx](../src/components/portal/session-memo-popover.tsx) はポップアップを常にトリガー (日付) の下側に fixed 配置し、maxHeight を「viewport 下端までの残り」にしていたため、下端付近ではヘッダーしか見えない高さに潰れていた
  - **修正**: 下側に最低 320px を確保できず、かつ上側のほうが広い場合は bottom アンカーでトリガーの上側に反転配置 (上方向に伸びる)。`place()` がスクロール / リサイズ追従の再配置でも同じ反転判定を通る。手動 fixed 配置はこのコンポーネント固有 (他 popover は該当パターンなしを grep 確認済)
  - **検証**: tsc / eslint / CI pass + dev preview 実測 (下端の行 → 上側に全文表示、上部の行 → 従来どおり下側)。changelog 2.9 同日 part 追記を同 PR に同梱

- **2.9 (2026-06-12)**: 2.8〜2.9 変更一式 (#174〜#185) の総点検 (エンバグ精査) + follow-up 修正 4 件 ([PR #186](https://github.com/yyamazaki-lym/raid-repository/pull/186) squash merge `314c1ed`) + warmup cron 検証実測 + 保留オペレーション項目 3 クローズ + RLS 監査で発見した 3 件の修正 ([PR #187](https://github.com/yyamazaki-lym/raid-repository/pull/187) `018ef4c` anon RPC REVOKE / [PR #189](https://github.com/yyamazaki-lym/raid-repository/pull/189) `0499e99` 出欠 silent fail + symbol 制約。いずれも本番/demo schema deploy 成功 + 本番 DB で実 ACL/policy/制約を SQL 確認済)
  - **総点検の結論**: #174〜#185 に重大なエンバグなし。専門レビュー 2 系統でも裏付け — Next.js 16 / React 19 整合レビュー「指摘なし」(scrape-proxy Edge route / loading.tsx 境界移設 / useLinkStatus / Link onNavigate / proxy.ts いずれも現行仕様準拠)、RLS 監査も #176 service role 化のスコープ妥当 (auto 行のみ wipe・固定 key のみ) / scrape-proxy 認証 fail-closed / #186 認可順序 OK を確認 (新規発見は下記「残課題」)
  - **#186 (修正 4 件)**: ① scrape 経路判定を `VERCEL === "1"` 単独 → `+ NODE_ENV === "production"` に強化 — `vercel env pull` 製 .env.local にも `VERCEL="1"` が含まれるため、ローカル dev が proxy 経路に誤進入していた (現状は host 欠如 warn → direct fallback で動作、将来 env pull に `VERCEL_PROJECT_PRODUCTION_URL` が入ると dev scrape が本番 Edge proxy を経由する footgun) ② scrape-proxy の 429 (rate limit) は direct fetch に fallback せず fail-fast (fallback しても Node IP 恒常 403 で 20s × 残ページ浪費のため) ③ TOP native 分岐の placeholder INSERT (service role) を `requireDiscordMember()` 解決後にチェーン — 2.9 並列化 (#181) で authz 前に書込副作用が走る構造になっていたのを並列化前の順序保証に復元 (proxy 前段ブロックがあり実害は無かった) ④ コンテンツメニューの遷移 pending ドットに 15s safety timeout + メニュー再オープン時リセット (遷移未完了時の点灯しっぱなし対策)
  - **warmup cron (#185) 検証完了 (2026-06-12 実測)**: 本番 `cron.job` jobid=16 active / `cron.job_run_details` 205 回連続 succeeded / `net._http_response` 直近 6h 全件 200 / 本番 /login TTFB 0.16〜0.23s (3 回計測) — アイドル後 cold start 解消を確認 (schema.sql §13e の検証 TODO 消化)
  - **RLS 監査の新規発見 1 (→ PR #187 で修正・反映確認済)**: TODO #85 (2.6) の `update_native_placeholder_raid_times` RPC (SECURITY DEFINER) が **anon から実行可能だった** — Postgres は関数作成時にデフォルトで PUBLIC へ EXECUTE を付与するため、`GRANT TO authenticated` を足すだけでは意図した「anon 除外」にならない (schema.sql に REVOKE が 1 行も無かった。Supabase security advisor の実 ACL 検査で検出)。公開されている anon key だけで未来 placeholder の時刻書き換え / 衝突 DELETE / memo 追従書き換えが可能な状態だった (機密漏洩なし、表示改竄ベクタ)。§13d に `REVOKE EXECUTE FROM PUBLIC, anon` を追加。**反映確認済 (2026-06-12)**: 本番 `pg_proc.proacl` が `{postgres, authenticated, service_role}` のみ (PUBLIC/anon 消滅)。なお §13b/13c の sort_order allocator 4 関数の anon EXECUTE は明示 GRANT した設計どおり (read-only) で対象外。**教訓: SECURITY DEFINER 関数を「特定ロール専用」にする時は GRANT だけでなく `REVOKE ... FROM PUBLIC` 必須**
  - **RLS 監査の新規発見 2+3 (→ PR #189 で修正・反映確認済)**:
    1. **非 admin メンバーの「未回答に戻す」が silent fail する実バグ (#176 と同クラス)**: `upsertNativeScheduleAttendanceAction` は空 symbol で cookie client DELETE するが ([native-schedule-actions.ts:807](../src/lib/server/native-schedule-actions.ts))、`native_schedule_attendances` の delete policy は admin-only で §7a の self policy は insert/update のみ (§7a コメント「本人 delete は不要」と実装が食い違い)。UI の「未回答」radio から非 admin が操作すると 0 行 DELETE + `ok: true` + 成功 toast で実際は消えない。→ §7a に `native_schedule_attendances_self_delete` policy を追加 (app 実装に合わせる)。**反映確認済**: 本番 `pg_policies` に self_delete 存在。**UI 経由の実機検収 OK (2026-06-15 ユーザー実機確認)**
    2. **attendance symbol のサニタイズ (#177) が app 層のみ (中低)**: member 本人は anon key + 自分のセッション JWT で PostgREST を直接叩けば self-row RLS を通るため、改行・長文 symbol を Server Action を迂回して書けた。→ 二重防御を追加: §5e に CHECK 制約 (`char_length <= 32` + 制御文字禁止、**NOT VALID** = 既存行非検証で deploy 安全) + `buildMessage` に read 時サニタイズ `sanitizeSymbol` (write 側と同一正規化)。**反映確認済**: 本番 `pg_constraint` に制約存在 / 既存 17 行は全て健全 (最大 1 文字・制御文字 0 行) で NOT VALID の実害なし
  - **残課題 (低、未対応)**: `assertCronAuth` の `x-vercel-cron` ヘッダ fallback は CRON_SECRET 不一致でも通す — Vercel proxy が外部からの `x-vercel-*` を剥がす仕様に依存しており実害は低いが、#176 で service role write が接続され依存の重みが増した。CRON_SECRET 必須化 (fallback 撤去) の検討余地
  - **その他観測 (対応不要)**: Supabase performance advisor は `auth_rls_initplan` 59 件ほか既存ヒュージーンのみ (新規変更起因なし) / dev サーバーの単発 `transformAlgorithm is not a function` TypeError は応答 200 のまま出る無害な Turbopack dev ノイズ (持続的 404 を伴う時だけ `.next\dev` 削除で対処) / fflogs.ts の `daysApart` が未使用 (eslint warning、削除候補)
  - **検証**: #186 は tsc / eslint / CI pass + dev preview で TOP sync/native 両分岐の描画とメニュー遷移を実測 (native は source-mode 一時ハードコードで確認後復元)。demo ヘッダー版数 2026-06-12 で本番反映確認済

- **2.9 (2026-06-11)**: TODO #54 follow-up (再調査) クローズ — デプロイ後/アイドル後の TOP 初回描画 ~5s の根本対策 (TOP/layout の Node 化 + 直列クエリ並列化 + ロード時スピナー拡充) と、その副作用で表面化した FFLogs scrape 恒常 403 の修復 (Edge proxy 中継) ([PR #181](https://github.com/yyamazaki-lym/raid-repository/pull/181) squash merge `435683d` / [PR #182](https://github.com/yyamazaki-lym/raid-repository/pull/182) squash merge `641b389`、本番実機確認 OK 2026-06-11)
  - **発端**: ユーザー報告「デプロイ後/しばらく間をおいたアクセスで描画まで体感 5 秒」(#54 の主訴の再発)。#54 (2026-05-01) で category 系 6 ページは Node 化済みだったが、TOP + `(portal)/layout.tsx` だけ「FFLogs scrape は Edge IP 必須」を根拠に Edge のまま残っていた。再調査で前提の崩壊を確認 — TOP 描画時の FFLogs 処理 (`fetchSessionLogsByDate`) は Supabase SELECT のみで scrape を含まない
  - **PR #181 (perf + UX)**: ① `(portal)/{layout,page}.tsx` を `runtime = "nodejs"` 化 (Edge は Fluid Compute の instance 再利用に乗れず毎回 cold start) ② TOP の `buildSessionVideoLinkMap` を Promise.all 完了後の直列 await から `fetchSchedule` チェーンに並走化、native モードの ensure → fetchNative → linkMap 直列 3 連鎖も appSettings チェーン化 (TODO #81 の insert → read 順次制約はチェーン内で維持) ③ [`(portal)/loading.tsx`](../src/app/(portal)/loading.tsx) 新設 — TOP の Suspense 境界を page 内から移設 (境界 2 枚だと client 遷移時に fallback 再マウントでチラつくため 1 枚に集約)。loading.tsx は prefetch されるためタブ遷移で即 "Now Loading" ④ メインタブに `useLinkStatus` ベースの pending ドット ([link-pending-indicator.tsx](../src/components/portal/link-pending-indicator.tsx))、コンテンツ切替トリガーに `Link.onNavigate` + pathname 監視ベースの pending ドット (dropdown はクリックで即閉じるため useLinkStatus 不可)
  - **PR #182 (緊急 follow-up)**: #181 反映直後に FFLogs scrape が常時 403 化 (ユーザー実機: リトライ全敗)。**Cloudflare bot 判定は Edge IP を通すが Node Lambda IP を恒常ブロック**と確定 (2.8 の「403 は間欠的」は Edge 経路での観測だった)。`/api/fflogs/scrape-proxy` (runtime="edge" / CRON_SECRET Bearer 認証 / fetch 先は userId+page から組む reports-list URL 固定で SSRF 不可 / rate limit 60req/60s) を新設し、scrape の外向き fetch だけ Edge IP 中継。manual 連動と cron の両方が経由 — cron は元から Node runtime のため日次 scrape は以前から失敗していた可能性が高く、これも修復
  - **検証**: 両 PR とも tsc / lint (error 0) / build PASS + dev preview 実測 (loading fallback 即マウント・高速遷移でフラッシュ無し / proxy の 401・400・中継透過)。本番実機: scrape 成功確認 OK (2026-06-11)。cron の logs 自動付与は翌朝 JST 04:00 以降に観察 (保留オペレーション参照)
  - **記録**: 経緯詳細 = `.claude/todos/54.md` (2026-06-11 follow-up 追記) / scrape 経路の結論は `fflogs.ts` の `fetchScrapePageHtml` コメントにも記録。**FFLogs scrape 系コードを Node 直 fetch に戻してはいけない** (エラー reason の経路表記 `edge 経由`/`direct` で切り分け可能)

- **2.8 (2026-06-11)**: セキュリティ全体監査 + FFLogs Private/Unlisted 取得の最終結論 ([PR #174](https://github.com/yyamazaki-lym/raid-repository/pull/174) `bcbe361` / [PR #175](https://github.com/yyamazaki-lym/raid-repository/pull/175) `b4da9b5` / [PR #176](https://github.com/yyamazaki-lym/raid-repository/pull/176) `0df28d0` / [PR #177](https://github.com/yyamazaki-lym/raid-repository/pull/177) `96cb8bf` / [PR #178](https://github.com/yyamazaki-lym/raid-repository/pull/178) `5fbdce9` / [PR #179](https://github.com/yyamazaki-lym/raid-repository/pull/179) `a95f887` / [PR #180](https://github.com/yyamazaki-lym/raid-repository/pull/180) `7f29d34`) ※本エントリは 2.9 の HANDOFF 更新時に欠落が判明し changelog 2.8 から補填 (2026-06-11)
  - **セキュリティ監査 (#174)**: Next.js 16.2.4 → 16.2.9 更新 (middleware/proxy bypass GHSA-267c-6grr-h53f ほか解消) / 認可ガード欠落の Server Action 4 本に admin gate 追加 / SSRF 多層防御 (`isPublicHttpUrl` + 手動 redirect 検証に統一、`parseYouTubeId` 厳格化) / CRON_SECRET 比較の定数時間化 / demo 匿名ゲストの service role コメント書込・/api/page-title 踏み台経路の遮断。あわせて ESLint error 一掃 (既存 40 件は eslint-suppressions.json 化、新規のみ CI fail) + CI ゲート (lint + tsc) 新設
  - **#175 (監査 follow-up)**: 抑制 40 件の精査で category-list.tsx の rules-of-hooks が実バグと判明 (realtime でカテゴリ 0↔非0 遷移時に hook 数が変わりクラッシュしうる)。useMemo を早期 return 前へ移動 + suppressions prune (40→39)
  - **#176**: cron (/api/cron/fflogs-sync) の書込が RLS で silent fail していた問題を service role 化で修復 — cron は anon ロールのため admin write ポリシーで全書込 0 行、route は 200 を返すため無検知だった
  - **#177**: Discord 通知本文への非 admin テキスト注入防止 — 出欠 symbol の制御文字除去 + 32 文字制限、`buildMessage` に mention 無害化 (allowed_mentions 単一依存からの脱却)
  - **#178**: ロール制限カテゴリ (`required_role_ids`) は「表示の出し分け / 誤クリック防止」であって機密境界ではない旨を category-visibility.ts / schema.sql に明文化 (RLS ロール条件は実装しない割り切り、真の機密は secrets テーブルで anon deny 済)
  - **#179/#180 (FFLogs 実測)**: unfiltered `reports()` 再実測 → **自分名義 0 件で死に筋確定** (v2 API だけで Private/Unlisted 取得は不可能、再検証しない)。同実測で scrape は成功 (459 件取得、動画 98 + 過去予定 18 紐づけ)。診断コードは #180 で撤去、結論は fflogs.ts の `fetchFflogsReportsV2` コメントに記録 — ※当時の「Cloudflare 403 は間欠的」は 2.9 で「Edge IP は通る / Node IP は恒常 403」に訂正済み
  - **検証**: 各 PR で tsc / lint / build PASS (詳細経緯: changelog 2.8 の part 8 本)

- **2.7 (2026-06-10)**: TODO #91 クローズ — デモサイトで owner だけ編集可能に (案 A: 実セッション優先 + ゲスト fallback) + follow-up: 設定ダイアログ footer の Sign in 導線 ([PR #168](https://github.com/yyamazaki-lym/raid-repository/pull/168) 起票 / [PR #169](https://github.com/yyamazaki-lym/raid-repository/pull/169) 実装 squash merge `2165978` / [PR #170](https://github.com/yyamazaki-lym/raid-repository/pull/170) env 反映 deploy trigger / [PR #171](https://github.com/yyamazaki-lym/raid-repository/pull/171) follow-up squash merge `2bc8a96`、demo 実機確認 OK 2026-06-10)
  - **変更内容** [src/lib/server/auth.ts](src/lib/server/auth.ts): `requireDiscordMember()` の demo 短絡 (セッション確認前に roles=[] ゲスト返却) を撤去し、`PUBLIC_DEMO_MODE` でもセッション確認を常に実行。実セッション + guild member 検証済みなら本物の roles を返し (編集可能は `DISCORD_ADMIN_ROLE_IDS` 持ちのみ、fail-closed 維持)、セッションなし / 非メンバー / 検証失敗は **redirect せず** roles=[] ゲストへ fallback (一般訪問者の read-only 体験は無変化)。RLS は実セッション JWT の `is_admin` claim (auth/callback 書込、既存経路) で通過。`cache()` dedupe 維持、proxy.ts はコメントのみ追従 (ロジック無改修)
  - **follow-up (Sign in 導線、同日ユーザー判断で起票時の「導線露出は将来判断」を解消)**: `AuthorizedUser.isDemoGuest` + `getCurrentUserIsDemoGuest()` を追加し、demo ゲスト時のみ設定ダイアログ footer の Sign out (セッションなしでは no-op) を `/login?next=<現在ページ>` への Sign in リンクに差替え ([changelog-footer.tsx](src/components/portal/settings/changelog-footer.tsx))。本番サイト / demo の実セッション owner / dev bypass は Sign out のまま完全互換
  - **インフラ作業 (コード外、2026-06-10 実施済)**: (a) demo Vercel production env の空 placeholder 3 値 (`DISCORD_BOT_TOKEN` / `DISCORD_GUILD_ID` / `DISCORD_ADMIN_ROLE_IDS`) に本番 (yurutto) の実値をコピー — ⚠ CLI 製 production env は Sensitive 型になり `env pull` で読み戻し不可 (空に見えるが値は入っている) / (b) demo Supabase (`lspimctpoolzzikpixpc`) の Discord provider 有効化 (本番と同一 Discord アプリ `1497959750745198733` の Client ID/Secret) + URL Configuration (Site URL = demo ドメイン、Redirect URLs 4 件 — 未設定だと OAuth 後に localhost:3000 へ戻される) / (c) Discord Developer Portal の OAuth2 Redirects に demo callback を追加 (本番 redirect 無改修)。⚠ env 変更の反映は同一 commit の `vercel redeploy` が deploymentId 重複 (next.config.ts の skew protection) で不可のため、空 commit PR (#170) で deploy を発火させた
  - **検証**: `npx tsc --noEmit` PASS / `npm run build` ✓ / dev preview で匿名ゲストの無 redirect read-only + dev bypass 優先 (demo 併用時 admin 視点) を実測 / demo 実機で owner ログイン → 編集 UI 表示 (コンテンツ追加 / メンテナンス / DnD) → リンク追加・削除成功 (admin gate + RLS 通過) → ゲスト状態で Sign in 導線表示 + read-only 無変化、を確認 OK (2026-06-10)

- **2.6 (2026-06-10)**: TODO #90 クローズ — SubTabs の active tab がモバイル初期表示で画面外に出るケースの解消 (TODO #7 監査の見送り所見から同日起票 → 実装) ([PR #165](https://github.com/yyamazaki-lym/raid-repository/pull/165) 起票 / [PR #166](https://github.com/yyamazaki-lym/raid-repository/pull/166) 実装 squash merge `05311d8`、本番スマホ実機確認 OK)
  - **発端**: SubTabs のタブ列 (`overflow-x-auto`、scrollbar 非表示) は `scrollLeft=0` 始まりのため、モバイル幅では右端寄りの「動画」「マクロ」を開いた時に active tab が画面外となり現在地が視認できなかった
  - **変更内容** [src/components/portal/sub-tabs.tsx](src/components/portal/sub-tabs.tsx): `useEffect` (`pathname` 依存) で active tab (`data-active="true"`) が可視範囲から**見切れている時だけ** `ul.scrollLeft` を直接代入して中央へ寄せる。見えていれば no-op (クリック時の視覚ノイズ回避)、overflow しない desktop も常に no-op
  - **設計判断**: `scrollIntoView` は祖先の縦スクロールも動かし stuck/unstuck hysteresis (TODO #56/#58) や Link onClick の `window.scrollTo(top)` (TODO #58 part2) と干渉しうるため不使用 (`scrollLeft` 代入は横軸のみで独立)。`offsetLeft` も offsetParent が sticky な `<nav>` になるため使わず、`getBoundingClientRect()` 差分 + 現 `scrollLeft` で算出。範囲外の代入値は browser が自動 clamp
  - **検証**: `npx tsc --noEmit` PASS / `npm run build` ✓ / dev preview で (a) 375px マクロ直アクセス → `scrollLeft=134` + active 可視、(b) 先頭タブ → `scrollLeft=0` 維持、(c) 広幅 → no-op を実測 / 本番スマホ実機確認 OK (2026-06-10)

- **2.6 (2026-06-10)**: TODO #7 クローズ — モバイル幅 (375px) レイアウト監査 + 攻略タブ header の折返し spill 修正 ([PR #163](https://github.com/yyamazaki-lym/raid-repository/pull/163) squash merge `bde0163`、本番スマホ実機確認 OK)
  - **発端**: 1.9 系からの積み残し「スマホでのレイアウト崩れ確認」。dev preview を 375×812 に固定し、横 overflow 検出 script (viewport 外への protrude 要素を overflow-x スクロールコンテナ除外で列挙) + screenshot で、主要ページ全部 + dialog 4 種 (設定 / コンテンツ追加 / リンク追加 / 画像追加) + popover 2 種 (メモ / PT募集文) を横断監査
  - **監査結果**: 横 overflow はゼロ。schedule の出欠表 / 過去詳細表は横スクロールコンテナで正常、dialog は `max-w-[calc(100%-1.5rem)]`、popover は viewport 内 clamp。**唯一の崩れが攻略タブ section header** — 375px で「Links · N links · ドラッグで並び替え」+「サムネ」+「リンク追加」が flex 圧縮され、サムネ toggle のラベルが 1 文字ずつ折り返して h-7 固定 box から spill (縦積み表示)
  - **変更内容**: [strategy-list.tsx](src/app/(portal)/category/[slug]/strategy/strategy-list.tsx) + [strategy-images-list.tsx](src/app/(portal)/category/[slug]/strategy/strategy-images-list.tsx) の header 行を `flex-wrap` 化 + ドラッグヒントを `hidden sm:inline` (モバイル非表示) + サムネ / 折りたたみ toggle と [link-form-dialog.tsx](src/components/portal/link-form-dialog.tsx) / [image-form-dialog.tsx](src/components/portal/image-form-dialog.tsx) の defaultTrigger に `whitespace-nowrap` (+`shrink-0`)
  - **見送り所見**: SubTabs の active tab が画面外に出るケース (横スクロール自体は scrollbar 非表示で機能) → `scrollIntoView` 改善は将来候補、未起票 / native mode 画面は demo env が sync mode のため未監査 (mode 切替に DB 書込が必要) / 実機特有挙動 (iOS Safari URL bar / safe-area / touch) は本番スマホ実機確認でカバー
  - **検証**: `npx tsc --noEmit` PASS / `npm run build` ✓ / dev preview 375px で header 1 行表示 + 全ページ docOverflow 0 を再確認 / merge 後の本番スマホ実機でユーザー確認 OK (2026-06-10)

- **2.6 (2026-06-10)**: TODO #51 クローズ — マイクロインタラクション / ユーザビリティ向上 (portal 全体の体感 polish 1 周、観点 10 項目を P1〜P3 の 6 PR で完遂) ([PR #155](https://github.com/yyamazaki-lym/raid-repository/pull/155) 観点リスト / [PR #156](https://github.com/yyamazaki-lym/raid-repository/pull/156) P1 `1c5c5c4` / [PR #157](https://github.com/yyamazaki-lym/raid-repository/pull/157) P2-4 `dc2c6b4` / [PR #158](https://github.com/yyamazaki-lym/raid-repository/pull/158) P2-5 `e584288` / [PR #159](https://github.com/yyamazaki-lym/raid-repository/pull/159) P2-6+7 `5ad17d3` / [PR #161](https://github.com/yyamazaki-lym/raid-repository/pull/161) P3 `c9322dd`、全て squash merge + 本番実機確認 OK)
  - **発端**: 1.9 系から積み残しの横断 polish 項目。性能数値 (TODO #11) と切り分け、操作の体感品質 (press / hover / focus / loading / validation / 空状態) を portal 全体で 1 周する
  - **進め方**: 最初にコードベース横断調査 → 観点リスト + 優先順位付けを `.claude/todos/51.md` に作成 ([PR #155](https://github.com/yyamazaki-lym/raid-repository/pull/155))、P1 (効果大/リスク小) → P2 (設計必要) → P3 (質感/要否ユーザー判断) の 3 段階で phase ごとに 1 PR + changelog.ts 同梱
  - **変更内容 (phase 別)**:
    - **P1**: sonner Toaster の position/duration 明示化 + 文体規範策定 / 小型 trigger 11 箇所に `active:scale-95` press feedback (badge 系は `translate-y-px`) / focus-visible 欠落 3 箇所補修 (portal 既存の `ring-2` + neon 色パターンに統一)
    - **P2-4**: dialog 系保存 button 5 箇所 + onboarding card 2 箇所を settings section と同じ `busy ? <Loader2 spin> : <Save>` に統一
    - **P2-5**: [/category/loading.tsx](src/app/(portal)/category/loading.tsx) + [[slug]/loading.tsx](src/app/(portal)/category/[slug]/loading.tsx) を CSS-only (animate-pulse) Server Component で新設。SubTabs は layout 側のためタブ切替時はコンテンツ領域のみ skeleton 化
    - **P2-6+7**: [src/lib/url-validation.ts](src/lib/url-validation.ts) `httpUrlError()` helper + URL input 4 箇所の onBlur 即時 validation (`aria-invalid` 初活用で input primitive の destructive border が発火、inline field error + 入力し直しで即クリア) / [src/components/portal/empty-state.tsx](src/components/portal/empty-state.tsx) `<EmptyState tone="violet"|"neutral">` で空状態 4 箇所統一
    - **P3**: マクロ行 + 募集文テンプレート行 (アコーディオン行) に `hover:border-border/80` 補完 / [globals.css](src/app/globals.css) に transition duration 4 段規約 (micro=default 150 / popup-open=100 / panel=200 / page-fallback=300) をコメント明文化
  - **見送り判断 (ユーザー確認済)**: 観点 10 (framer-motion 活用拡大) は close transition 再追加禁止の制約下で費用対効果が低く見送り / toast 呼び出し 171 箇所の文言一括統一は regression リスクに見合わず見送り (新規コードの文体規範のみ策定) / `<SubmitButton>` 共通抽出は適用箇所が少なく見送り
  - **調査と実態の差分 (教訓)**: 初回調査の「card hover が弱い」「pending spinner なし」は primitive だけを見た過大評価で、使用側 (neon-edge + hover lift / settings section の spinner) は既適用だった。各 phase 着手時に対象を再調査し、欠落箇所の補完に絞った
  - **触らない範囲**: popover / tooltip / dropdown の close transition (再導入禁止リスト維持) / button.tsx primitive / DnD ハンドル (drag UX 干渉) / 初期 bundle (新規 client ライブラリ追加ゼロ、skeleton / EmptyState は server 互換)
  - **検証**: 各 PR で `npx tsc --noEmit` + `npm run build` + dev preview (skeleton は client navigation 中の出現を MutationObserver 実測、aria-invalid border は computed style 実測 — headless renderer の transition 凍結に注意) + 本番実機確認 OK (2026-06-10)
  - **規約の置き場所**: duration 4 段規約 = globals.css コメント / 観点リスト + 実装判断の経緯 = `.claude/todos/51.md` (クローズ済マーカー付きで温存)

- **2.6 (2026-06-10)**: TODO #85 クローズ — native placeholder の default 時刻遡及更新 (Default Raid Time 変更時に未来日付 placeholder を新値で自動更新、TODO #81 follow-up シリーズ最終) ([PR #153](https://github.com/yyamazaki-lym/raid-repository/pull/153) squash merge `05b70d3`)
  - **発端**: TODO #81 (2.1 / 2026-05-12) で `ensureNativeMonthlyPlaceholders()` が auto-insert する placeholder 行は `raw_date` 文字列に生成時の default 時刻を焼き込むため、admin が設定 dialog で default 時刻を変更しても既存 placeholder は旧 default のまま残る非対称があった。TODO #87/#88 (2.6) では UNIQUE 衝突回避が必要なためスコープ外として見送り → 本 TODO で JST 今日 0:00 以降の未来日付 placeholder を新値で自動再構成する経路を追加
  - **設計判断 (ユーザー確認済)**: 対象は **JST 今日 0:00 以降のみ** (過去 placeholder は履歴温存) / placeholder 判定は `created_by_id IS NULL AND start_time IS NULL AND end_time IS NULL` (手動追加行・個別 override 行は除外) / UNIQUE 衝突 (admin が新 default と同 raw_date を手動追加済) は **placeholder 側 DELETE で手動行温存** (user intent 尊重) / `schedule_session_memos.raw_date` は loose join なので UPDATE 分岐で同期 UPDATE・DELETE 分岐は温存 / 実装は SECURITY DEFINER RPC + `setNativeScheduleDefaultRaidTimeAction` の延長で自動同期、RPC 失敗は best-effort warn (`app_settings` 保存は既に成功済 → user データ損害なし)
  - **変更内容**:
    - **新規 SQL RPC** [supabase/schema.sql](supabase/schema.sql) Section 13d: `update_native_placeholder_raid_times(text, text) RETURNS jsonb`。PL/pgSQL LOOP で per-row UPDATE 試行 → `unique_violation` EXCEPTION で DELETE 分岐 → UPDATE 成功時のみ memo 同期。JST 今日 0:00 は `((now() AT TIME ZONE 'Asia/Tokyo')::date)::timestamp AT TIME ZONE 'Asia/Tokyo'`、日付 prefix は `substring(... FROM '^(\d{4}/\d{2}/\d{2}\([日月火水木金土]\))')`。GRANT EXECUTE TO authenticated のみ (anon 除外)
    - **server action 拡張** [src/lib/server/categories-actions.ts](src/lib/server/categories-actions.ts): `setNativeScheduleDefaultRaidTimeAction` の `app_settings` upsert 成功直後に `supabase.rpc(...)` を呼出、戻り値型を `{ ok: true; updatedCount; deletedCount; memoUpdatedCount } | { ok: false; reason }` に拡張 (`SetNativeScheduleDefaultRaidTimeResult` 型 export)
    - **UI 拡張** [native-default-raid-time-section.tsx](src/components/portal/settings/native-default-raid-time-section.tsx): 保存 toast を「デフォルト時刻を 20:00〜22:00 に変更しました (候補日 N 件を更新 / M 件を削除 (手動行と衝突))」形式に拡張 (両カウント 0 で末尾省略、M > 0 で衝突文言併記)
  - **触らない範囲**: `ensureNativeMonthlyPlaceholders()` の新規 auto-insert 経路 (新規挿入は引き続き新 default で生成) / CandidateDateDialog (`created_by_id` 明示 INSERT で placeholder 判定から除外される設計を温存) / `fetchNativeSchedule()` の COALESCE 表示 / sync 系 (`schedule_past_session_logs` 等) / `native_schedule_session_logs` (UUID FK で raw_date 非依存) は完全無改修
  - **副作用**: placeholder DELETE 分岐は `native_schedule_sessions` 1 行削除に閉じる (子テーブルは ON DELETE CASCADE で自動連鎖)。raw_date が新 default に揃っても popover trigger / status toggle / Discord notify button は全て id ベースで影響なし
  - **検証**: `npx tsc --noEmit` PASS / `npm run build` ✓ Compiled (18 routes、変化なし) / schema deploy は merge 時に GitHub Actions で本番 / demo 両環境へ自動適用 / merge 後の本番実機でユーザー確認 OK (2026-06-10)

- **2.6 (2026-06-10)**: TODO #89 クローズ — native スケジュールに FFLogs URL manual link 追加 / 削除 UI (TODO #73 follow-up) ([PR #151](https://github.com/yyamazaki-lym/raid-repository/pull/151) squash merge `6e28ebd`)
  - **発端**: TODO #73 (2.5 / 2026-06-10) で FFLogs ⇔ native 確定済セッション の auto-link 経路を実装し、TODO #86 (2.6 / 2026-06-10) で日次 cron 自動化まで揃ったが、auto-match が誤一致を返した時の手動削除経路と、cron が拾えなかった report を後追いで手動紐付けする経路が無かった (sync 側は TODO #64 で `session-memo-popover.tsx` 内に既実装、native だけ未対応の非対称状態)
  - **設計判断 (ユーザー確認済)**: native 専用 popover を新規作成 (sync 側 popover は無改修)。`session-memo-popover.tsx` の FFLogs URL editor block (L722-813) を縮約コピーして native 用に縮約。共通 helper 抽出は scope 拡大のため見送り、各 popover は独立。MVP として削除確認は `window.confirm` (sync 側の `createPortal` modal は後追い PR で揃える余地あり)
  - **変更内容**:
    - **新規 popover** [src/components/portal/native-schedule/native-fflogs-link-popover.tsx](src/components/portal/native-schedule/native-fflogs-link-popover.tsx): `+` icon trigger + popover content (既存 entries list: URL truncate + source badge `auto`/`manual` + 「開く」 external link + `×` 削除 / 新規 URL input + 「追加」 button)。client-side URL validate (`/^https?:\/\//i` + `/fflogs\.com\/reports\//i` の 2 段) + UNIQUE 衝突 up-front guard + optimistic state パターン (sync 側と同型)。TODO #72 教訓踏襲: `<Popover open={open} onOpenChange={setOpen}>` controlled + `{open && <PopoverContent finalFocus={false}>}` で close 時 DOM 残留を回避
    - **新規 server actions** [src/lib/server/categories-actions.ts](src/lib/server/categories-actions.ts):
      - `addNativeSessionLogsUrl(nativeSessionId, logsUrl)`: admin gate + URL validate + `native_schedule_session_logs` に `source='manual'` INSERT + UNIQUE 違反 (23505) を「同じ URL が既に紐付いています」に変換 + `revalidatePath('/')`。sync 側と異なり parent row の placeholder INSERT は不要 (DECISION 化済の session に対してしか trigger UI が出ない = parent は必ず存在)
      - `deleteNativeSessionLogsUrl(id)`: admin gate + id ベースで DELETE + `revalidatePath('/')`。auto 行も削除可能 (誤 auto-match の inline 掃除、ただし next cron で再 INSERT、manual のみ恒久削除)
    - **配線** [src/components/portal/schedule-list.tsx](src/components/portal/schedule-list.tsx): SessionRow の date cell の `SessionActionIcons` 直後に `<NativeFflogsLinkPopover>` を 4 条件 AND (`mode === 'native' && isAdmin && session.status === 'DECISION' && nativeSessionId`) で mount。past / 未来両方の DECISION 行に出す
  - **触らない範囲**: schema 変更なし (`native_schedule_session_logs` は TODO #73 で準備済) / `linkReportsToNativeSessions()` (auto link 経路) / cleanup の `source='auto'` wipe / `fetchNativeSessionLogsByDate()` (read 経路) / `SessionActionIcons` 共通 component / sync 側 `session-memo-popover.tsx` の FFLogs URL editor は完全無改修。sync mode では mount 条件で trigger 非表示 = sync 経路完全互換
  - **副作用**: cron 再走時に `source='auto'` 行は wipe → re-INSERT されるが `source='manual'` 行は温存されるので、admin 手動追加 URL は cron 自動化 (TODO #86) と共存。auto 行を `×` で削除しても次回 cron で再 INSERT (auto cleanup → re-INSERT パターン維持)、admin が「常に消したい」誤 auto-match は FFLogs OAuth 側の対応が必要
  - **検証**: `npx tsc --noEmit` PASS / `npm run build` ✓ Compiled (18 routes、変化なし) / merge 後の本番実機 (yurutto) でユーザーが (a) admin で native DECISION 行に `+` icon、(b) popover open + 既存 entries 表示 + 新規 URL 追加 + `×` 削除を確認
- **2.6 (2026-06-10)**: TODO #88 クローズ — placeholder 自動生成タグ (auto chip) + native session note 編集 UI (TODO #81 follow-up 2-in-1 合流) ([PR #149](https://github.com/yyamazaki-lym/raid-repository/pull/149) squash merge `aa69323`)
  - **発端**: TODO #81 (2.1 / 2026-05-12) で `ensureNativeMonthlyPlaceholders()` の auto-insert 行と、admin が CandidateDateDialog から手動追加した候補日が UI 上区別できない問題、および日個別 note (備考) を後から編集する経路が無い問題 (作成時の insert でしか設定できない) の 2 件をまとめて解消
  - **設計判断 (ユーザー確認済)**: (a) placeholder 判定列を新規追加せず **`created_by_id IS NULL` を auto シグナル** に採用 — `ensureNativeMonthlyPlaceholders()` は service_role で `created_by_id` 不指定 INSERT、`createNativeScheduleSessionAction()` は `auth.user.discordId` を明示 INSERT という既存挙動の差分を利用、schema 変更不要。(b) 既存 `SessionTimeEditPopover` を **拡張して時刻 + note を 1 popover で同時編集** — 専用 popover 新設は scope 拡大のため避け、admin UI の hit area を増やさない方針。rename は scope 抑制で見送り、役割拡張のみ
  - **変更内容**:
    - **型拡張** [src/lib/schedule/parse.ts](src/lib/schedule/parse.ts) `NativeScheduleMeta`: `autoGeneratedByRawDate: Record<string, boolean>` + `noteByRawDate: Record<string, string | null>` を追加
    - **fetcher 拡張** [src/lib/schedule/native-fetch.ts](src/lib/schedule/native-fetch.ts): `NativeSessionRow` 型と SELECT 列に `created_by_id` / `note` を追加、`nativeMeta` 構築で `autoGeneratedByRawDate[raw_date] = created_by_id === null` と `noteByRawDate[raw_date] = note` を組立
    - **新規 chip** [src/components/portal/native-schedule/auto-generated-badge.tsx](src/components/portal/native-schedule/auto-generated-badge.tsx): `<span>` ベースの小型 chip (font-mono `auto` / muted-foreground tinted border)。aria-label + title で「placeholder (admin が時刻 / 確定状態を編集可)」と明示
    - **新規 server action** [src/lib/server/native-schedule-actions.ts](src/lib/server/native-schedule-actions.ts) `updateNativeScheduleSessionNoteAction({ sessionId, note })`: admin gate + trim + 空文字 NULL 正規化 + 200 文字制限 (CandidateDateDialog の Textarea maxLength と整合)
    - **popover 拡張** [src/components/portal/native-schedule/session-time-edit-popover.tsx](src/components/portal/native-schedule/session-time-edit-popover.tsx): `note: string | null` Props 追加、popover 内に Textarea (`rows={2}` / `maxLength={200}`) を追加。Save 時に「時刻 diff」「note diff」「両方」「無差分」で対応 action を呼び分け、無差分時は API 呼び出しゼロで close。「default に戻す」button は時刻専用 (note は空文字 save で NULL 化、別経路) で挙動維持
    - **配線** [src/components/portal/schedule-list.tsx](src/components/portal/schedule-list.tsx): `resolveAutoGenerated(rawDate)` / `resolveNativeNote(rawDate)` resolver 追加、3 つの `<SessionRow>` 呼出 (upcoming / recentPast / olderPast) で `isAutoGenerated` + `nativeNote` を drill。SessionRow Props 型に 2 値追加、時刻 span 直後に `mode === 'native' && isAutoGenerated` ガードで `<AutoGeneratedBadge>` mount。Time edit popover trigger に `note={nativeNote}` を drill
  - **触らない範囲**: `ensureNativeMonthlyPlaceholders()` の INSERT (`created_by_id` 不指定の現状維持で auto シグナルとして使う前提) / `createNativeScheduleSessionAction()` の `created_by_id` 明示 INSERT / `updateNativeScheduleSessionTimeAction()` (時刻専用は完全互換) / `SessionStatusToggle` / `SessionDiscordNotifyButton` / `SessionMemoPopover` (別テーブル `schedule_session_memos`) / schema 変更 (`created_by_id` / `note` 列 / RLS は既存)。sync mode では `nativeMeta` undefined で chip mount スキップ + Textarea にも到達しない (sync 経路完全互換)
  - **副作用**: past 行でも auto chip は表示 (placeholder と手動候補の区別は運用追跡に有用)。past 行 / 非 admin では Time edit popover 自体が出ないため note 編集導線も自動的に塞がる
  - **見送り**: default time 変更後の過去 placeholder の **遡及更新は本 PR スコープ外** = TODO #85 として「未完了 TODO 一覧」🗓 スケジュールページ section に新規起票 (UNIQUE 衝突回避が必要、大規模)
  - **検証**: `npx tsc --noEmit` PASS / `npm run build` ✓ Compiled (17 routes、変化なし) / merge 後の本番実機 (yurutto) でユーザーが (a) placeholder 行の auto chip 表示、(b) clock icon → 時刻 + note の同時編集を確認
- **2.6 (2026-06-10)**: TODO #87 クローズ — 候補日追加 dialog (`CandidateDateDialog`) の時刻初期値を app_settings default に追従 (TODO #81 follow-up) ([PR #148](https://github.com/yyamazaki-lym/raid-repository/pull/148) squash merge `de35cb0`)
  - **発端**: TODO #81 (2.1 / 2026-05-12) で native スケジュールに当月日付の placeholder auto-insert と admin 編集可能な default 開始/終了時刻 (`app_settings.native_schedule_default_start_time` / `..._end_time`) を導入したが、候補日追加 dialog (`CandidateDateDialog`) の時刻 input は `"21:00"` / `"23:00"` を hardcode したままで、admin が default 時刻を変更しても候補日追加 dialog では旧 default のまま表示される非対称な状態だった
  - **変更内容**:
    - **新規** [src/lib/schedule/native-defaults.ts](src/lib/schedule/native-defaults.ts): `NATIVE_DEFAULT_*_KEY` / `FALLBACK_DEFAULT_*` (`"21:00"` / `"23:00"`) の純粋定数を切り出し。元の定義場所だった `src/lib/server/native-schedule-placeholders.ts` は `import "server-only"` のため Client Component から import 不可で build エラーになるため、定数だけを server/client 両境界から import 可能な `.ts` モジュールに分離
    - **編集** [src/lib/server/native-schedule-placeholders.ts](src/lib/server/native-schedule-placeholders.ts): 4 定数の定義を削除し新ファイルから re-export に置換 (既存呼び出し側 page.tsx / native-admin-client.ts は無改修で動作)
    - **編集** [src/components/portal/native-schedule/candidate-date-dialog.tsx](src/components/portal/native-schedule/candidate-date-dialog.tsx): `defaultStartTime?: string | null` / `defaultEndTime?: string | null` props 追加、`normalizeTime(value, fallback)` ヘルパで「未指定 / 空文字 / 無効な HH:MM」を `FALLBACK_DEFAULT_*` にフォールバック (graceful degrade)。`useState` 初期値と `useEffect` の open リセット時に props 由来へ
    - **編集** [src/components/portal/schedule-page-body.tsx](src/components/portal/schedule-page-body.tsx): `nativeDefaultStartTime?: string | null` / `nativeDefaultEndTime?: string | null` props を追加して drill
    - **編集** [src/app/(portal)/page.tsx](src/app/(portal)/page.tsx): 既に `fetchAppSettings([..., NATIVE_DEFAULT_*_KEY])` で取得済の 2 値を `<SchedulePageBody>` に drill
  - **触らない範囲**: `ensureNativeMonthlyPlaceholders()` の placeholder 生成ロジック / app_settings save 経路 (`setNativeScheduleDefaultRaidTimeAction`) / `<input type="time">` native 挙動 / TIME_RE validate / rawDate-parsedDate 組立式 / 深夜またぎ判定は無改修。schema 変更も無し。candidate-date-dialog の他 form (date / 備考 textarea) も無改修
  - **副作用**: 既に作成済の placeholder 行の遡及更新は本 PR スコープ外 (TODO #85 として別 TODO 化)
  - **検証**: `npx tsc --noEmit` PASS / `npm run build` ✓ Compiled (17 routes、変化なし) / merge 後の本番実機で「設定 dialog で default 時刻変更 → 候補日追加 dialog で新 default 値が初期表示」をユーザー確認
- **2.6 (2026-06-10)**: TODO #86 クローズ — FFLogs 連携の日次 cron 自動化 (`/api/cron/fflogs-sync`、UTC 19:00 = JST 04:00 daily) (TODO #73 follow-up) ([PR #147](https://github.com/yyamazaki-lym/raid-repository/pull/147) squash merge `f69c2c2`)
  - **発端**: TODO #73 (2.5 / 2026-06-10) で FFLogs ⇔ 動画 / sync 過去セッション / native 確定済セッション の auto-link 経路を実装したが、起動は admin が settings dialog の「FFLogs と動画を連動」button を押した時のみで、運用面では admin が毎日手動押下する負担があった。日次自動化で運用負荷を解消
  - **設計判断 (ユーザー確認済)**: 頻度 = **日 1 回** (FFLogs 自身が raid 後の日次 upload 中心、毎時発火は過剰 + Vercel Hobby cron sub-daily 制約)。発火時刻 = **UTC 19:00 = JST 04:00** (既存 import-discord 01:00 / snapshot-schedule 21:50 と被らない深夜帯)。経路 = **Vercel cron** (1 行追加で済む、pg_cron 経由は毎時発火が必要な場合のみ)
  - **変更内容**:
    - **新規** [src/app/api/cron/fflogs-sync/route.ts](src/app/api/cron/fflogs-sync/route.ts): GET ハンドラ。`assertCronAuth(req, 'cron/fflogs-sync')` で auth → `fetchAppSetting('fflogs_cron_enabled') === 'false'` で skip (未設定 / 'true' は実行 = **fail-open**) → `linkFflogsReportsToVideos()` 呼出。`runtime: 'nodejs'` / `dynamic: 'force-dynamic'` / `maxDuration: 300` (既存 cron 3 系統と揃え)。`linkFflogsReportsToVideos()` が `ok: false` を返した場合 (OAuth token 期限切れ / FFLogs API 障害) は 200 で silent skip + `console.warn` (Vercel cron は 5xx で retry する仕様、503 を返すと token 失敗時に再試行ループに陥るため)
    - **編集** [vercel.json](vercel.json): `crons` 配列に `{ path: '/api/cron/fflogs-sync', schedule: '0 19 * * *' }` を追加
    - **編集** [src/lib/server/cron-auth.ts](src/lib/server/cron-auth.ts): JSDoc の cron スケジュール表に新 route 行を追加 + 「fflogs_cron_enabled で skip / OAuth 失敗時は 200 silent skip」運用注を追記
  - **ON/OFF toggle UI は本 PR スコープ外**: `app_settings.fflogs_cron_enabled` は未設定なら fail-open で動作 (= 何もせず cron は走る)、明示停止が必要なら admin が Supabase Dashboard で `value='false'` を直接 set する運用。UI Switch は将来余地として `fflogs-sync-section.tsx` に追加候補 (TODO #2 phase 4 の `native-discord-notify-section.tsx` パターン踏襲) → **2026-06-12 [PR #195](https://github.com/yyamazaki-lym/raid-repository/pull/195) で追加完了** (上の 2.9 entry 参照)
  - **触らない範囲**: `linkFflogsReportsToVideos()` 本体 (admin button から呼ばれる既存経路と共有) / 既存 cron 3 系統 / pg_cron / Supabase vault 設定 / `fflogs-sync-section.tsx` UI / admin の手動 button 経路は完全無改修 (cron と手動 button は両立)
  - **検証**: `npx tsc --noEmit` PASS / `npm run build` ✓ Compiled (`/api/cron/fflogs-sync` 含む 18 routes、すべて ƒ Dynamic) / merge 後の本番 deploy 後にユーザーが Vercel Dashboard → Cron Jobs から手動 Run で 200 OK + 結果 JSON 確認
  - **継続観察**: UTC 19:00 (JST 04:00) の自動発火確認は **24h 観察** で別途追跡 (Vercel Functions logs の `[cron/fflogs-sync]` ログ)。観察完了 + UI Switch 追加の要否判断はユーザー判断 → **両方完了**: 自動発火は 2026-06-12 DB 実測確認 (保留オペレーション項目 3)、UI Switch は [PR #195](https://github.com/yyamazaki-lym/raid-repository/pull/195) で追加 (2026-06-12)
- **2.5 (2026-06-10)**: TODO #73 クローズ — FFLogs 連携 native 拡張 (status='DECISION' な native session への auto-link 経路実装) ([PR #145](https://github.com/yyamazaki-lym/raid-repository/pull/145) squash merge `9c051f0`)
  - **発端**: TODO #2 で native スケジュール基盤を実装した時点で意図的に切り離していた FFLogs auto-link 経路を埋める。従来は `linkReportsToSessions()` が `schedule_past_sessions` (sync 専用) 直読みで、native mode の確定済 sessions には FFLogs アイコンが一切出ない状態だった
  - **設計判断 (ユーザー確認済)**: D1=**別テーブル新設** (`native_schedule_session_logs`、sync 側 `schedule_past_session_logs` と並列構造、FK ターゲット `native_schedule_sessions.id` UUID PK)、D5=**auto-link のみ実装** (manual UI は本 TODO スコープ外、sync 側も未実装なので native だけ先行しない)
  - **schema** [supabase/schema.sql](supabase/schema.sql) Section 5f: `native_schedule_session_logs` (id PK / native_session_id UUID FK ON DELETE CASCADE / url / source CHECK('auto'|'manual') / created_at / UNIQUE(native_session_id, url) + index)。Section 7 RLS ループ / 7b REPLICA IDENTITY FULL / 8 Realtime publication にも追加
  - **fflogs.ts refactor + native wrapper** [src/lib/server/fflogs.ts](src/lib/server/fflogs.ts):
    - `FflogsLinkResult` 型に `nativeSessionsScanned` / `nativeSessionsMatched` 追加
    - cleanup 段階に `native_schedule_session_logs` WHERE `source='auto'` 並列 wipe を追加 (sync と対称)
    - 共通 helper `MatchingSession<T>` 型 + `matchReportsToSessions<T>()` (同 JST 日 + 時間差スコア greedy 1:1 ペアリング、1.9.24 由来挙動を完全踏襲) + `buildSessionLinkDetail<T>()` フォーマッタを抽出。これで「`schedule_past_sessions` 直読みからの脱却」(TODO #73 元文言) も達成
    - `linkReportsToSessions()` を helper 経由に refactor (外部 API 完全互換、sync regression なし)
    - `linkReportsToNativeSessions()` 新規 (DECISION のみ対象、`alreadyLinked` Set は native_session_id ベース、`native_schedule_session_logs` に source='auto' INSERT)
    - `linkFflogsReportsToVideos()` の `Promise.all` を 3 並列化 (video + sync session + native session)、戻り値オブジェクトに native フィールド + details 連結
    - `fetchNativeSessionLogsByDate()` 新規 (`native_schedule_sessions!inner(raw_date)` JOIN で sync 同 shape `rawDate → SessionLogEntry[]` を返す)
  - **UI 配線** [src/app/(portal)/page.tsx](src/app/(portal)/page.tsx): native ブランチの `Promise.all` に `fetchNativeSessionLogsByDate()` を追加、`SchedulePageBody` に prop drill (`sessionLogsByDate={{}}` → `sessionLogsByDate={nativeSessionLogsByDate}`)。TODO #77 で 過去詳細表 `mode!=='native'` ガード撤去済なので Logs アイコンは自動的に描画される
  - **その他**: [src/lib/server/categories-actions.ts](src/lib/server/categories-actions.ts) admin gate fallback 戻り値にも native フィールド追加。[src/lib/changelog.ts](src/lib/changelog.ts) に 2.5 (2026-06-10) entry を `RELEASES[0]` として追加 (機能追加で minor bump、ポータル左上 Ver も自動切替)
  - **触らない範囲**: `schedule_past_sessions` / `schedule_past_session_logs` の DDL / `native_schedule_sessions` 系既存テーブル / schedule-list.tsx / schedule-past-simple.tsx / schedule-page-body.tsx (map shape 不変) / FFLogs OAuth 経路 / video matching ロジック / cron 系すべて無改修
  - **検証**: `npx tsc --noEmit` PASS / `npm run build` ✓ Compiled (17 routes すべて Dynamic、変化なし) / schema 自動 deploy 両環境成功 ([本番 30s](https://github.com/yyamazaki-lym/raid-repository/actions/runs/27244999430) / [demo](https://github.com/yyamazaki-lym/raid-repository/actions/runs/27244999438)) / ユーザー実機で publication 登録 (`SELECT FROM pg_publication_tables` で `native_schedule_session_logs` 確認) + FFLogs 同期 button 押下でエラーなく完走を確認、`nativeSessionsMatched=0` は「新たな FFLogs report が存在しないだけ」とユーザー判断 (= マッチロジックは健全動作)
  - **follow-up**: manual link UI (`source='manual'` 追加 / 削除) は将来余地、別 TODO 化判断はユーザー。sync 側の manual UI も同様に未実装。auto cron 化 (admin button を待たず時間トリガー化) も検討余地あり
  - **設計プラン**: `~/.claude/plans/todo-jiggly-feigenbaum.md`
- **2.4 (2026-06-10)**: TODO #2 24h 観察フェーズ完了 (項目 2-iv ✅、項目 2 全体クローズ) + 観察過程で発覚した cron jobid 採番副作用の構造修正 ([PR #142](https://github.com/yyamazaki-lym/raid-repository/pull/142) squash merge `deb4ad9` + [PR #143](https://github.com/yyamazaki-lym/raid-repository/pull/143) squash merge `cbf9dbe`)
  - **発端**: TODO #2 follow-up 保留オペレーション項目 2-iv (notify-native-schedule-hourly の 24h 自動運転観察) を消化する目的で本番 Supabase SQL Editor を実行、累計 **786 succeeded / 0 failed** (2026-05-08 06:00 UTC 〜 2026-06-09 23:00 UTC、期待値 ~792 に対し ~99% カバレッジ) を確認 → 項目 2-iv ✅ 化。観察過程で `cron.job_run_details` を固定 jobid=1 で見ると 2 件しか拾えない現象から、schema 再 deploy 毎に新規 jobid が採番される副作用が発覚 (1 ヶ月で jobid=1→4→5→6→7→8→9→11→12→13→14→15 と 12 回切替)
  - **PR #142 (docs only)**: 保留オペレーション節の項目 2-iv ✅ 化 + 項目 2 全体クローズ、jobid evolution 補注を追記 (将来の観察は `jobname` 単位 or `start_time` 範囲で jobid 跨ぎ集計するよう注意喚起)。観察 24h ウィンドウ単独でも jobid={1,4,5,6} の 4 jobid 跨ぎで **24 succeeded / 0 failed** で検収条件 (23–25 succeeded / 0 failed) 満たす
  - **PR #143 (schema fix + changelog)**: `supabase/schema.sql` Section 13 の cron 登録 DO block を `cron.unschedule + cron.schedule` から「jobname 既存判定 + 初回 `cron.schedule` / 既存時 `cron.alter_job(job_id, schedule, command)`」パターンに置換。alter_job は jobid を維持したまま schedule/command を上書きするため、schema 再 deploy 毎の jobid 採番が止まる。`c_schedule` / `c_command` を DO block 内 constant 変数化 + `$cmd$` delimiter で 2 path 共通化。changelog.ts に新 2.4 (2026-06-10) entry を `RELEASES[0]` として追加 (ポータル左上 Ver 表示も自動で 2.4 (2026-06-10) に切替)
  - **触らない範囲**: pg_cron / pg_net extension の `CREATE EXTENSION IF NOT EXISTS`、vault secret 経由 Bearer 取得ロジック、cron URL / schedule (`0 * * * *`) は無改修。Section 13b / 13c (sort_order RPC) も無改修。route 側 ([src/app/api/cron/notify-native-schedule/route.ts](src/app/api/cron/notify-native-schedule/route.ts)) / app_settings 系 / app コード全般も無改修。ENABLED='false'/'true' どちらでも挙動変化なし
  - **検証**: PR #143 merge 後の schema 自動 deploy ([本番 32s success](https://github.com/yyamazaki-lym/raid-repository/actions/runs/27243978619) / [demo success](https://github.com/yyamazaki-lym/raid-repository/actions/runs/27243978607)) → ユーザー実機 `SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'notify-native-schedule-hourly';` で **`jobid=15 / active=true` 維持** を確認、即時効果あり。長期確証は後続の main push 数回後も jobid=15 のままを確認する継続観察に委ねる
  - **保留オペレーション残作業**: 項目 1 (Discord 通知 ON/OFF トグル ON 切替 + 投稿到達確認) のみ ⏳ で残置、ユーザー判断で別タイミング着手
  - **過去 cron.job_run_details の扱い**: jobid 12 種にまたがる history record は cleanup なしで残置、観察観点ではむしろ jobid evolution の証跡として有用
- **2.4 (2026-06-09)**: セキュリティ全体監査 batch 1 (PR #135) の follow-up 3 件 (TODO #82 / #83 / #84) をまとめてクローズ ([PR #137](https://github.com/yyamazaki-lym/raid-repository/pull/137) squash merge `aac714f` + [PR #138](https://github.com/yyamazaki-lym/raid-repository/pull/138) squash merge `6b9b948` + [PR #139](https://github.com/yyamazaki-lym/raid-repository/pull/139) squash merge `4a54a0f` + [PR #140](https://github.com/yyamazaki-lym/raid-repository/pull/140) squash merge `8ef3b75`)
  - **発端**: PR #135 で punch list 化された Medium #6 (Vercel KV / Upstash Redis 化 = TODO #82) / `loot_items` 系 sort_order race (TODO #83) / Low #16 (CSP `'unsafe-inline'` nonce 化 = TODO #84) の 3 件をユーザー判断で同一セッション順次着手。各々独立 PR で投入し、merge 順序は #137 → #138 → #139 → #140 (KV_* env prefix follow-up)
  - **TODO #83 (PR #137, 🧹 リファクタ系)**: `recruitment_templates` / `category_macros` の `SELECT max(sort_order) → +1 → INSERT` JS 側 TOCTOU を、PR #135 と同パターンの SECURITY DEFINER RPC (`next_recruitment_template_sort_order()` / `next_category_macro_sort_order(p_category_id uuid)`) に置換。schema.sql Section 13c に追加 + anon/authenticated に EXECUTE GRANT。`recruitment-templates-client.ts` / `category-macros-client.ts` の create 関数を `supabase.rpc(...)` 呼び出しに差し替え。元 TODO 文言の `loot_items` / `mitigation_phases` / `mitigation_entries` / `strategy_docs` は schema.sql にテーブル定義だけ残る legacy で現行 portal に対応する insert UI が存在しない (mitigation_sheet_url 等の単一文字列カラム形式に移行済) ためスコープ外、将来 UI が復活する際に同パターンで追加する想定。categories-actions.ts の `nextImageOrder()` (`category_links` を kind IN image+gphoto で絞る特殊ケース) と `category_gphoto_albums` 末尾追加も同型 TOCTOU だが本 TODO 外で別 PR 候補
  - **TODO #82 (PR #138 + #140, 🚀 インフラ系)**: `src/lib/rate-limit.ts` を全面書き換え、`@upstash/ratelimit` の `fixedWindow` algorithm を採用 (`Ratelimit.fixedWindow(limit, '${windowMs} ms')`)。env (`KV_REST_API_URL` + `KV_REST_API_TOKEN` または `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` の二段 fallback、KV_* 優先) が両方セット済 → 分散 fixed-window、欠落 → in-memory fallback (per-instance per-IP)。Redis 障害時も fail-open で in-memory fallback (`console.warn` でログ)。Ratelimit instance は `(scope, limit, windowMs)` ごとに module-level Map cache。proxy.ts `applyRateLimit` を async 化、`await applyRateLimit(request)` で呼ぶ。`@upstash/redis` + `@upstash/ratelimit` package を dependencies に追加。**ユーザー側 1 回作業**: Vercel Dashboard → Storage → Marketplace で「Upstash for Redis」(旧 Vercel KV 後継) を Connect → `KV_REST_API_URL` / `KV_REST_API_TOKEN` が自動注入 → 再 deploy。**PR #140 (follow-up)**: 初版 PR #138 では `UPSTASH_REDIS_REST_*` prefix のみを参照していたが、ユーザーが Marketplace 経由で連携した結果 env は `KV_REST_API_*` prefix で注入され (旧 Vercel KV 後継仕様)、`getRedis()` が env を見つけられず in-memory fallback に倒れる現象を発見、`KV_REST_API_URL ?? UPSTASH_REDIS_REST_URL` の二段 fallback に修正
  - **TODO #84 (PR #139, 🌐 サイト全体系)**: `script-src 'self' 'nonce-${nonce}'` パターンに移行 (production)、dev は `'unsafe-eval'` 追加 (React Refresh 用)。新規 `src/lib/csp.ts` に `generateCspNonce()` (32 byte UUID base64) + `buildCspHeader(nonce)` を切り出し。proxy.ts でリクエスト毎に nonce 生成 → request header (`x-nonce` + `Content-Security-Policy`) と response header (`Content-Security-Policy`) の両方に書き込む (Next.js は request 側 CSP から `'nonce-...'` パターンを拾って framework scripts に自動付与する仕様)。rate-limit / redirect / public path 全 return path に `withCsp()` ヘルパで CSP を載せる。`src/lib/supabase/middleware.ts` の `updateSession` に optional `initialRequestHeaders` 引数を追加し x-nonce 入り Headers を `NextResponse.next({ request: { headers } })` へ橋渡し。`src/app/layout.tsx` の `RootLayout` を async 化し `await headers()` で x-nonce 取得 → pre-hydration theme script の `nonce={...}` 属性へ焼く + `<script suppressHydrationWarning>` でブラウザの nonce 属性削除に起因する React 19 hydration mismatch を抑止。`next.config.ts` の静的 CSP を削除 (proxy.ts に統合)、他の securityHeaders (HSTS / X-Frame-Options / Referrer-Policy / X-Content-Type-Options / Permissions-Policy) は無改修
  - **触らない範囲 (3 PR 共通)**: style-src `'unsafe-inline'` は本セッションスコープ外で維持 (React `style={{...}}` props / Base UI / sonner / Tailwind v4 が広く inline style に依存、撤去には大規模改修が必要)。`'strict-dynamic'` は採用せず `'self'` を残して `@vercel/analytics` / `@vercel/speed-insights` の同一オリジン script (`/_vercel/insights/script.js`) を維持。RATE_LIMIT_RULES (limit / windowMs / 対象 path) は無改修
  - **副作用**: (a) CSP nonce 化により全 route が dynamic rendering 強制 — 元々 portal は全 route が ƒ (Dynamic) だったため static → dynamic 退化は無し、(b) Upstash 統合追加前は in-memory fallback で動作するため fork ユーザーが Vercel Marketplace 統合を入れていない環境でも portal は壊れない graceful degrade
  - **検証**: `npx tsc --noEmit` 0 errors / `npm run build` ✓ Compiled (17 routes + middleware すべて Dynamic) / dev preview で CSP ヘッダにリクエスト毎に異なる nonce が含まれること、`<script nonce>` に同値が焼かれること、`suppressHydrationWarning` で hydration エラーが消えること、theme class が pre-hydration script で正しく適用されることを確認。本番 (yurutto) deploy 後の実機検証で curl による Response Headers 確認 → `script-src 'self' 'nonce-...'` 確認 + `unsafe-inline` 撤去確認、`/api/page-title` 35 連打で 1-30 が `307` (未認証 redirect)、31-35 が `429` (rate-limit 発動) を確認 → 分散 store 動作の証拠。ユーザー側で #137 sort_order RPC は admin 操作 (募集テンプレ / カテゴリマクロ追加) で連番採番を実機確認
  - **deploy 結果**: schema deploy (#137) + Vercel 本番 (yurutto) Ready + demo Ready。ユーザー側で Vercel Marketplace の「Upstash for Redis」を本番プロジェクトに Connect 済 (Production / Preview / Development 全環境に KV_* env 注入確認済)
  - **follow-up**: (a) `loot_items` / `mitigation_*` / `strategy_docs` の sort_order race は legacy table で現状 JS 経路無いため別 TODO 化不要、UI 復活時に対応、(b) categories-actions.ts の `nextImageOrder()` 特殊ケースと `category_gphoto_albums` 末尾追加の sort_order race は同型だが優先度低で別 TODO 起票せず punch list 化のみ、(c) style-src 'unsafe-inline' 撤去 + Vercel Marketplace の他 storage / 別 region 検討は将来余地
  - **設計参考**: `node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md` (Next.js 公式 CSP nonce ガイド)
- **2.3 (2026-06-09)**: セキュリティ全体監査 batch 1 — Critical 5 件 + Medium/Low 6 件をまとめてクローズ ([PR #135](https://github.com/yyamazaki-lym/raid-repository/pull/135) squash merge `12ff809`)
  - **発端**: ユーザー要望「全体を見てバグやセキュリティが甘い部分、動作的に問題がありそうな部分など、運用するにあたって支障が出そうなものがあれば修正していきたい」を受け、Workflow ベースの 10 次元 fan-out 監査を試みたが schema 出力リトライ失敗で停止。主要ファイルを直接精読して 16 件 (Critical 5 / Medium 6 / Low 5) の punch list を作成 → ユーザー選択で Critical 5 件を 1 PR、追って Medium #11+#9 / Medium #7+#8+#14+#10 / Low #12+#13 を順次同 branch に積み、最終的に 1 PR でまとめて投入
  - **Critical 5 件 (PR #135 part 1)**: (a) `/api/auth/fflogs/*` (start / callback / disconnect) に `assertAdminResult()` admin gate 追加 — Route Handler は next-action 自動 CSRF が効かないので Server Action と同等の認可が必須、(b) FFLogs OAuth state を `app_settings` グローバル単一行 → HttpOnly cookie に移行 — multi-user OAuth 衝突 + anon SELECT 経由 state 漏洩を一括解消、(c) `/api/page-title` に SSRF + body-size + rate-limit ガード — `isPublicHttpUrl()` で IPv4/IPv6 private 範囲 (10.x / 127.x / 169.254.x / 172.16-31 / 192.168 / `::1` / `fe80::` / `fc..` / `fd..` / `[..]` brackets) + 内部 zone (localhost / .local / .internal) を遮断、`redirect: "manual"` で 1 hop だけ手動 follow、body は `getReader()` chunked 読み取りで 1MB 上限到達で `cancel()`、proxy.ts `RATE_LIMIT_RULES` に `30 req/60s` ルール追加、(d) FFLogs token の `app_settings` 平文 fallback 完全撤去 — `SECRET_ENCRYPTION_KEY` 未設定 fork で書かれた平文 token が anon SELECT 全開のテーブルから browser 経由で覗ける問題を fail-closed 化で解消、`persistTokens()` は暗号化保存失敗時 `{ok:false}` で caller に伝搬、schema.sql 末尾に legacy plaintext key を一掃する idempotent DELETE 追加、(e) `userIsAdmin([])` を fail-open → fail-closed に反転 — env `DISCORD_ADMIN_ROLE_IDS` 未設定 fork で「全員 admin」になっていた経路を閉鎖、dev 環境では `DEV_BYPASS_ADMIN_ROLE_ID = '__dev-bypass-admin__'` 固定 ID 特例で env なしでも admin 視点を維持
  - **Medium 6 件 (PR #135 part 2-4)**: (#11) `src/lib/server/cron-auth.ts` 新規 — 3 cron route の `CRON_SECRET` + `x-vercel-cron` 認証ロジックを `assertCronAuth(req, label)` に集約、JSDoc に全 cron スケジュール表を 1 表で記載、(#9) 全 cron route の `maxDuration` を 60 → 300s に揃え (Discord import の pagination + enrichment で 60s 超になる事象を解消)、(#7) `discord-image-migrate.ts` を `redirect: "manual"` + `isDiscordCdnUrl` 再判定 (最大 2 hop) + `readBodyWithLimit` chunked 5MB guard に強化、(#8) `discord-import.ts` の Discord API エラー時の `reason` 文字列から body を除去して構造化メッセージのみに (詳細は `console.warn` 分離)、(#14) `maybeSetFirstClearAtAction` / `backfillFirstClearFromExistingVideos` に `assertAdminResult()` 追加 (fail-closed 化後の silent 空振り解消)、(#10) `next_category_sort_order()` / `next_category_link_sort_order(uuid, text)` SECURITY DEFINER RPC を schema.sql に追加 + `createCategoryAction` / `createCategoryLinkAction` / `discord-import.ts importChannel` の 3 箇所を `supabase.rpc(...)` 呼び出しに置換 (JS 側 TOCTOU を縮める、完全 atomic 化は将来 PR で `insert ... values (rpc())` まで踏み込む候補)
  - **Low 2 件 (PR #135 part 5)**: (#12) FFLogs OAuth token 交換失敗時の `reason` から body 文字列除去 (URL に echo されたとき制御文字 / token 様文字列が漏れない、詳細は `console.warn` 分離)、(#13) `cron-auth.ts` JSDoc に「route × schedule(UTC) × JST × 発火元 (Vercel/pg_cron) × 設定ファイル」テーブル形式で全 cron スケジュールを集約
  - **新規** [src/lib/server/cron-auth.ts](src/lib/server/cron-auth.ts) — `assertCronAuth(req, routeLabel)` + 全 cron スケジュール表 JSDoc
  - **編集** 17 files: `src/lib/server/{auth,fflogs-oauth,categories-actions,discord-import,discord-image-migrate,page-title}.ts` / `src/lib/{url-safe,changelog}.ts` / `src/proxy.ts` / `src/app/api/auth/fflogs/{start,callback,disconnect}/route.ts` / `src/app/api/page-title/route.ts` / `src/app/api/cron/{import-discord,snapshot-schedule,notify-native-schedule}/route.ts` / `supabase/schema.sql`
  - **触らない範囲**: Medium #6 (Vercel KV / Upstash Redis 化) は Marketplace integration のユーザー操作が必要なため別 PR (TODO #82 として 未完了 TODO 一覧 へ起票)。Low #15 (callback signOut on failure) / #16 (CSP 'unsafe-inline' nonce 化) は punch list で「現状で OK」と判定したが、CSP は将来余地として TODO #84 起票。`loot_items` / `mitigation_*` / `recruitment_templates` / `category_macros` 等の sort_order race も cron 並列書き込み無しの admin 手動経路なので TODO #83 として後回し
  - **副作用**: (a) `SECRET_ENCRYPTION_KEY` 未設定の deployment では FFLogs 連携が起動しなくなる — merge 前に本番 / demo 両環境の env 設定を必ず確認 (本 PR 完了時点で本番 yurutto は 41d 前から設定済み、demo は read-only 公開なので未設定で OK)、(b) `DISCORD_ADMIN_ROLE_IDS` 未設定 fork は本 PR 後に全員「編集不可」状態 — README / `.env.local.example` でも必須化を明記すべきだが、当 fork は既に設定済 (demo は意図的に空 = read-only) のため即時影響なし
  - **検証**: dev preview + curl で実測 — #11 cron 認証 (no auth / wrong bearer → 401、x-vercel-cron / 正規 bearer → 通過) / #3 SSRF (169.254.169.254 / 127.0.0.1 / localhost / 10.x / 192.168.x / `[::1]` / `[fe80::1]` / `[fc00::1]` / javascript: / file:// → 400、example.com → 200) / #3 rate limit (連打 30 超で 429 + retry-after) / #1 admin gate (非 admin → 403 / redirect、admin → 200 / OAuth flow) / #5 fail-closed (`DISCORD_ADMIN_ROLE_IDS=EMPTY + PUBLIC_DEMO_MODE` で roles=[] → userIsAdmin=false で書き込み 403)。`npx tsc --noEmit` 0 errors / `npm run build` ✓ Compiled (TypeScript clean + static gen 4/4 + 17 routes)。検証中に `URL.hostname` が IPv6 リテラルを `[::1]` (角括弧付き) で返すことを発見、bracket 剥がし 1 行 fix を同 PR に追加して再検証 PASS。#2 OAuth state cookie / #4 plaintext fallback 撤去 / #7 image migrate / #8 cron error body / #14 first_clear gate / #10 sort_order RPC はコードレビューでロジック確認 + 本番 merge 後の実機で fail-fast 確認
  - **deploy 結果**: schema deploy 両方 success (29s / 36s) + Vercel 本番 Ready (1m) + Vercel demo Ready。ユーザー実機確認 OK (admin 編集 / FFLogs 接続維持 / cron 認証)
  - **follow-up**: TODO #82 (Vercel KV / Upstash Redis rate-limit) / #83 (他テーブルの sort_order RPC 化) / #84 (CSP nonce 化) を新規起票。`loot_items` 系の sort_order race は cron 並列書き込み無しなので優先度低
  - **設計ドキュメント**: `~/.claude/plans/fizzy-petting-comet.md` (16 件 punch list 全体 + First PR 実装プラン + 動作検証方針)
- **2.1 (2026-05-12 part5)**: #81 native スケジュールで当月日付を auto-insert し空 row 状態を解消 — クローズ ([PR #100](https://github.com/yyamazaki-lym/raid-repository/pull/100) squash merge `ae55fd4`)
  - **発端**: TODO #77 (PR #94) で sync/native UI を flat 表に統一、TODO #80 (PR #96+#98) で `splitSessions` cutoff を「JST 今日 0:00」に揃えた後、native では `native_schedule_sessions` が当月分 0 件のままだと「予定なし」表示になり当月日付一覧がそもそも視認できない問題が残っていた。yurutto 本番 native は「Discord 通知時に候補日を都度追加」する運用で row が積まれていないのが常態
  - **採用方式 (ユーザー確認済み 3 点)**: (1) 実装方式 = **DB に空 row を auto-insert** (placeholder 擬似生成ではない、実 row 化により出欠 / 通知 / status toggle が普通に動く)、(2) 日付範囲 = JST 今日 0:00 〜 当月末日、当月末日まで残り 7 日以内なら翌月末日まで延長、(3) 起動タイミング = page レンダー毎に点検 + 不足分 bulk INSERT (`ON CONFLICT (raw_date) DO NOTHING` で冪等、2 回目以降のアクセスは noop)、デフォルト時刻 = app_settings 新規キー 2 件 + settings dialog UI で admin が編集可能 (fallback `21:00`〜`23:00`)、出欠 / 通知ボタン = 日付行から両方表示 (実 row なので既存 UI ロジックが動く)
  - **新規** [src/lib/server/native-schedule-placeholders.ts](src/lib/server/native-schedule-placeholders.ts): `ensureNativeMonthlyPlaceholders(defaults)` server util。`createSupabaseServiceRoleClient()` で RLS バイパスし、JST 今日 〜 当月末日 (+ 末日 7 日前以降は翌月末日まで) の不足 raw_date を `upsert(rows, { onConflict: "raw_date", ignoreDuplicates: true })`。rawDate format は sync 互換 `YYYY/MM/DD(曜) HH:MM~HH:MM` (`schedule_session_memos` / `schedule_past_session_logs` と key 共有)。失敗時は `console.warn` のみで page render 続行 (`DYNAMIC_SERVER_USAGE` / `NEXT_*` digest は re-throw)
  - **新規** [src/components/portal/settings/native-default-raid-time-section.tsx](src/components/portal/settings/native-default-raid-time-section.tsx): admin 向け settings section。HH:MM input × 2 + 即時保存、`setNativeScheduleDefaultRaidTimeAction` を呼ぶ。`NativeChoiceValuesSection` / `NativeDiscordNotifySection` と同じ「親 prop → 子 useState 同期」パターン
  - **修正** [src/app/(portal)/page.tsx](src/app/(portal)/page.tsx): native ブランチで `fetchAppSettings()` に `NATIVE_DEFAULT_START_TIME_KEY` / `NATIVE_DEFAULT_END_TIME_KEY` を統合 fetch、`Promise.all` の後に `ensureNativeMonthlyPlaceholders()` → `fetchNativeSchedule()` の順次実行に組み替え (並列だと race で初回 read が空配列になる可能性)
  - **修正** [src/lib/server/categories-actions.ts](src/lib/server/categories-actions.ts): `setNativeScheduleDefaultRaidTimeAction({ startTime, endTime })` server action 追加。`assertAdminResult` gate + HH:MM regex validate (start !== end) + `app_settings.upsert([...], { onConflict: "key" })` + `revalidatePath("/")` best-effort
  - **修正** [src/lib/schedule/native-admin-client.ts](src/lib/schedule/native-admin-client.ts): `NativeAdminAux` 型に `defaultStartTime` / `defaultEndTime` 追加 (fallback `"21:00"` / `"23:00"`)、`fetchNativeScheduleAdminAux()` の `app_settings.in()` に 2 key 追加
  - **修正** [src/components/portal/settings-dialog.tsx](src/components/portal/settings-dialog.tsx): `mode === "native"` ブロックに `<NativeDefaultRaidTimeSection>` を 1 行配線 (`NativeCancelledSessionsSection` と `NativeDiscordNotifySection` の間)
  - **触らない範囲**: schedule-list.tsx (placeholder 用 ロジック追加なし、実 row として並ぶので既存描画が動く) / native-fetch.ts (SELECT は `status != CANCELLED` 全件のまま) / candidate-date-dialog.tsx (+ ボタン UI 既存挙動維持、初期値 `"21:00"`/`"23:00"` を app_settings default に揃える件はスコープ外で別 TODO 候補) / cron route (`status='DECISION'` トリガなので CANDIDATE placeholder は通知対象外) / FFLogs 連携 (TODO #73 スコープ) / supabase/schema.sql (seed insert pattern が既存に無いため fallback で吸収する判断、改修なし)
  - **副作用**: sync / disabled モードへの影響なし (修正箇所は `mode === "native"` ブロック内のみ)。raw_date UNIQUE で既存 admin 手動追加 row / DECISION 化済 / CANCELLED 化済の re-INSERT は全 skip。月跨ぎは page render 時 `Date.now()` ベースで自動更新。1 ヶ月 30 行 × 12 ヶ月 = 360 行/年で DB 容量は無視できるサイズ。複数 user 同時アクセス時は ON CONFLICT で race condition 解消。cron 自動通知は CANDIDATE placeholder を対象外、admin が DECISION 切替時に既存通り通知対象
  - **service_role 使用の妥当性**: auto-insert する内容は user 入力を一切受け取らず「当月日付 + app_settings 由来 default time」だけで決定的に生成するため、admin gate を通さずとも悪用余地がない。`createSupabaseServiceRoleClient()` の docstring 注意書き「assertAdminResult か CRON_SECRET 経由 auth」の例外として util の docstring で明示。非 admin user の page アクセス時にも placeholder を揃える必要があるため
  - **検証**: `npx tsc --noEmit` PASS / `npm run lint` baseline (35 errors / 2 warnings) 維持で本 PR 改修起因の新規 0 件 (新規 section の `useEffect` 同期パターンは `eslint-disable-next-line react-hooks/set-state-in-effect` で抑制し既存セクションと挙動揃え)。worktree dev preview は Supabase env 取得が別 terminal 必須のため本セッション内では未実施、merge 後の本番実機 (demo + yurutto) でユーザーが「見た目 OK」を確認
  - **follow-up**: ユーザー明言「機能面の修正・追加は新規会話で対応」。CandidateDateDialog の初期値を app_settings default に揃える件、placeholder 行で startTime/endTime/note を手動編集する UI、月切替 UI、placeholder の自動生成タグ表示、過去 default 時刻を新月分以降にだけ反映する遡及更新の有無、などを新規会話で別 TODO 化する想定
  - **設計ドキュメント**: `~/.claude/plans/todo81-claude-plans-todo80-generic-rossu-declarative-sprout.md`
- **2.1 (2026-05-12 part3+part4)**: #80 splitSessions cutoff を JST 今日 0:00 に変更し未来日付のみ upcoming に並べる (TODO #77 follow-up) — クローズ ([PR #96](https://github.com/yyamazaki-lym/raid-repository/pull/96) squash merge `3a64303` + [PR #98](https://github.com/yyamazaki-lym/raid-repository/pull/98) squash merge `e787ba1`)
  - **発端**: TODO #77 (PR #94) で sync/native 共通の `<ScheduleList>` に統一した後、月中視点で「当月の過去 candidate 日」がどこにも表示されなくなる問題が残った。例 (今日 = 2026-05-12) で 5/3 や 5/8 の candidate 行が `splitSessions` の cutoff (`Date.now() - 6h`) 以前に落ち、past バケットでは `s.status === "DECISION"` ガードで弾かれて非表示になっていた
  - **初版実装 (PR #96)**: cutoff を `now - 6h` → **JST 当月 1 日 00:00** に変更し、当月分は candidate / DECISION 区別なく全て upcoming に並ぶようにした。AskUserQuestion で「当月分は全部 upcoming に並べる (推奨)」回答に基づく実装
  - **本番実機 V1 で再調整 (PR #98)**: yurutto / demo sync 環境で確認したところ「過去日程 (例 5/12 視点の 5/07) が upcoming に並ぶのは直感に反する」とユーザー指摘。元 TODO 文言「同期式の挙動と揃える」を「当月分は全部 upcoming」と解釈したが、実機で見たユーザー期待は「未来日付だけ upcoming」だった。cutoff を **JST 今日 0:00** に再調整 (`Date.UTC(year, month, day, 0, 0, 0, 0) - JST_OFFSET_MS`)
  - **最終挙動**: 今日 0:00 JST 以降の row → upcoming、昨日以前の DECISION 行 → past (recentPast / olderPast)、昨日以前の non-DECISION 行 → 表示なし。当月の過去 candidate は再び消えるが、当月の過去 DECISION 行は過去詳細表 (Table icon) に並ぶので情報自体は失われない
  - **修正** [src/components/portal/schedule-list.tsx](src/components/portal/schedule-list.tsx): `splitSessions` 関数の cutoff 計算のみ差し替え。`JST_OFFSET_MS = 9h` を使う (既存 `discord-schedule.ts` / `native-schedule-discord.ts` と同パターン)
  - **問題 (b) 経過**: 元 TODO 文言にあった「過去 5月 DECISION 行が『2 ヶ月以上前』セクションに分類される」は、表示中 5月行が rawDate `'5/3'` 形式 (年抜き) で **2025-05** (約 1 年前) を 2026-05 と勘違いしたユーザー誤認と判明。実体は 1 年前なので `PAST_FOLD_THRESHOLD_MS = 60d` の olderPast 折り畳みが正しい振り分け。`PAST_FOLD_THRESHOLD_MS` / recentPast / olderPast / displayDate format は無改修で確定
  - **触らない範囲**: schedule-page-body.tsx / (portal)/page.tsx / native-fetch.ts / parse.ts / schema.sql / seed-demo.sql は touch なし。FFLogs 連携 (`sessionLogsByDate`) は TODO #73 のスコープなので無改修
  - **副作用**: `splitSessions` 呼び出し元は schedule-list.tsx 内 1 箇所のみ、`limit` は schedule-page-body.tsx の主呼び出しでは未指定。月跨ぎは `Date.now()` ベースで自動更新。Discord 通知 / cron / FFLogs は `splitSessions` を呼んでいないため横断的副作用なし
  - **検証**: `npx tsc --noEmit` PASS、`npm run lint` baseline (35 errors / 2 warnings) 維持で新規 0。worktree dev preview は Supabase env 取得が別 terminal 必須のため本セッション内では未実施、merge 後の本番 demo (sync) で「5/07 が upcoming から消え過去詳細表に並ぶ、今日以降のみ upcoming に並ぶ」を実機確認
  - **PR #98 後の follow-up TODO #81 起票**: 本番実機確認時に「native (yurutto) で日程自体が表示されていない」報告が別途あったが、調査の結果 yurutto 本番 native DB が当月 0 件 (運用上 Discord 通知時に候補日追加する流れ) で「TODO #77 のフラット表統一で当月 row が無いと『今後の予定はありません』表示になる」現象と判明。TODO #80 (splitSessions cutoff 調整) とは無関係の別 issue なので TODO #81 として分離起票
  - **設計ドキュメント**: `~/.claude/plans/todo80-generic-rossum.md`
- **2.1 (2026-05-12 part2)**: #77 native スケジュール UI を sync 同等のフラット表に統一 — クローズ ([PR #94](https://github.com/yyamazaki-lym/raid-repository/pull/94) squash merge `bbe3edf`)
  - **発端**: TODO #2 phase 2-B (2026-05-07) で native モードに `NativeMonthlySchedule` (月別 collapsible accordion) を導入したが、phase 2-C / 3+4 を経て機能が出揃った段階で「sync は 1 枚カードのフラット表 + 過去簡易 strip + 過去開催詳細表」「native は月別 accordion + 過去簡易 strip のみ (過去開催詳細表は `mode !== "native"` ガードで非表示)」と見た目・操作性が乖離。同じ portal なのに schedule が 2 種類別 UI という違和感が残っていた
  - **採用方式 (ユーザー確認済み 4 仕様)**: (1) 表示構造 = sync 式フラット 1 枚カードに統一 (`NativeMonthlySchedule` 廃止)、(2) 過去開催日時 = native でも Table icon 有効化、(3) プルダウン (status toggle + 出欠 popover) は既存実装を維持、(4) 2025-05 重複 row は SELECT で 0 件確認、本 PR スコープから除外
  - **修正** [src/components/portal/schedule-page-body.tsx](src/components/portal/schedule-page-body.tsx): `NativeMonthlySchedule` 経路を撤去し常に `<ScheduleList>` を呼ぶ一本道に、Table icon の `mode !== "native"` ガード撤去、amber バナー文言を最新機能状況 (候補日追加 / 出欠入力 / 確定切替 / Discord 通知が利用可能) に更新
  - **修正** [src/components/portal/schedule-list.tsx](src/components/portal/schedule-list.tsx): 月別 section 専用だった `monthFilter` prop / `toJstYearMonth` import / 関連分岐 (useFlatCard / splitSessions bypass / Legend 抑止) を削除、flat list 単一 path に縮約
  - **修正** [src/app/(portal)/page.tsx](src/app/(portal)/page.tsx): native ブランチの `Promise.all` に `fetchScheduleMemosByDateBulk()` + `fetchAppSettings([SCHEDULE_TOP_TEXT_OVERRIDE_KEY])` を追加し、`SchedulePageBody` に sync 同等の `initialMemosByDate` / `topTextOverride` を prop drill
  - **削除**: `src/components/portal/native-schedule/native-monthly-schedule.tsx` / `src/components/portal/native-schedule/monthly-section.tsx` / `src/lib/schedule/jst-month.ts` (callers が消えたため 3 ファイル削除)
  - **触らない範囲**: `native-fetch.ts` / `parse.ts` / `schema.sql` / `native-schedule-actions.ts` / 各 native UI 部品 (`candidate-date-dialog.tsx` / `native-attendance-popover.tsx` / `session-status-toggle.tsx` / `session-discord-notify-button.tsx`) は完全無改修。FFLogs 連携 (`sessionLogsByDate`) は TODO #73 のスコープなので native でも `{}` 維持
  - **検証**: `npx tsc --noEmit` PASS、`npm run lint` baseline (35 errors / 2 warnings) 維持で新規 0。worktree dev preview は Supabase env 取得が別 terminal 必須のため本セッション内では未実施、merge 後の本番 (demo + yurutto) 実機でユーザーが「開催日 / 過去簡易ログ / メンバー日程 / 過去詳細ログが表示」「これまでの 5月の表 2 つが消えた」を確認
  - **2025-05 重複 row 経過**: 元 TODO 文言では「2025 年 5 月 row 2 件のうち重複ノイズ側を本番 Supabase SQL Editor から DELETE」と記載していたが、実装フェーズで提示した確認 SQL (`SELECT ... FROM public.native_schedule_sessions WHERE parsed_date IN [2025-05-01 .. 2025-06-01)`) を本番で実行したところ 0 件、既に解消済と判明 (PR #80 / #82 経由で seed-demo.sql に逃がした効果が反映されていた)
  - **follow-up TODO #80**: 本番実機で残った 2 点の違和感を別 TODO に分離 — (a) デフォルトで当月日付リストを upcoming に並べる挙動、(b) 過去 5月開催日が「2 ヶ月以上前」セクションに分類される問題、を新規会話で実機を見ながら調整
  - **設計ドキュメント**: `~/.claude/plans/todo77-gleaming-gosling.md`
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
