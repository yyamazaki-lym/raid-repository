# 総合レビューレポート — Raid Repository（2026-06-13）

> 対象: FF14 レイド固定向けポータル（Next.js 16 / React 19 / Tailwind v4 / Supabase）
> 範囲: セキュリティ / プログラム挙動 / パフォーマンス / 冗長性 / Next.js 適合 / デザイン・審美

本レポートは 2 段階の精査を統合したもの:
1. **デザイン / 審美観点**（旧 `design-review-2026-06-12.md` を統合・収録）
2. **多角的コード精査**（セキュリティ・挙動・冗長性・パフォーマンス・Next.js 16 適合）

## 総評

設計品質は総じて**非常に高い**: 4 層認証 + fail-closed、全テーブル RLS 網羅、React `cache()` による
重複クエリ排除、`Promise.all` 徹底、Next.js 16 / React 19 適合ほぼ完璧、デッドコードほぼゼロ、
OKLCH ベースの 7 テーマ・glass morphism・motion 規約の明文化。
一方で **セキュリティに要対応 2 件（P0）** と、パフォーマンス・認可・冗長性・アクセシビリティに
中程度の改善余地がある。重大度は P0（緊急）/ 高 / 中 / 低。

---

# A. セキュリティ / 認可

### A-1.【P0】OAuth callback のオープンリダイレクト
`src/app/auth/callback/route.ts:114-119`（`sanitizeNextParam`）
`next` を「`/` 始まり・`//` でない」のみで検査するが、最終遷移は `new URL(next, req.url)`（同 :95）。
WHATWG URL はバックスラッシュを `/` と等価正規化するため、`?next=/%5Cevil.com`（= `/\evil.com`）が
sanitize を通過し **`https://evil.com/` に解決**（実機検証済み）。公開到達点でフィッシング誘導に悪用可能。
→ バックスラッシュ込みで拒否、または解決後 URL の origin が自オリジン一致かを検証。

### A-2.【P0】SECURITY DEFINER RPC が admin ゲートを迂回可能
`supabase/schema.sql:1321-1323`（`GRANT EXECUTE ... TO authenticated`）、本体 1211-1311
`update_native_placeholder_raid_times` は `authenticated` 全体に GRANT され、**関数内に admin 検査なし**。
SECURITY DEFINER で RLS をバイパスするため、非 admin の guild メンバーが自身の JWT で REST 直叩きすると、
admin 限定のはずの placeholder セッションの `raw_date` 書き換え・衝突行 DELETE・memo 追従書き換えが可能
（アプリ層 `categories-actions.ts:1443` の `assertAdminResult` を迂回）。
→ 関数冒頭で `is_admin` claim を検査して RAISE、または authenticated GRANT を剥がし service role 専用に。

### A-3.【中】非 admin の UPDATE/DELETE が silent fail
`category-macros-client.ts:73-107`、`recruitment-templates-client.ts:109-148`、
`schedule-memos-client.ts:94-111`、`schedule-top-text-store.ts:37-74`
RLS の UPDATE/DELETE は `USING` で行が見えなくなるだけなので、非 admin 実行時は
**0 行更新 + error=null → `{ok:true}` + 成功 toast**（INSERT は `WITH CHECK` で正しくエラー）。
→ `.select("id")` を付け返却 0 件を `{ok:false}` 扱いに、または Server Action 化して事前に弾く。

### A-4.【中】`schedule_session_memos` の意図と RLS の不整合
`schedule-memos-client.ts:6-13` / `schema.sql:367-371`（「全員が編集可」と記述）vs 実ポリシー（is_admin 必須）。
UI（`schedule-list.tsx:1229`）は isAdmin ゲートなしで編集導線を全員に表示 → 非 admin は作成エラー/編集 silent fail。
→ 意図を確定し、ポリシー追加か UI 非表示 + コメント修正。

### A-5.【中】冪等性の弱点 2 件（at-least-once cron で二重化し得る）
- Discord import の dedupe が SELECT→INSERT で非原子的、`category_links` に `(category_id,kind,url)` の
  UNIQUE なし（`discord-import.ts:304-312` / `schema.sql:146-156,221-222`）→ cron×手動の競合で二重挿入。
  → UNIQUE 制約 + `onConflict DO NOTHING` の upsert 化。
- native 通知が POST→`last_notified_at` UPDATE 間にロックなし（`native-schedule-discord.ts:148-216`）
  → 長時間実行が時境界をまたぐと二重通知。`update ... where last_notified_at is null` の先取り更新で保証可。

### A-6.【中/受容】page-title の SSRF が DNS rebinding 未対応
`url-safe.ts:108-113` / `page-title.ts:65-89` — ホスト名ベース検査のため内部 IP に解決する公開ドメインで回避可能
（コード内に「受容リスク」と明記済み）。→ 将来 pinned-IP fetch。

### 良い点（評価）
全 19 テーブル + secrets に RLS 有効・ポリシー網羅、service role は server-only に完全閉込め、
`userIsAdmin` は env 未設定時 **fail-closed**、cron は `timingSafeEqual`、Storage は public read + admin write のみ
（SVG 除外・5MB 上限）、FFLogs OAuth は state CSRF 防御、scrape-proxy は固定 URL で SSRF 安全。

---

# B. パフォーマンス（サイトの軽さ）

実ビルド計測（`npm run build` 成功・Turbopack）。raw / 推定 gzip:

| ルート | raw | 推定 gzip |
|---|---|---|
| スケジュール TOP | 899.5 KB | ~270 KB |
| /category | 855.9 KB | ~257 KB |
| strategy/macros/videos | ~800 KB | ~240 KB |
| mitigation/loot | 727 KB | ~218 KB |
| /login | 438 KB | ~131 KB |

### B-1.【高】`motion`（framer-motion v12）が全ページ初期バンドルに混入
`main-tabs.tsx:6`、`sub-tabs.tsx:6`、`category-switcher.tsx:17`
全ポータルページ常駐のナビ部品が `motion/react` をフル import → motion 一式（推定 gzip 40-50KB）が
全ルートの First Load JS に。最も効果の大きい単一改善。
→ `LazyMotion` + `m` + `domAnimation` 遅延化、または tab underline を CSS transition / View Transitions に置換。

### B-2.【中-高】`next.config.ts` に `optimizePackageImports` 未設定
`lucide-react` / `@base-ui/react` / `motion` / `@dnd-kit/*` の tree-shake 取りこぼしリスク。
`@next/bundle-analyzer` は devDep にあるが未配線。
→ `experimental.optimizePackageImports` に列挙 + analyzer 配線で継続計測。

### B-3.【中】`/login` 過大 / 全ポータルが force-dynamic
未認証初回接触点の /login が 438KB（Supabase client 遅延化で削減余地）。実質静的な iframe ラッパー
（mitigation/loot）まで毎リクエスト SSR（cold start 対策として意図的だが ISR 余地）。

### B-4.【低】背景アニメ・backdrop-filter の合成コスト
`layout.tsx:84-96` + `globals.css:602`（`drift` が `background-position` を 14s 無限ループ → ペイント誘発）、
glass の `backdrop-filter: blur()`（スクロール時に背後再合成）。→ `transform` ベース化、不透明背景なら blur 削減。

### 良い点（評価）
waterfall なし（`Promise.all` 徹底 + 依存 fetch は `.then` チェーン）、React `cache()` 網羅で重複クエリゼロ、
`next/dynamic({ssr:false})` を 8+ 箇所運用、dnd-kit は重い編集リストのみ局所化、Context 値は `useMemo`、
scroll リスナーは passive + rAF + hysteresis、フォント 3 種は `display:swap` + latin subset。

---

# C. 挙動の正しさ / 冗長性

### C-1.【中】楽観的更新の `setTimeout(1500)` 競合（DnD 系 8 箇所）
`category-list.tsx:181`、`videos-list.tsx:485`、`strategy-list.tsx:114`、`macros-list.tsx:189,523` ほか
並び替え後 1500ms 固定で無条件 `setOptimistic(null)`。Realtime UPDATE が間に合わないとちらつき（古い順へ巻戻り）。
`schedule-list.tsx:1566` の「DB 値が楽観値と一致したら畳む」値マッチ方式が正しい。timeout は cleanup なし。
→ 値マッチ方式に統一。

### C-2.【低】クライアント日付がブラウザ TZ 依存・ファイル内不整合
`videos-list.tsx`：`findVideoIdByDate`(:156 `getUTCFullYear`) と `onJumpToFirstClear`(:317 `getFullYear`) が混在
→ 非 JST 環境でクリア日ジャンプが 1 日ずれ得る。`strategy-images-list.tsx`、`category-form-dialog.tsx:60` も同様。
→ `getUTC*` 系に統一（サーバー側 `jst-cutoff.ts` は TZ 非依存で正しい）。

### C-3.【低】`extractDateFromTitle` のバリデーションが緩い
`title-date.ts:27-28` — 日が `1..31` のみで `2月31日` / `4/31` を通す。FFLogs 自動リンク基準で稀に誤マッチ。

### C-4.【中】冗長性: DnD ハンドラと Realtime フックの重複
- DnD: 5+ ファイルで `optimistic` state / id→index ソート / sensors / `onDragEnd` がコピペ。
  → `useSortableReorder(items, persistFn)` に集約（各 40-60 行削減 + C-1 修正が 1 箇所で済む）。
- Realtime 購読フック 6 本（`categories-client.ts:94` ほか）がスケルトン重複、かつ
  「全件 refetch」方式と「payload incremental」方式が**混在**。→ `useRealtimeTable<Row,T>` に集約。

### C-5.【低】巨大ファイルの分割候補
`schedule-list.tsx`(1940 行)、`category-form-dialog.tsx`(1190)、`maintenance-menu.tsx`(1022・`*Panel` 6 関数分離済で切出し容易)、`session-memo-popover.tsx`(971)、`fflogs-sync-section.tsx`(875・settings 分割の取り残し最有力)。
※`settings-dialog.tsx` は既に 324 行 + 12 サブ component に分割済。

### 良い点
リスナー/チャネルは全て cleanup 済（リークなし）、`stopPropagation` 多用は nested Link / iframe 干渉回避で妥当、
per-item エラー継続（`Promise.allSettled`）、snapshot は `onConflict` UPSERT で冪等、JST 処理のサーバー側は共通化。

---

# D. Next.js 16 / React 19 適合（ほぼ完璧）

破壊的変更の取りこぼし **ゼロ**（params/searchParams の Promise 化、async `cookies()/headers()`、
middleware→proxy 改名、fetch no-store デフォルト、`updateTag` の Server Action 限定、すべて適合）。
- 【低】`forwardRef` 残存 1 箇所 `session-memo-popover.tsx:100`（React 19 は ref を通常 prop で受け取れる）
- 【低】旧 `<Ctx.Provider value>` 2 箇所 `action-slot.tsx:42,86`
- 【低】`lib/server/**` の外部 fetch で `cache:"no-store"` 明示が不統一

---

# E. デッドコード（検証済み）

- 【低】`src/components/ui/badge.tsx`（`Badge` + `badgeVariants`）は **import 0 件で未使用**（grep 検証済み。
  コード内の "Badge" は StatusBadge / AutoGeneratedBadge / DeployColorBadge という別物）。→ 削除候補。
- それ以外の component / lib export / CSS クラス / lazy ラッパーはすべて使用中。

---

# F. デザイン / 審美

### F-1. 視覚的一貫性・洗練
- **極小タイポの氾濫（中）**: `text-[9px]/[10px]/[11px]` が 49 ファイル 383 箇所。`category-list.tsx:397,460,487,511`
  の右カラムは 9px + `tracking-[0.18em]` のバッジ多数。→ 最小サイズの床（例 11px）と型スケールを明文化。
- **日本語への `font-mono+uppercase+tracking`（中）**: 「スケジュール」`main-tabs.tsx:54`、「軽減表」`sub-tabs.tsx:186`、
  「未着手」`status-badge.tsx:55`。`uppercase` は日本語に no-op、`tracking` がかな漢字を不自然に間延びさせる。
  → mono+uppercase+tracking は Latin 専用文字列に限定し、日本語は `font-sans` + 通常字間に。
- **テーマトークン非経由の生 Tailwind 色（中）**: amber/emerald/violet/indigo/rose/zinc/slate（category-list 各バッジ、
  status-badge.tsx:15-27）は 7 テーマ切替で変化せず、テーマ可変の identity と矛盾。→ 装飾系の視認性をテーマ横断で監査。
- **角丸・ボーダー粒度のばらつき（低）**: 小ラベルが `rounded-4xl`(badge) と `rounded-sm`(各チップ) で併存、
  ボーダー透明度値が場当たり（`border-primary/40` `border-border/40/60` 等）。→ 標準形を定義。

### F-2. アクセシビリティ
- **`prefers-reduced-motion` 全面欠如（高）★**: 該当 0 箇所。雪/オーロラ/砂/twinkle/aether-pulse/drift、motion の
  layout アンダーライン、脈動ドット（`site-header.tsx:158`）、link-pending パルス、neon-edge が常時動作。
  → globals.css に `@media (prefers-reduced-motion: reduce)` を追加し背景アニメ・脈動を停止、motion 側は
  `useReducedMotion()` で spring 無効化（B-4 のペイント負荷とも関連）。
- **極小 × muted-foreground のコントラスト（中）**: 9-11px の muted テキスト（ONLINE `site-header.tsx:160`、
  slug `category-list.tsx:405`、theme トリガ `theme-switcher.tsx:21`）は WCAG 4.5:1 を満たさない懸念。→ 実測し是正。
- **破壊的操作にネイティブ `window.confirm`（中）**: カテゴリ削除 `category-list.tsx:196`。→ 既存 `Dialog` に統一。
- **色のみの情報（低）**: クリア済/未クリアを emerald/violet の色だけで区別（`category-list.tsx:486-491`）。→ 記号併用。
- 良い点: focus-visible リング徹底、icon ボタンの aria-label/sr-only、aria-current、DnD KeyboardSensor、`maximumScale:5`。

### F-3. レスポンシブ・モバイル
- **sticky オフセットのマジックナンバー結合（高）**: `sub-tabs.tsx:136`（`top-[102px]/sm:top-[110px]`）と
  `STICK_AT=102/UNSTICK_AT=118`（同 :76-77）がヘッダー高に手計算依存。高さ変更で無言でズレ/振動。
  → `--header-h` `--nav-h` を CSS 変数化し単一ソースから導出。
- **3 段 sticky の縦圧迫（中）** / **横スクロールタブの不可視（中）**: `overflow-x-auto` + スクロールバー非表示
  （`main-tabs.tsx:47`, `sub-tabs.tsx:142`）で「右にまだタブがある」手掛かりなし。→ 端フェード/chevron。
- 良い点: 入力欄 `text-base`→`md:text-sm`（input.tsx:12）で iOS 自動ズーム回避。

### F-4. 情報設計・UX
- **"ONLINE" + 脈動ドットが実状態と無関係（中）**: `site-header.tsx:156-162` は常時表示の装飾で realtime 接続を反映せず。
- **slug の uppercase 表示が実 URL と乖離（低）**: `category-list.tsx:405-407`。`/savage-p1` が `/SAVAGE-P1` に見える。
- **カテゴリカードの情報密度が高い（中）**: 名前/slug/status/Trophy/Hourglass/+N/wk/Lock/5 ショートカット/⋮ が同居。
  → 第 1 階層を強調しメトリクス群を弱める階層付け。
- 良い点: 共通 `EmptyState` で空状態統一、Suspense 遅延 fade-in、ショートカットを常時表示（タッチ配慮）。

---

# 統合優先度サマリ

| 優先 | 項目 | 領域 |
|---|---|---|
| **P0** | A-1 OAuth オープンリダイレクト / A-2 SECURITY DEFINER RPC の admin 迂回 | セキュリティ |
| **P1** | B-1 motion 初期バンドル混入 / B-2 optimizePackageImports 未設定 | パフォーマンス |
| **P1** | A-3 silent fail / A-5 冪等性 2 件 | 認可/挙動 |
| **P1** | F-2 `prefers-reduced-motion` 全面欠如 / F-3 sticky マジックナンバー | A11y/レスポンシブ |
| **P2** | C-1 楽観更新 timeout 競合 / C-4 DnD・Realtime 重複の共通化 | 挙動/冗長性 |
| **P2** | A-4 memos 意図不一致 / B-3 /login・force-dynamic | 認可/perf |
| **P2** | F-1 極小タイポ・日本語 mono / F-4 カード情報密度・window.confirm | デザイン/UX |
| **P3** | C-2 日付 TZ / C-3 バリデーション / C-5 巨大ファイル分割 | 挙動/保守 |
| **P3** | D Next.js 低重大度 3 件 / E badge.tsx 削除 / F-1 生 Tailwind 色・角丸 | 適合/掃除 |

---

# 検証方法

- **オープンリダイレクト**: `/auth/callback?next=/%5Cexample.com` でアクセスし外部遷移しないか。
- **RPC 迂回**: 非 admin の JWT で `POST /rest/v1/rpc/update_native_placeholder_raid_times` 直叩きが拒否されるか。
- **silent fail**: 非 admin でマクロ/募集テンプレ編集 → 成功 toast が出ず失敗が見えるか。
- **バンドル**: `withBundleAnalyzer` 配線後 `ANALYZE=true npm run build` で motion チャンクの所在確認。
- **動き / コントラスト**: DevTools の "Emulate prefers-reduced-motion: reduce" で背景アニメ停止を確認、
  Lighthouse / axe で最小 mono/muted テキストのコントラストを実測。
- **レスポンシブ**: 375px 幅で 3 段 sticky の重なり・タブ横スクロール見切れ・カード密度を確認。
- **TZ ずれ**: ブラウザ TZ を America/New_York にしてクリア日ジャンプが 1 日ずれないか。

---

# 備考

本レポートは精査結果のみ（コード変更なし）。P0 のセキュリティ 2 件から段階的に実装する場合は別途実装計画を提示。
