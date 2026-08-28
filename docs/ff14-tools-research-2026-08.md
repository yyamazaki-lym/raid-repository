# FF14 ツール／Web アプリ調査と、本 portal への機能提案

> 調査日: 2026-08-28 / 対象: Raid Repository (FFXIV レイド固定向け single-tenant portal)
> 目的: FF14 まわりの外部ツール・Web サービスを俯瞰し、本サイトに「あると便利」な機能を優先度付きで提案する。

---

## 0. 前提となる環境変化 (2026 年後半時点)

| 項目 | 内容 | portal への含意 |
|---|---|---|
| 現行 | 黄金のレガシー (7.x) 系。7.5x で 8.0 へ繋ぐ MSQ が進行中 | 既存ティア運用の改善は「今すぐ効く」 |
| 次期拡張 | **パッチ 8.0「白銀のワンダラー」= 2027 年 1 月発売予定**。新サーガ「神なき世界編」/ Lv110 / 新ジョブ 2 種 (タンク + 遠隔物理 DPS) / シーズン制 / エヴァコラボ AL | **2026 年 12 月までに「新ティア立ち上げ」導線を用意できると価値が最大化** |
| 難易度構成 | 8 人レイドに **ノーマルと零式の中間の第 3 難易度**が新設予定 | カテゴリの「ステータス」概念が 3 段階前提だと足りなくなる可能性 |
| プラットフォーム | Switch2 版が予定 (2026 年) | 「PC 前提でない参加者」= モバイル/コンソール勢が固定に混ざる前提が強まる → **モバイル閲覧性の重要度が上がる** |

> ⚠️ 発売時期・難易度構成はファンフェス発表段階の情報 (2026-04) に基づく。実装直前に再確認が必要。

---

## 1. FF14 ツールエコシステムの地図

調査で確認できた主要ツールを、本 portal との距離が近い順に整理する。

### 1-A. 戦闘ログ / 分析 (本 portal が既に連携している領域)

| ツール | 位置づけ | 本 portal との関係 |
|---|---|---|
| [FFLogs](https://www.fflogs.com/) | 事実上の標準。ACT が吐くログをアップロードし、pull 単位で全ての戦闘イベントを保持。**v2 は GraphQL API** (`/api/v2/client`) で `reportData` / `rankings` / `characterData` / `worldData` を取得可 ([API docs](https://articles.fflogs.com/help/api-documentation)) | 既に v1 key + OAuth + Edge proxy scrape で「動画 ↔ レポート」の紐づけを実装済。**取れているデータ量に対して portal 側の活用が最小限** |
| [XIVAnalysis](https://xivanalysis.com/) | FFLogs のレポート URL を食わせると、ジョブ別にスキル回し・バフ整合・CD 落ちを自動指摘 | portal から個人 log への導線が張れる (現状は FFLogs までで止まっている) |
| ACT / IINACT + Dalamud プラグイン群 | クライアント側。ログ生成の前提 | **portal 側で扱うべきではない領域** (後述 §4) |

### 1-B. 作図 / 戦略共有

| ツール | 特徴 |
|---|---|
| [RaidCanvas](https://raidcanvas.com/) | 2026 年公開の**国産**作図ツール。散開図・AOE・PT 配置をブラウザで作成し、**配置からゲーム内マクロを自動生成**。フェーズ毎のページ管理、注釈・警告枠・タイトルカードなど「解説記事を作る」方向の機能が厚い |
| [Toolbox Gaming Space (FF14 Strat Maker)](https://ff14.toolboxgaming.space/) | 老舗。アニメーション付きのギミック再現ができる最上位 |
| [XIVPlan](https://xivplan.netlify.app/) / [MateriaXIVPlan](https://github.com/materiaraiding/materiaxivplan) | OSS の作図ツール |
| [RaidPlan.io (FFXIV)](https://raidplan.io/ffxiv) | WoW 由来。**複数人リアルタイム共同編集**が無料 |
| [EchoPlan](https://echoplan.xivhub.net/) | FFXIV 専用。**ウェイマークの markercode を import/export**、アリーナ形状が正確、fork-with-attribution |
| [FF14俺tools 散開図エディタ](https://ffxiv.ap.exdreams.net/spreading/) | 軽量な国産散開図エディタ |

### 1-C. 軽減計画 (本 portal の「軽減表」に直撃する領域)

| ツール | 特徴 |
|---|---|
| [MitPlan](https://www.xivmitplan.com/) | エンカウンタの**タイムライン上に軽減 CD をドラッグ配置**。CD 回転の追跡、タンク対象指定、リアルタイム共同編集 |
| [XIVMitigation](https://xivmitigation.com/) | 無料/OSS 系。JSON 保存 → 固定へ共有 → コミュニティ Hub へ公開 |
| [XIVMit](https://xivmit.app/) | 同系統。ビジュアルタイムラインへ D&D |
| Google スプレッドシート各種 | 実運用では**依然これが最多**。本 portal も iframe 埋め込みでこの流儀に乗っている |

**要点**: 専用ツール群は「タイムライン軸で CD を置く」ことを解いており、スプレッドシートは「表として全員が同時に編集できる」ことを解いている。**本 portal は後者を iframe で借りているが、"読む" 体験だけが未解決のまま残っている。**

### 1-D. 固定運営 (スケジュール / 出欠 / ロット)

| ツール | 種別 | 特徴 |
|---|---|---|
| [character-sheets](https://character-sheets.appspot.com/schedule/) | 国産 Web | 本 portal の同期式スケジュールの取り込み元 |
| [こてまる](https://kotemaru.hakoniwa.workers.dev/) | 国産 Web | **登録不要**の FF14 固定向け日程調整 + 出欠管理 |
| [XIVLoot](https://xivloot.com/) | 海外 Web | 固定のロット配分 + **BiS 進捗トラッキング**、脱スプレッドシート志向 |
| [xivstaticlootmanager](https://xivstaticlootmanager.com/) | 海外 Web | ロット管理 + BiS トラッカー |
| [Throney](https://throney.gg/tools/ffxiv/guild-management) | 海外 Web + Discord Bot | **Discord コマンドで出欠を記録**、出席ポイントをロットに反映 |
| [CoGM](https://cogm.app/games/final-fantasy-xiv/attendance-tracker) | 海外 Web | ロスター / DKP / イベント / 出欠 + Discord Bot |
| [xivraidteam](https://github.com/okapiffxiv/xivraidteam) ほか国産シート群 ([Mizarsid](https://blog.mizarsid.net/2018/12/24/ff14-raids-google-sheet/) / [あせろぐ](https://asellog.com/pt-scheduleseet/) / [silky](https://silky.link/1513)) | スプレッドシート | 日程 + ロット + **断章/直ドロップの取得数自動カウント**。Discord 連携するものもある |
| TANGOS | スプレッドシート | 全 9 ジョブ分のギアセットを追跡、ロール優先度からロット推奨 |

**要点**: 海外勢は「出欠 → ポイント → ロット」を一本の線として扱い、国産勢は「週制限・断章・天井の算数」を厚く解いている。**本 portal はこの両方を Google Sheets に外注している。**

### 1-E. 装備 / データ基盤

- [XivGear](https://xivgear.app/) — 装備シミュレータ。ジョブ別・パッチ別の BiS が URL 1 本で共有可能 (`?page=bis|war|current` 形式)。
- [XIVAPI](https://v2.xivapi.com/) / [NetStone](https://github.com/xivapi/NetStone) — ゲームデータ + Lodestone パース。キャラの装備取得も可能だが Lodestone の HTML 変更に弱い。
- [Universalis](https://universalis.app/) / [Teamcraft](https://ffxivteamcraft.com/) — マケボ・製作。レイド固定 portal との距離は遠い。
- ウェイマーク: ゲーム内はコンテンツ毎に 5 枠まで保存可能。プラグイン (Waymark Preset / Waymark Studio) や外部バックアップツールで無制限共有するのが一般的。**markercode という文字列で受け渡しできる**のが実装上の鍵。
- マクロ: [マクロ付箋ツール](https://studio-xiv.com/macro/) のような「貼って渡す」だけの軽量ツールに需要がある (本 portal のマクロタブと同じ発想)。

### 1-F. 規約・コミュニティ規範 (機能設計の制約)

- 吉田 P/D は外部ツールを**個々の PC の話として黙認**する一方、**メモリ改変系は明確に処罰対象**、また **DPS を晒す/嘲笑する行為はハラスメントとして処罰対象**と明言している ([経緯まとめ](https://note.com/kk_note722/n/n23ceb20f7ac2))。
- 公式は DPS メーターを**実装しないと断言**している (数値至上主義による排斥を避けるため)。

→ **portal 側の設計原則**: ①クライアントに何かを入れさせる機能は作らない、②個人の火力を**序列化して表示しない** (自分自身の推移を見る用途に留める)。

---

## 2. 本サイトの現在地 (強み / 空白)

### 強み
- **1 固定 1 デプロイ**という割り切り。認証が Discord guild メンバーシップなので、招待管理を Discord に外注できている。
- Discord チャンネルからの**自動リンク取り込み** (日次 cron + 手動実行 + 指紋アイコン + 週次バッジ) — 他の固定管理ツールに無い独自機能。
- FFLogs の**private/unlisted レポートまで** Edge proxy scrape で拾って動画に紐づけている。ここまでやっているツールはほぼ無い。
- Supabase Realtime による即時同期、テーマ 7 種、募集テンプレ、日付メモなど「運営の手触り」の作り込み。

### 空白 (= 提案の根拠)

| # | 空白 | 現状 | 外部ツールの解 |
|---|---|---|---|
| 1 | **蓄積したログが読み物になっていない** | FFLogs URL を動画に紐づけて終わり | FFLogs 本体の progress / phase 統計 |
| 2 | **軽減表・ロット表がモバイルで読めない** | Google Sheets の iframe を 80% スケール表示 | MitPlan / XIVLoot などの専用 UI |
| 3 | **週制限・断章・天井の算数が portal 外** | ロットタブ = Sheets iframe | 国産シート群が最も厚く解いている領域 |
| 4 | **装備 (BiS) の概念が無い** | なし | XivGear / XIVLoot / TANGOS |
| 5 | **作図・タイムラインの置き場が「リンク」止まり** | 攻略タブにリンクカード | RaidCanvas / Toolbox / EchoPlan |
| 6 | **ウェイマークが持てない** | マクロのみ | markercode 共有ツール群 |
| 7 | **個人視点のページが無い** | 全部が「固定全体の掲示板」 | Throney / CoGM の個人出欠ビュー |
| 8 | **新ティア立ち上げのコストが毎回かかる** | カテゴリを手で作り、各 URL を手で貼る | (どのツールも未解決) |

> 📌 補足: `supabase/schema.sql` には `loot_items` / `loot_entries` / `mitigation_phases` / `mitigation_entries` / `strategy_docs` の**native テーブルが legacy として残っている**が、現行 portal は `mitigation_sheet_url` 等の単一 URL カラム方式に移行済で対応 UI が無い。空白 2・3 を埋める際、この過去判断 (「表は Sheets に任せる」) を**覆さずに上乗せする**形が望ましい。

---

## 3. 機能提案

各提案は 課題 / 提案 / 実装の要点 / 外部依存 / リスク で記述する。優先度は「効果 ÷ 実装コスト」で A > B > C。

### Tier A — 最優先 (既存資産の再利用で効く)

#### A-1. 練習進捗ダッシュボード (FFLogs の再利用)

- **課題**: 「先週より進んでいるのか」が誰にも見えない。固定のモチベーションは進捗の可視化で持つ。
- **提案**: 既に紐づいている FFLogs レポートから、コンテンツ単位で以下を集計表示する。
  - セッション毎の **pull 数 / 最長到達フェーズ / ボス残 HP 最小値**
  - 週次の折れ線 (到達フェーズの推移) と「初到達」バッジ (P2 初到達 / 初クリアなど)
  - 「今日の pull は N 回、うち P3 到達 M 回」というセッション締めのサマリ
- **実装の要点**: FFLogs v2 GraphQL の `reportData.report.fights` で `kill` / `fightPercentage` / `lastPhase` / `startTime` が取れる。既存の OAuth token 保管 (`secrets` テーブル, AES-256-GCM) と cron (`/api/cron/fflogs-sync`) をそのまま拡張し、集計結果を新テーブルに materialize すれば TOP の表示は軽いまま。
- **外部依存**: FFLogs v2 (既存)。
- **リスク**: **個人 DPS は出さない**。表示は「PT としての到達度」に限定する (§1-F)。

#### A-2. セッション振り返りビュー (pull ↔ 動画 ↔ メモ の三点接続)

- **課題**: 「あの日の、あのワイプ」に戻る手段が無い。動画は先頭から、ログは別タブ、メモは日付メモに散在。
- **提案**: 日付を開くと、その日の **pull リスト**が縦に並び、各行から (a) FFLogs の該当 fight、(b) 動画の該当時刻、(c) その pull へのメモ に飛べる。
- **実装の要点**: FFLogs の `fight.startTime` (レポート開始からの相対 ms) と、動画の撮影開始時刻の**オフセットを 1 回だけ手入力**すれば、以降は全 pull の動画時刻が計算で出る (`&t=` 付き URL)。既存の `schedule_past_session_logs` / `native_schedule_session_logs` に動画 ID + オフセットを足すだけで成立する。
- **リスク**: オフセット入力を忘れると機能しない → 「最初の pull の動画時刻だけ入れてください」という 1 フィールドの UI に落とす。

#### A-3. 軽減表の「読む専用」モバイルビュー (Sheets は正のまま)

- **課題**: iframe + 80% スケールはスマホで実質読めない。開催直前にスマホで確認したい情報が最も読みにくい。
- **提案**: Sheets を**編集の正**として維持したまま、portal 側で**読み取り専用のカード表示**を生成する。
  - Google Sheets の公開 CSV / gviz エンドポイントで取得 → フェーズ行 × 担当列にパース → モバイルは「フェーズ毎のカード」、PC は従来の iframe。
  - さらに「**自分の担当だけ**」フィルタ (表示名で列を選択して記憶)。
- **実装の要点**: 既に `sheet-iframe` 系のコンポーネントと URL 正規化がある。パースは「1 行目 = 見出し、A 列 = フェーズ」程度の緩い規約 + 失敗時は iframe にフォールバック、が現実的。
- **リスク**: 各固定でシートの形が違う → **列マッピングを設定ダイアログで指定できるようにする**か、パース失敗を許容する設計に。ロットタブにも同じ手法が使える。

#### A-4. ロット/装備の到達管理 (週制限カウンタ)

- **課題**: 「断章あと何個」「今週の分は消化したか」が Sheets の中でしか分からず、開催前の確認に人力が要る。
- **提案**:
  - コンテンツ単位で **週次リセット (火 17:00 JST) をまたぐカウンタ**を持ち、メンバー × 部位で「直ドロ / 断章 / 交換済 / 辞退」を記録。
  - 各メンバーの **BiS を XivGear の URL で登録**し、「残り部位」を自動算出。
  - TOP に「今週未消化のメンバー: N 名」を出す。
- **実装の要点**: legacy の `loot_items` / `loot_entries` が**ほぼこの形** (`status IN ('次優先','辞退','取得済','未定')`)。復活させるのではなく、**週次コンテキスト (`week_start`) を持つ新テーブル**として作り直し、Sheets 併存を前提にする。
- **リスク**: 「表は Sheets」という過去判断との衝突。**入力 UI をフルに作らず、「今週の消化チェック」だけの最小機能**から始めるのが安全。

#### A-5. ウェイマーク (markercode) の保管・配布

- **課題**: マクロは portal で配れるのに、ウェイマークだけ Discord のログを遡る必要がある。
- **提案**: マクロタブと同じ体験で **markercode をラベル付きで保存 → ワンタップコピー**。EchoPlan などの import/export と互換の文字列をそのまま置くだけ。
- **実装の要点**: `category_macros` と完全に同型。**最も安い提案** (テーブル 1 つ + タブ 1 つ、あるいはマクロタブ内の種別追加)。

### Tier B — 中優先

#### B-1. 攻略リンクの「フェーズ / ギミック」タグ付け
Discord 自動取り込みでリンクは溜まるが、練習中のフェーズに関係するものを探せない。`tags` テーブルは既にあるので、**P1/P2/… とギミック名でフィルタできる**ようにする。取り込み時にタイトル文字列からの自動タグ候補も出せる。

#### B-2. 作図ボードのカード化 (RaidCanvas / Toolbox / EchoPlan)
自前で作図エディタは**作らない**。代わりに、これらの URL を貼ったとき専用のカード (サムネ + 「散開図」バッジ + フェーズタグ) として扱い、攻略タブの一級市民にする。`link-site.ts` のサイト判定を拡張するだけで済む。

#### B-3. 新規メンバー向け「学習パス」
募集で人が入れ替わる度に、動画 → 散開図 → マクロ → 軽減表 の順で案内し直している。**順序付きチェックリスト**として束ね、進捗を個人ごとに保持する。既存の各タブへのリンク集約なので実装は薄い。

#### B-4. Discord 双方向化
現状は「Discord → portal」の一方通行 (取り込み) と、native スケジュールの通知のみ。**portal → Discord** を増やす:
- 開催確定 / 前日リマインド (native モードには既に基盤あり)
- 軽減表・マクロが更新されたときの差分通知
- セッション終了時の週次サマリ投稿 (A-1 の集計を 1 枚に)

#### B-5. 個人ページ (`/me`)
「自分の担当軽減 / 自分の残り BiS / 自分の出欠 / 自分の直近ログ」を 1 画面に。データは全て他機能の再利用で、**新規データは持たない**のがポイント。

### Tier C — 実験的 / 大きい

#### C-1. タイムライン再生 × 軽減の重ね合わせ
MitPlan 系が解いている領域。ギミックのタイムラインを (手入力 or 公開タイムラインデータから) 持ち、軽減 CD を重ねて回転を検証する。**価値は高いが専用ツールと真正面から競合**するので、自作するより「MitPlan の URL を埋め込むカード」で足りる可能性が高い。まず B-2 の枠組みで様子を見るべき。

#### C-2. 動画の自動チャプタリング
A-2 のオフセットが入っていれば、pull 境界を動画のチャプターとして自動生成できる。「P3 到達 pull だけ再生」まで行けると、復習の質が変わる。

#### C-3. 8.0 立ち上げモード
2027 年 1 月に向けた**テンプレート一括生成**: 新ティアのカテゴリ 4 層 + 軽減表/ロット表の雛形 + 募集文 + Discord チャンネル ID をウィザードで一気に作る。加えて、**第 3 難易度**が来るならカテゴリの `status` (未着手/練習中/クリア済/休止中) と難易度軸を分離しておく必要がある。**この 2 点はスキーマに触るので、8.0 前 = 今のうちにやる価値が高い。**

#### C-4. 週次サマリの自動生成 + 配信
A-1 + A-4 + スケジュールを束ねて「今週: pull 87 / P4 初到達 / ロット消化 6/8 / 次回 9/3 20:00」を 1 枚の画像 or 埋め込みで生成し、Discord に自動投稿。固定の継続率に効く。

---

## 4. 「作らない方が良い」もの (アンチ提案)

| 却下対象 | 理由 |
|---|---|
| **個人 DPS ランキング / 晒し系の表示** | 公式が DPS メーターを実装しない方針を明言し、晒し行為をハラスメントとして処罰対象としている。固定内の空気を壊す実害の方が大きい。自分の推移を自分で見る用途に限定すべき |
| **ACT / プラグインとのリアルタイム連携** | クライアント側インストールを前提にする機能は、portal の「ブラウザだけで完結する」利点を捨てることになる。Switch2 勢が混ざる将来とも噛み合わない |
| **作図エディタの自作** | RaidCanvas / Toolbox / XIVPlan と比べて勝ち目がない。**リンクを一級市民として扱う**方が費用対効果が高い |
| **装備シミュレータの自作** | XivGear が URL 共有まで完成している。**URL を預かるだけ**でよい |
| **マルチテナント化 (複数固定の相乗り)** | 「1 グループ = 1 デプロイ」という設計思想と、Discord guild = 認証境界という前提を壊す。認可の複雑さが跳ね上がる |
| **マケボ / 製作 / コレクション系** | Universalis / Teamcraft / FFXIV Collect の領域。レイド固定 portal の文脈から遠い |

---

## 5. ロードマップ案

| 時期 | 内容 | 狙い |
|---|---|---|
| 2026 Q3–Q4 (現ティア中) | **A-5 → A-3 → A-2 → A-1** | 安い順に着手。A-5 で「配布物の置き場」を完成させ、A-3 でモバイル閲覧性を底上げ、A-2/A-1 で蓄積データを価値に変える |
| 2026 Q4 | **C-3 のスキーマ準備** (難易度軸の分離)、**A-4 の最小版** (週次消化チェック) | 8.0 で第 3 難易度が来ても壊れない形にしておく |
| 2026-12 〜 2027-01 (8.0 直前) | **C-3 立ち上げウィザード**、B-3 学習パス | 新ティア開始時に一番人手が要る作業を吸収する |
| 2027 Q1 以降 | B-1 / B-4 / B-5 / C-4 | 運用が回り始めてからの質の改善 |

---

## 6. 参考リンク

**分析**: [FFLogs](https://www.fflogs.com/) / [FFLogs API docs](https://articles.fflogs.com/help/api-documentation) / [XIVAnalysis](https://xivanalysis.com/)
**作図**: [RaidCanvas](https://raidcanvas.com/) / [紹介記事](https://final-fantasy.bex.jp/post-185318/) / [Toolbox Gaming Space](https://ff14.toolboxgaming.space/) / [XIVPlan](https://xivplan.netlify.app/) / [RaidPlan.io FFXIV](https://raidplan.io/ffxiv) / [EchoPlan](https://echoplan.xivhub.net/) / [FF14俺tools 散開図エディタ](https://ffxiv.ap.exdreams.net/spreading/)
**軽減**: [MitPlan](https://www.xivmitplan.com/) / [XIVMitigation](https://xivmitigation.com/) / [XIVMit](https://xivmit.app/)
**固定運営**: [こてまる](https://kotemaru.hakoniwa.workers.dev/) / [character-sheets](https://character-sheets.appspot.com/schedule/) / [XIVLoot](https://xivloot.com/) / [xivstaticlootmanager](https://xivstaticlootmanager.com/) / [Throney](https://throney.gg/tools/ffxiv/guild-management) / [CoGM](https://cogm.app/games/final-fantasy-xiv/attendance-tracker) / [xivraidteam](https://github.com/okapiffxiv/xivraidteam) / [あせろぐ 配布シート](https://asellog.com/pt-scheduleseet/) / [Mizarsid シート](https://blog.mizarsid.net/2018/12/24/ff14-raids-google-sheet/)
**装備 / データ**: [XivGear](https://xivgear.app/) / [XIVAPI v2](https://v2.xivapi.com/) / [NetStone](https://github.com/xivapi/NetStone) / [Teamcraft](https://ffxivteamcraft.com/) / [xiv-resources (ツール一覧)](https://github.com/karashiiro/xiv-resources)
**マクロ / マーカー**: [マクロ付箋ツール](https://studio-xiv.com/macro/) / [フィールドマーカー保存 (公式ガイド)](https://jp.finalfantasyxiv.com/uiguide/battle/battle-target/fieldmarker_save.html)
**8.0 情報**: [ファンフェス 2026 基調講演まとめ (ファミ通)](https://www.famitsu.com/article/202604/73102) / [電撃オンライン](https://dengekionline.com/article/202604/72990) / [あせろぐ パッチ年表](https://asellog.com/ffxiv-patch/)
**規約・コミュニティ**: [外部ツール問題の経緯と現状](https://note.com/kk_note722/n/n23ceb20f7ac2) / [FF14 事件簿wiki: 外部ツール問題](https://w.atwiki.jp/ff14incident/pages/70.html)
