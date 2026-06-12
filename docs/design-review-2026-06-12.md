# デザインレビューレポート — Raid Repository

> 作成日: 2026-06-12 / 対象: FF14 レイド固定向けポータル
> （Next.js 16 / React 19 / Tailwind v4 / @base-ui/react）

## 背景

**デザイン的な観点での精査**。重点観点は 4 つ:（1）視覚的一貫性・洗練、
（2）アクセシビリティ、（3）レスポンシブ・モバイル、（4）情報設計・UX。

総評: OKLCH ベースの 7 テーマ・glass morphism・motion 規約の明文化・focus-visible 徹底など、
**設計の完成度は非常に高い**。以下は「土台の欠陥」ではなく **磨き込み（refinement）レベルの指摘**。
重大度は 高 / 中 / 低 で付す。

---

## 1. 視覚的一貫性・洗練

### 1-A. 極小タイポグラフィの氾濫（中）
`text-[9px] / [10px] / [11px]` が **49 ファイル・383 箇所**。特に `category-list.tsx` の右カラムは
Trophy / Hourglass / +N/wk / Lock / status がすべて **9px + `tracking-[0.18em]`**
（例 `src/app/(portal)/category/category-list.tsx:397,460,487,511`、`status-badge.tsx:58`）。
9px に letter-spacing を足すと可読性が大きく落ちる。
→ **最小フォントサイズの床（例 11px）と型スケールの明文化**（globals.css の motion 規約と同様に
「許可サイズ段」をドキュメント化）。装飾チップは件数を絞るかツールチップへ退避。

### 1-B. 日本語ラベルへの `font-mono + uppercase + tracking`（中）
ナビ・バッジの大半が `font-mono uppercase tracking-[0.16em〜0.22em]`。
これを日本語（「スケジュール」`main-tabs.tsx:54`、「軽減表」`sub-tabs.tsx:186`、
「未着手」`status-badge.tsx:55`）にも適用している。
- `uppercase` は日本語に **no-op**（Latin だけ効くので英日混在で意図がぶれる）
- `tracking` は **かな・漢字の字間まで開く** → 不自然な間延び
- `font-mono` の日本語はシステムフォントへフォールバックし Latin と質感が割れる

→ mono+uppercase+tracking は **Latin 専用文字列（version / ONLINE / slug 等）に限定**し、
日本語ナビ・ステータスは `font-sans` + 通常字間に。あるいは意図的な様式として残すなら明文化。

### 1-C. テーマトークンを通さない生 Tailwind 色（中）
`amber-400 / emerald-400 / violet-400 / indigo-300 / rose-300`（category-list 各バッジ）、
`zinc / slate`（status-badge.tsx:15-27）、`text-rose-300`（削除メニュー category-list.tsx:630）など。
これらは **7 テーマ切替で変化しない**。例えば Stormblood（ember/amber 系背景）下では amber バッジの
弁別性・コントラストが落ち、テーマ可変という設計アイデンティティと矛盾する。
→ ステータス配色は「全テーマで一定」が**意図的**（status-badge.tsx:13 コメント）なので残してよいが、
装飾系（Trophy/Hourglass/+N/wk）は **各テーマでの視認性を監査**、必要なら `chart-1..5` トークンへ寄せる。

### 1-D. 角丸・ボーダーの粒度ばらつき（低）
角丸: Card/Dialog=`rounded-xl`、Button=`rounded-lg`、Badge プリミティブ=`rounded-4xl`、
小チップ=`rounded-sm` が混在。特に「小ラベル」が `rounded-4xl`(badge.tsx) と `rounded-sm`(各チップ) の
2 系統で併存。ボーダーも `border-primary/40` `border-border/40` `border-border/60` `border/40` と
場当たり的な透明度値が多い（site-header.tsx:129、theme-switcher.tsx:21,77 など）。
→ 「小ラベルの標準形」と「標準ボーダー処理 2〜3 種」を決め、CVA/ユーティリティ化。

---

## 2. アクセシビリティ

### 2-A. `prefers-reduced-motion` が皆無（高）★最優先
`prefers-reduced-motion / motion-reduce / motion-safe` の使用箇所は **0**。一方で常時アニメが多数:
背景（`ec-snow-small/big` 雪、`ew-aurora`、`sb-sand` 22s、`arr-twinkle`、`shb-aether-pulse`、`drift`）、
`motion` の layout アンダーライン（main-tabs.tsx:77, sub-tabs.tsx:208）、ヘッダーの脈動ドット
（site-header.tsx:158 `animate-pulse`）、`link-pending-dot` パルス、`neon-edge` グロー。
前庭障害・動き過敏のユーザーに配慮できていない（WCAG 2.3.3 / 2.2.2）。
→ globals.css に `@media (prefers-reduced-motion: reduce)` を 1 ブロック追加し背景アニメ群と
脈動を停止、motion 側は `useReducedMotion()` で spring を無効化。

### 2-B. 極小 × muted-foreground のコントラスト（中）
最小テキストが `muted-foreground` の 9〜11px で多用（ONLINE `site-header.tsx:160`、slug
`category-list.tsx:405`、theme トリガ `theme-switcher.tsx:21`）。9〜11px は WCAG 上「大きい文字」に
該当せず **4.5:1 が必要**だが、glass 上の muted は満たさない懸念。
→ 最小 mono/muted テキストの実コントラストを実測し、サイズ増 or 前景色を一段濃く。

### 2-C. 破壊的操作にネイティブ `window.confirm`（中）
カテゴリ削除が `window.confirm("…\n…")`（category-list.tsx:196）。アプリ独自の Dialog と
見た目・フォーカス挙動・スクリーンリーダー体験が不統一（`\n` 整形も OS 依存）。
→ 既存 `Dialog`（dialog.tsx）ベースの確認モーダルに統一。

### 2-D. 色のみで伝わる情報（低）
クリア済/未クリアを emerald/violet の**色だけ**で区別（category-list.tsx:486-491、ラベルは title 属性のみ）。
→ アイコン形状や記号（既に `→` あり）で冗長化、または可視ラベル付与。

### 良い点（維持）
focus-visible リング徹底（button/badge/input）、icon ボタンの `aria-label` / `sr-only`、
`aria-current` ナビ、DnD の `KeyboardSensor`（category-list.tsx:149）、装飾の `aria-hidden`、
`viewport maximumScale: 5`（ズーム許容）。これらは水準が高い。

---

## 3. レスポンシブ・モバイル

### 3-A. sticky オフセットのマジックナンバー結合（高）
SubTabs が `top-[102px] / sm:top-[110px]`（sub-tabs.tsx:136）、stuck 判定が `STICK_AT=102 /
UNSTICK_AT=118`（sub-tabs.tsx:76-77）。これらは header（`h-14/16`）+ MainTabs 高に**手計算で依存**。
ヘッダー高を変えると **無言でズレる/振動する**脆さ。
→ `--header-h` `--nav-h` を CSS 変数化し、各 sticky `top` と JS 閾値を **単一ソースから導出**。

### 3-B. 3 段の sticky バーが縦を圧迫（中）
header + メインタブ + サブタブの 3 段固定。サブタブは stuck 時 collapse で緩和済みだが、
モバイルでは上 2 段が残り可視領域が削られる。
→ モバイルではスクロール時にヘッダーを更に薄くする等の検討。

### 3-C. 横スクロールタブの存在が見えない（中）
main-tabs / sub-tabs / action slot が `overflow-x-auto` + **スクロールバー非表示**
（main-tabs.tsx:47, sub-tabs.tsx:142）。active タブの自動センタリングは入っている（良）が、
**「右にまだタブがある」手掛かりが無い**。
→ 端のフェード（mask-image グラデ）か chevron ヒントを追加。

### 3-D. 入力欄の iOS ズーム回避（良）
`text-base` → `md:text-sm`（input.tsx:12）でモバイル focus 時の自動ズームを防いでおり適切。

---

## 4. 情報設計・UX

### 4-A. "ONLINE" + 脈動ドットが実状態と無関係（中）
ヘッダーの「ONLINE」と脈動ドット（site-header.tsx:156-162）は **常時表示の装飾**で、実際の
realtime 接続状態を反映しない。接続中を示唆するため誤認の余地（`aria-hidden` でリスクは限定的）。
→ realtime 接続状態に結線する、または純粋なブランディングと割り切るなら脈動を弱める。

### 4-B. slug 表示の `uppercase` が実 URL と食い違う（低）
`/{category.slug}` を `uppercase` で表示（category-list.tsx:405-407）。slug は小文字運用が普通なので
`/savage-p1` が `/SAVAGE-P1` と表示され、**実パスと見た目が乖離**（クリック先と不一致に見える）。
→ slug はそのまま小文字表示に。

### 4-C. カテゴリカードの情報密度が高い（中）
1 枚に 名前 / slug / status / Trophy / Hourglass / +N/wk / Lock / 5 ショートカット / ⋮ が同居。
密度は意図的（placeholder で高さ固定まで作り込み済み）だが、**視覚的優先度が平坦**。
→ 第 1 階層（名前 + status）を強調し、メトリクス群は弱める/ホバー展開にする階層付けを検討。

### 4-D. デプロイ色サイクルは end-user に意味不明（低）
version バッジの色（site-header.tsx:68-88）は開発者向けデプロイ判別。利用者には説明の無い色変化。
→ 内部ツールとして許容で良いが、一般ユーザー視点では「意味の無い色」になっている点を認識。

### 良い点（維持）
共通 `EmptyState`（empty-state.tsx）で空状態統一、Suspense の遅延 fade-in ローディング、
サブページショートカットを **ホバー隠しにせず常時表示**（タッチ配慮 category-list.tsx:539-544）。

---

## 優先度サマリ

| 優先 | 項目 | 観点 |
|---|---|---|
| **P1** | 2-A `prefers-reduced-motion` 全面欠如 | A11y |
| **P1** | 3-A sticky オフセットのマジックナンバー結合 | レスポンシブ |
| **P2** | 1-A 極小タイポの氾濫 / 1-B 日本語への mono+uppercase | 一貫性 |
| **P2** | 2-B 極小×muted のコントラスト / 2-C 削除の window.confirm | A11y |
| **P2** | 3-C 横スクロールタブの不可視 / 4-C カード情報密度 | レスポンシブ/UX |
| **P3** | 1-C 生 Tailwind 色 / 1-D 角丸・ボーダー粒度 | 一貫性 |
| **P3** | 4-A ONLINE 表示 / 4-B slug uppercase / 4-D デプロイ色 | UX |

---

## 検証方法（指摘の再現・確認手順）

- **動き**: Chrome DevTools → Rendering → "Emulate prefers-reduced-motion: reduce" にして
  雪/オーロラ/砂/脈動が止まらないことを確認（2-A）。
- **コントラスト**: Lighthouse / axe DevTools でページ走査、最小 mono/muted テキストを
  DevTools のコントラスト計で実測（2-B）。
- **レスポンシブ**: 375px 幅で各テーマを切替え、3 段 sticky の重なり・タブ横スクロールの
  見切れ・カード密度を確認（3-A/3-B/3-C/4-C）。ヘッダー高を試しに変えてサブタブ整合が
  崩れることで 3-A の結合を再現。
- **テーマ横断**: 7 テーマすべてに切替え、生 Tailwind 色バッジ（Trophy/Hourglass/status）の
  視認性を比較（1-C）。
