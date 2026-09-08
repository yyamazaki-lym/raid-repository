# 練習ログの部品 (`src/components/portal/logs/`)

`app/(portal)/category/[slug]/logs/logs-view.tsx` から切り出した表示部品。

## なぜ分けたか

練習ログは機能追加が集中する画面で、2026-09-06〜07 の 1 週間だけで
ワイプ原因サマリー (W-1) / フェーズ滞在時間 (W-2) / 各フェーズへの初到達 /
1 レポート N 動画 / レポート診断 / 再分類ボタンが載り、`logs-view.tsx` が
1,827 → 2,546 行になりました。調査ノート第 4 回 8-1 でも
「W-1〜W-4 を載せる前に、行ヘッダー / pull 行 / サマリの部品分割が要る」と
指摘されていた箇所です。

分割後は `logs-view.tsx` が 1,319 行で、**状態と組み立てだけ**を持ちます
(同期 / 取り込み / 診断のダイアログ、フィルタ、集計の `useMemo`、
`offsetTarget` の保持)。表示は本ディレクトリの部品が担います。

## 構成

| ファイル | 役割 |
|---|---|
| `stat-card.tsx` | 上部サマリのタイル (`StatCard`) と総 pull の内訳チップ (`PullBreakdownChips`) |
| `wipe-causes-card.tsx` | ワイプ原因の内訳カード (W-1) |
| `phase-time-card.tsx` | フェーズ滞在時間 + 各フェーズへの初到達 (W-2、絶のみ) |
| `floor-clear-card.tsx` | 各層の初討伐 (L-1、零式のみ。絶の「初到達まで」の層版) |
| `phase-span-bar.tsx` | 1 pull のフェーズ滞在バー (`pull-row.tsx` が使う) |
| `day-row.tsx` | 日ごとの行 (見出し + 開いたときの pull 一覧 + 管理バー) |
| `pull-row.tsx` | pull 1 本の行 (時刻 / 層・フェーズ / 結果 / PT 指標 / 各種リンク) |
| `failed-list.tsx` | 取り込めなかったレポートの一覧 |
| `offset-dialog.tsx` | 動画 URL / オフセット / 表示名の編集ダイアログ |
| `video-link.ts` | 動画リンクの表示ヘルパー (`OffsetTarget` 型 / 表示名 / オフセット表記) |
| `video-sync-panel.tsx` | 動画を見ながらオフセットを合わせるパネル (W-11。YouTube 埋め込み + ±1 秒) |
| `session-summary-row.tsx` | セッションサマリー (W-3。拘束 / 実戦闘 / 戦闘外 / 平均プル長) |
| `team-badges-card.tsx` | チーム実績バッジ (W-31。初討伐 / ノーデス / 最速 / 回数) |
| `trend-card.tsx` | 進行トレンド (W-4。インライン SVG の折れ線 2 本 + ペースの目安) |

依存の向きは一方向です:

```
logs-view.tsx
  ├── stat-card / wipe-causes-card / phase-time-card / floor-clear-card
  │   / team-badges-card / trend-card / failed-list
  ├── offset-dialog
  │     └── video-sync-panel
  └── day-row
        ├── session-summary-row
        └── pull-row
              └── phase-span-bar
  (day-row と pull-row は video-link を共有)
```

## 分割時に決めたこと

- **色のクラス表は `@/lib/fflogs-progress` へ移した**。`FLOOR_TEXT_TONE` /
  `PHASE_TEXT_TONE` / `PHASE_BAR_TONE` は `logs-view.tsx` のローカル定数
  でしたが、分割で 3 つ以上の部品から参照されるようになったため、色相の対に
  なっている `floorToneClass` / `phaseToneClass` の隣に
  `floorTextToneClass()` / `phaseTextToneClass()` / `phaseBarToneClass()`
  として置いてあります。フォールバック色が呼び出し側で
  `text-foreground/70` と `/75` に分かれていた (事故) のは `/75` に揃えました。
- **部品は表示だけを持つ**。Server Action の呼び出しは
  `offset-dialog.tsx` (動画の保存 / 削除) だけが持ちます。
  `video-sync-panel.tsx` は外部プレーヤーと `postMessage` するだけで、
  保存はしません (オフセットの値を `offset-dialog` に返すところまで)。同期・取り込み・
  診断・再分類は `logs-view.tsx` 側です。
- **絶と零式で同じ枠に同じ性質の情報を置く** (2026-09-08、L-1)。
  ワイプ原因の右隣 (`sm:grid-cols-2` の 2 枠目) は、絶では
  `phase-time-card`、零式では `floor-clear-card` が占めます。どちらも
  「区間ごとの節目」で、コンテンツ種別が変わっても目の行き先が変わりません。
  幅の実測値と、値を足すときに何を hover へ退避するかは
  `floor-clear-card.tsx` の docstring にあります。
- **グラフライブラリを入れない**。`trend-card.tsx` の折れ線はインライン SVG
  (座標は `@/lib/fflogs-trend` の `sparklinePath()` が組む純関数)。
  recharts / chart.js は 50〜200 KB の client bundle が乗るので、折れ線 1 枚
  では釣り合わない (調査ノート第 4 回 W-4 のデメリット欄への回答)。
- **`"use client"` は部品ごとに宣言**。`video-link.ts` は JSX も hook も
  持たない純関数なので付けていません。
- 列幅を固定して縦に揃える約束 (`w-14` / `w-[3.75rem]` など) は
  `day-row.tsx` が `reserve` オブジェクトで計算し `pull-row.tsx` に渡します。
  「その日に 1 つも無い列は幅を取らない」ため、日単位で決める必要があります。
