# FF14 ツール調査アップデート + UI 監査 (2026-08-30)

> 前回調査 (`docs/ff14-tools-research-2026-08.md`, 2026-08-28) の重複を避け、**差分と深掘り**に絞る。
> 発端のユーザー要望: 「ウェイマークは公開されている情報が少ない。必要か。これも含め、再度 FF14 関連サイト・ツールを調査して機能・使い勝手を精査。あると良い機能の洗い出し。同時に UI 周りを精査」。
>
> 最重要の環境変化: **パッチ 7.4 (2025-12-16) でゲーム内「ストラテジーボード」が実装され、共有コードのエコシステムが急速に形成された**。前回調査の作図ツール地図 (§1-B) はこの前提で読み直す必要がある。
> 現行ティア: アルカディア・ヘビー級 (M9S–M12S)、零式解放 2026-01-06 ([Icy Veins](https://www.icy-veins.com/ffxiv/news/arcadion-heavyweight-savage-unlock-gear-bis-guide/))。

---

## 1. ウェイマーク: 公開データの実態と要否判断

### 実装状況の確認 (repo 側)

ウェイマークは既に **A-5 として実装済**: `src/app/(portal)/category/[slug]/macros/waymarks-section.tsx` + `src/lib/supabase/category-waymarks.ts` (`category_waymarks` テーブル、label + body + note のテキスト保管 + ワンタップコピー)。つまり「要否」の問いは実質「**この最小実装を拡張する価値があるか**」。

### 共有フォーマットの実態

- **事実上の標準は PaisleyPark 系 JSON**。`{"Name":..., "MapID":725, "A":{"X":24.73,"Y":-24.0,"Z":-693.386,"ID":0,"Active":true}, ...}` の形で A–D/1–4 の 8 点 + MapID + Active フラグ ([フォーマット実例 gist](https://gist.github.com/CostasAK/ea9810880560d6a3a73c6686264e88b6))。[WaymarkPresetPlugin](https://github.com/PunishedPineapple/WaymarkPresetPlugin) (現在は [Infiziert90 がメンテ](https://github.com/Infiziert90/WaymarkPresetPlugin)) がこの JSON をペーストで import する。
- **[Waymark Studio](https://github.com/sourpuh/ffxiv_waymarkstudio)** (2025〜の後発本命): `https://sourpuh.github.io/waymarkstudio?preset=<encoded>` 形式の**共有 URL** を発行し、**Web 上でマップ付きプレビュー**できる。さらに **FFLogs レポート URL からウェイマーク配置を import** できる。
- [MemoryMarker](https://github.com/MidoriKami/MemoryMarker) はゲーム内スロットのリネーム/管理系で、共有フォーマットの主役ではない。

### 公開プリセットデータベースの実態

- **[Em-Six/FFXIVWaymarkPresets wiki](https://github.com/Em-Six/FFXIVWaymarkPresets/wiki)**: fight 別 JSON のコミュニティ集積。2026-04 時点でも更新されており、アルカディア零式〜絶まで現行コンテンツをカバー。
- **[Materia Raiding](https://materiaraiding.com/savage/m9s)**: 攻略ガイドに fight 別の import 用 JSON を同梱 (M9S–M12S)。
- つまり「**公開の構造化データは十分に存在する**」。ただし——

### 懐疑ポイント (判断材料)

1. **import にはプラグイン (= PC + Dalamud) が必須**。公式のウェイマーク共有手段は今も存在しない (7.4 ストラテジーボードにもウェイマーク実体の共有は含まれない)。コンソール勢が混ざる固定では「PC の 1 人が import して設置」運用になる。
2. **プリセットは攻略法 (strat) に従属する**。Em-Six / Materia は英語圏 strat 前提で、日本式 strat とマーカー位置が一致しないことが多い。**公開 DB をミラーする価値は JP 固定には薄く、「自分たちの strat 用プリセットを自分たちで置く」現行設計が正しい**。
3. Waymark Studio の FFLogs import により、「過去に使った配置」は既に紐づいている FFLogs レポートから復元可能。portal が保管しなくても救済経路がある。

### 提案

- **残す (現行の最小実装で正解)**。拡張するなら安い順に:
  - (a) body が PaisleyPark JSON として parse できる場合に「✓ import 可能な形式」バッジ + 整形表示 (client `JSON.parse` のみ、数十行)。
  - (b) A–D/1–4 の 8 点を**相対座標で簡易トップダウン描画** (SVG)。MapID→アリーナ形状の対応データを持たないと正確な絵にはならないので「点の相対配置プレビュー」止まりが現実的。コスト中。
  - (c) Waymark Studio の共有 URL をそのまま貼れることを UI ヒントで案内。コストほぼゼロ。
- **削る理由は見当たらない** (テーブル 1 つ + セクション 1 つの維持コストしかない)。

---

## 2. 主要ツール調査アップデート

### ゲーム内ストラテジーボード (7.4, 2025-12) — 今回最大の差分

- アイコン/図形で散開図を作成し、**常時表示・パーティへのリアルタイム共有・共有コードによる SNS/Web 経由の受け渡し**が全部ゲーム内で完結 ([公式ブログ](https://jp.finalfantasyxiv.com/blog/003801.html) / [ゲームエイト解説](https://game8.jp/ff14/751230))。保存 50 枚 + 一時 20 枚、フォルダ管理。
- 共有コードは **`[stgy:...]` 形式の文字列** (zlib 圧縮 + 任意 cipher key)。**ブラウザで動く OSS デコーダ/エンコーダ [`xiv-strat-board`](https://github.com/mczub/xiv-strat-board) (npm, pako 使用) が存在**し、100+ アイコン種を扱える。
- 周辺: [ffxivstrats.io](https://ffxivstrats.io/) (共有コード DB)、[board.wtfdig.info](https://board.wtfdig.info/) (コード閲覧 + バンドル)。[raidplan.io](https://raidplan.io/ffxiv) と ffxivstrats.io は共有コード export 対応。
- **含意**: 散開図の受け渡しの共通通貨がマクロ文字列 → 共有コードへ移行しつつある。前回調査 B-2 (作図 URL のカード化) より **共有コードの保管** の方が優先度が高い。

### FFLogs

- v2 GraphQL は前回調査どおり。**deep link**: `#fight=N` に `&type=deaths` / `&type=damage-taken` / `&type=casts`、`&source=<actorID>`、`&start=&end=` を重ねられる ([Icy Veins: Death Information](https://www.icy-veins.com/ffxiv/fflogs-death-information))。⚠️ ハッシュパラメータの公式ドキュメントは無い (慣行として安定しているが保証なし)。

### xivanalysis

- URL 規約は `xivanalysis.com/fflogs/<reportCode>/<fight>/<player>` で deep link 可 ([repo](https://github.com/xivanalysis/xivanalysis), dawntrail ブランチで開発継続)。⚠️ 2026 年時点のジョブ別対応状況の一次情報は取れず (情報薄)。

### Tomestone.gg

- FFLogs 開発者による prog point / ベストプル % 表示サイト。API は実在 ([TomestoneViewer](https://github.com/Anomek/TomestoneViewer) 等が利用)。8 人固定の portal には「メンバーの Lodestone/Tomestone リンク列」以上の統合価値は薄い。⚠️ 詳細未検証 (egress 制限)。

### xivgear.app / etro.gg

- xivgear: **埋め込み専用ビュー** `https://xivgear.app/?page=embed|sl|<uuid>` が公式に用意 ([USER_MANUAL](https://github.com/xiv-gear-planner/gear-planner/blob/main/USER_MANUAL.md))。**API**: `https://api.xivgear.app/fulldata/<uuid>` でセットの計算済ステータスを JSON 取得可 ([docs](https://xivgear.app/docs/))。
- etro: [API](https://etro.gg/api/docs/) は健在で xivgear と双方向互換だが、コミュニティの主流は xivgear へ移行済みという認識で良い (⚠️ etro のメンテ状況の一次情報は薄い)。

### Raidplan.io / FF14 Toolbox / Cactbot / 国内ツール / Discord bot

- Raidplan: FFXIV 対応継続、2026-08-22 にリアルタイム共同編集が無料化、ゲーム内共有コード export 対応。
- [FF14 Toolbox Gaming Space](https://ff14.toolboxgaming.space/): 健在。タイムライン再生系はここが最上位のまま。リンクカード扱いで十分。
- Cactbot / トリガー系: クライアント側の領域で portal のスコープ外 (前回 §4 の判断を維持)。
- 国内 (RaidCanvas / こてまる / character-sheets): 特段の差分なし。
- Discord bot ([Raid-Helper](https://raid-helper.dev/)、[Throney](https://throney.gg/tools/ffxiv/guild-management)、[CoGM](https://cogm.app/)): 既存の native スケジュール + Discord 同期と機能重複。乗り換え/併用の積極理由なし。

### Prog 管理の一般慣行

- 共通トラッキング項目は **prog point 推移・週次消化・BiS 残数・出欠率**。[TANGOS](https://tizzidar.itch.io/tangos) は消耗品 (薬/飯) サマリも持つが専用機能化している例は少ない。前回 A-1/A-4 の方向性と一致しており変更不要。

---

## 3. この portal に追加価値が高い機能候補 (ランク順)

| # | 機能 | 概要 | 根拠 | 実装コスト感 |
|---|---|---|---|---|
| 1 | **ストラテジーボード共有コードの保管** | マクロ/ウェイマークと同型のセクションで `[stgy:...]` をラベル付き保存 + コピー。第 2 段階として [`xiv-strat-board`](https://github.com/mczub/xiv-strat-board) でデコード → SVG/canvas プレビュー | 7.4 以降の散開図共有の共通通貨。ゲーム内完結なので**コンソール勢も使える** | 保管のみ: 極小 (既存パターン複製)。プレビュー: 中 |
| 2 | **練習ログの FFLogs deep link 強化** | 各 pull 行に「死亡」「被ダメ」リンク (`#fight=N&type=deaths` 等) + xivanalysis のプレイヤー deep link | データは既に保持。URL 組み立てだけで振り返りの質が上がる | 極小。⚠️ 非公式規約なので壊れてもレポート先頭に落ちるだけの fail-soft 設計に |
| 3 | **BiS の xivgear 埋め込み** | BiS リンクの uuid を検出し `?page=embed\|sl\|<uuid>` を iframe 表示。将来は `fulldata` API で「残り部位」自動算出 (前回 A-4 と接続) | 公式の埋め込み UI + JSON API が揃っている | 埋め込み: 小。fulldata 連携: 中 |
| 4 | **ウェイマークの形式検証 + 簡易プレビュー** | §1 提案 (a)(b) | 配布前の検品。公開 DB から拾う場合にも効く | (a) 極小 / (b) 中 |
| 5 | **メンバー行に Tomestone/FFLogs キャラリンク** | Lodestone ID 1 つから外部リンク自動生成 | prog point の外部確認導線。データ保持ゼロ | 極小 |

## 4. 逆に不要と思われるもの

- **作図エディタ自作** — ゲーム内ストラテジーボード実装で理由がさらに強まった。エディタはゲーム内、保管は portal。
- **公開ウェイマーク DB のミラー/自動取り込み** — 英語圏 strat 前提で JP 固定の配置と合わない。
- **Discord bot への乗り換え・二重管理** — 既存スケジュール機能と正面衝突。
- **Tomestone/etro の API 深統合** — 8 人固定にはリンクで足りる。新規統合は xivgear 優先。
- **リアルタイム共同編集系の自作** — raidplan が無料開放した領域。専用ツールに任せる。

### 情報が薄い点 (再確認推奨)

- xivanalysis の 2026 年ジョブ対応状況、etro のメンテ状況、RaidCanvas の共有コード対応、Tomestone API の公開条件。
- FFLogs のハッシュパラメータ deep link は公式ドキュメント無しの慣行。

---

## 5. UI 監査 (2026-08-30 時点)

今回のユーザー報告と実装棚卸しから。**対応済み** は本日のコミットで解消。

### 対応済み

- 練習ログの「灰色だらけ・PC で小さい」→ データ行 10px → 11px、層チップの識別色 (1=sky / 2=teal / 3=violet / 4=rose / 複合=cyan)、残% の熱量色分け (≤60% sky → ≤30% amber → ≤10% orange → <2% rose、討伐 emerald)。
- スケジュールの「ルール」が再クリックで閉じない → トリガーを click-outside の対象外にしてトグルを機能させた (memo-dot と同じ既知パターン)。
- BiS をロット管理 → 攻略情報 (LINKS の上) へ移動。
- 軽減表カードの簡素化 (AA 除外 / ダメージ→軽減率→最終 / 対象チップ) + 層タブ切替 (?gid=)。
- 同日 Logs の二重取り込み (防止 + 一括整理)。

### 残る改善候補 (優先度順)

1. **10px 基調の他画面への展開**: スケジュール PAST 詳細表・設定ダイアログも 10px 基調。練習ログで確立した「データ 11px + 意味色」の方式を段階適用する。
2. **popover 実装の 3 系統併存**: session-memo-popover (手書き Portal)、legend ルール (手書き absolute)、native-fflogs-link-popover (Base UI Popover)。click-outside / Esc / フォーカス復帰の挙動が微妙に違い、今回のルール不具合もこの分岐が原因。共通フックへの集約を検討。
3. **管理操作の発見性**: 「重複 Logs を整理」「FFLogs と動画を連動」等が設定ダイアログの奥にあり、問題に気づいた画面 (スケジュール/ログ) から遠い。該当画面へのショートカット導線を検討。
4. **軽減表の層タブは card ビュー限定**: iframe ビューは Sheets 自身のタブバーがあるため対象外にしたが、混乱するようなら iframe 側 URL の #gid 切替も追随させる。
5. **練習ログの層フィルタ**: 層チップに色が付いたので、次の一手として「チップをクリックでその層の pull だけ表示」が安価に足せる。
