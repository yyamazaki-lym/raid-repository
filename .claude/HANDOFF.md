# Raid Repository — 引き継ぎノート

> 2.1 (2026-05-02 part8) 時点。完了済 TODO の詳細は `src/lib/changelog.ts` / 過去版番号は `.claude/done.md`。
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

### TODO #65 残課題: dropdown スクロール時の3段階ちらつき (本番再現)

**現状**: `054859e` (PR [#12](https://github.com/yyamazaki-lym/raid-repository/pull/12)) + `0e60e6d` (PR [#13](https://github.com/yyamazaki-lym/raid-repository/pull/13)) で実装済。動作確認の結果、4 項目中 ① / ② / ④ は OK、③ のみ修正後も再現。

**症状 (本番、過去詳細表で確認)**: 動画/Logs アイコン dropdown を開いた状態で wheel スクロールすると、
1. スクロール中にポップアップが**1 度消える**
2. その直後に**1 度現れる**
3. 最終的に消える

= 単純な閉じきりではなく 3 段階の re-toggle が発生。

**現実装** ([src/lib/use-scroll-closing-menu.ts](src/lib/use-scroll-closing-menu.ts)): `modal={false}` + window scroll listener (capture phase 撤廃済) + 150ms grace period で controlled open。capture phase 由来のフォールスポジティブは排除した。

**仮説**:
- (a) Base UI Menu の controlled `open` と内部 state が非同期で、`setOpen(false)` 後に Base UI 側の outside-click / pointer-dismissal が再 open 検出 → 再 close の往復
- (b) Floating UI Positioner の autoUpdate が scroll で position 再計算 → mount/unmount 振動
- (c) React 19 の deferred state update でフレーム跨ぎの flicker、複数の連続 scroll event で setOpen(false) → setOpen(true) が交互に呼ばれる
- (d) Base UI 側の anchor tracking で trigger が viewport 外に出た時の anchorHidden 切替が再 mount を誘発

**次回着手案**:
1. 仮説検証: Chrome DevTools の Performance + console.log で何が起きてるか観察 (open state 推移 + Base UI data-state attribute 推移)
2. Strategy A — `disableAnchorTracking` を Positioner に渡し autoUpdate を切る (= a/b/d 切り分け)
3. Strategy B — 1 度 close したらしばらく再 open しないように guard する (lock state pattern)
4. Strategy C — `modal={false}` を捨てて modal モードに戻し、scroll を許可する別ルート (例: dropdown 全体を Popover に切替、Popover の `dismissOnPointerDown` 等を活用)

**次回開始テンプレ**:
```
TODO #65 残課題 (③ dropdown スクロール時のちらつき) を修正。

【症状再掲】過去詳細表で dropdown 開 → wheel scroll で 1 度消え → 1 度出 → 最終 close (3 段階)
【現実装】src/lib/use-scroll-closing-menu.ts (capture phase 撤廃 + 150ms grace period)
【仮説】Base UI Menu の controlled open と autoUpdate / outside-click の race
【手順】仮説検証 (DevTools 観察) → A/B/C のうち最小修正案を提案 → 実装

参考: HANDOFF.md 保留オペレーション、commits 054859e + 0e60e6d
```

## 📌 次回の作業優先度

未完了 TODO はユーザー選択。直近で起票された TODO #63 (動画 dropdown のマウスオーバーで動画タイトル tooltip 表示) は schedule-list の `SessionActionIcons` に手を入れるだけで完結する小規模改善。

## 未完了 TODO 一覧

ページ / 領域ごとに分類。番号は履歴上の通番なので連続しないが、`changelog.ts` の参照キーとしてそのまま維持する。

### 🗓 スケジュールページ (`/` = top)

| # | 項目 | 規模 |
|---|---|---|
| 2 | スケジュール表自前実装 (作成/編集/確定/Discord 通知) | 大 |
| 38 | スケジュール追加機能 — portal 内から開催候補日を追加する UI が無い。日付 + 時間帯 + 参加可否を入力 → DB 保存 → 描画。TODO #2 と統合可 | 中〜大 |
| 63 | TODO #1 で導入した動画 / Logs DropdownMenu の trigger アイコンに hover した際、動画タイトル (= dropdown item で表示している `videoTitle`) を tooltip で表示する。1 件時 (`<a>` / `<Link>` 直行ケース) も同様に tooltip 化したい。schedule-list.tsx の `SessionActionIcons` に手を入れるだけで完結 | 小 |

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
