# FF14 ツール調査 第 4 回 (広域): 他ゲーム・海外 OSS・ログ深掘り・UI 比較 (2026-09-06)

> 前 3 回 (`ff14-tools-research-2026-08.md` / `ff14-tools-research-2026-08-30.md` / `ff14-tools-research-2026-08-30-deep.md`) への追加調査。発端のユーザー要望:
> 「固定向けポータルサイトとして FF14 関連で役立ちそうな機能を追加していきたい。さらに広く、海外も含めて良さげなものをまとめ、実装するメリット/デメリットを提示。Logs 解析周りや ACT 関連までは許容するが、それ以上のツールは現状では用いないので参考程度。追加調査で UI 周りなど比較し、良いものを取り入れたい」
>
> **調査手段の制約** (前回と同じ): 本環境から直接 fetch できるのは GitHub (github.com / raw.githubusercontent.com) のみ。fflogs.com / tomestone.gg / archon.gg / wowaudit.com / game8 / note / 公式フォーラム / X 等は egress 遮断。Web 検索スニペット + GitHub 一次情報 (README / ソース / GraphQL スキーマダンプ) を主とし、各所に確度ラベルを付す: ✅ 複数ソースまたは一次情報で確認 / ⚠️ 薄い (スニペット依存・単一ソース) / ❌ 到達不能・未確認。
> **調査体制**: 6 領域 (他ゲームのギルド管理ツール / FF14 海外ツール / ログ由来技術 / 国内・公式動向 / UI 比較 / 出欠・日程 UX) を並列に調査し、本書で統合・重複排除・優先度付けした。各領域の一次調査は Web 検索上限に達したものがあり、未実施の検索は 11 章に明示する。

---

## 0. 総括 (TL;DR)

### 0-1. 前 3 回の提案はどこまで消化されたか

2.10〜2.14 (2026-08-28〜09-06) で、第 1 回 Tier A の **A-1〜A-5**、第 2 回の **#1〜#5**、第 3 回 D-6 の「やる」判定のうち **ログ担当手引き以外の 3 件** (出欠催促 / リンク辞書追加 / ストラテジーボード共有コード保管) と次点の「全員入力で自動確定」は実装済。具体的には: 練習ログ (pull 単位到達度・層/フェーズ内訳・PT 合計 DPS・死亡数) / pull ↔ FFLogs fight ↔ XIVAnalysis ↔ 動画時刻の接続 / 軽減表・ロット表のスマホ用カード表示 (アビリティ名自動判定・層タブ) / 今週の消化チェック + BiS リンク (xivgear 埋め込み + 中身確認 + 並び替え) / ウェイマーク (形式チェック + 配置プレビュー) / ストラテジーボード共有コード保管 / 攻略リンクのサイト種別バッジ / 死亡・被ダメへの deep link / 未入力者への Discord 自動催促 / Google カレンダー導線。

**未実装のまま残る過去提案**: B-1 攻略リンクのフェーズ/ギミックタグ、B-3 新規メンバー学習パス、B-4 Discord 双方向の残り (軽減表・マクロ更新差分通知、週次サマリ投稿)、B-5 個人ページ `/me`、C-2 動画の自動チャプタリング、C-3 8.0 立ち上げウィザード + 難易度軸の分離、C-4 週次サマリ自動生成、ログ担当の手引きページ、○×△ 3 値の拡張 (第 3 回 D-3 次点)。本書 7 章の総合表にはこれらも「継続候補」として再掲し、今回の新規候補と同じ軸で並べ直した。

### 0-2. 今回の新発見 (上位 6)

1. **FFLogs v2 だけで「プル毎のワイプ原因サマリー」と「フェーズ滞在時間」が 1 往復/プルで作れる** — `events(dataType: Deaths)` に `killingAbilityGameID` が入り、`ReportFight.phaseTransitions { id startTime }` で 1 プル内の実測フェーズ境界が取れる (✅ スキーマ + Better Deaths / xivodreview の実装で確認)。既存の練習ログ行に列を足す形で成立し、API コストも極小 (4 章)。
2. **「ボスタイムライン × 計画軽減 × 実測軽減」を Web だけで重ねて出すツールは FFXIV に存在しない** (確認できた範囲。MitPlan は計画のみ、Triggevent はクライアント常駐)。cactbot のタイムライン (Apache-2.0) を「技名辞書」として借り、x 軸は FFLogs の実測詠唱で描けば、cactbot の分岐・ループ問題を避けて実装できる。差別化余地が最大の領域だが、工数も最大 (4-4)。
3. **`reportData.reports(guildID / userID)` と `guild.attendance` で、レポートの自動発見と出席簿の自動化が API で可能** (現行の scrape 経路が不要になる)。ただし v2 スキーマに `Mutation` / `Subscription` は無く Webhook は存在しない → ポーリングのみ ✅。アーカイブ済レポートは購読なしで `events` が取れなくなるため、取得した events は **Supabase に永続保存が必須** ✅。
4. **他ゲーム (WoW / GW2 / Destiny 2) の定番で、FF14 側のツールに無い概念** — セッションサマリー (拘束時間 vs 戦闘時間 vs ダウンタイム比、raidTimeline / MRT)、進行トレンド (pull 毎 best% の折れ線と pace、WCL Progress / Warcraft Insights)、「デフォルト出席・例外だけ入力」(WoWAudit)、3 色セマンティクス「良 / 注意 / 悪」の全画面統一 (WoWAudit / WoWAnalyzer)、チーム実績バッジ (Raid Report の Flawless 等)。いずれも個人 DPS を出さずに成立する (2 章)。
5. **国内固定の未解決課題は「共有した攻略情報が読まれない」「募集時の活動日数の期待値ズレ」「遅刻の構造化」**。国内ツールの新顔は少なく (GuildHub / KNT Tools / らすと軽減表タイムライン)、一方で海外 OSS (主に中国語圏の個人開発) では「ミス注釈 (個人とチーム帰属を分離)」「FFLogs → 軽減表雛形の自動生成」「VOD 同期レビュー (死亡クリックで動画ジャンプ + ワンクリック同期校正)」が先行している (3 章・5 章)。
6. **8.0「白銀のワンダラー」(2027-01)**: 8 人レイドの新難易度 (ノーマルと零式の中間、**正式名称は未発表** ❌)、クリアで「シーズンギア」を入手・成長、デイリー廃止 → 週単位ボーナス制、トームストーン 2 週管理 ✅ → 「今週の消化チェック」のリセット論理と、カテゴリのステータス/難易度モデルを見直す必要がある。**7.56 (7.x 最終) は 2026-09-08 実装** ✅ (5-2)。

### 0-3. 推奨 (短縮版。詳細は 7 章・10 章)

| 時期 | 内容 |
|---|---|
| **すぐ (2026-09〜10)** | W-1 ワイプ原因サマリー → W-2 フェーズ滞在時間 → W-13 遅刻/早退ステータス → W-27 攻略リンク既読 → UI: 5 段階色スケール統一 + `text-[10px]` 廃止の第一歩 (練習ログ・軽減カード) |
| **秋〜12 月** | W-5 レポート自動発見 (guildID ポーリング) → W-3 セッションサマリー → W-4 進行トレンド + 記録更新の Discord 通知 → W-16 iCal 購読 → W-33 8.0 準備 (難易度モデル・週ボーナス対応) |
| **8.0 以降** | W-9 軽減 計画×実測タイムライン (大)、W-7 ミス注釈、W-8 死亡 lead-up recap |
| **作らない** | Dalamud 連動、TTS 読み上げ、Split reclear 計画、Lodestone ID をキーにした横断保存、個人 DPS / 出席のランキング・streak 表示 (9 章) |

---

## 1. スコープ判定の基準 (今回の明文化)

ユーザー指示「Logs 解析周りや ACT 関連までは許容、それ以上は参考程度」を、以後の判定で使える形に固定する。

| 区分 | 定義 | 例 | 本書での扱い |
|---|---|---|---|
| **採用可** | ブラウザ + サーバー (Vercel / Supabase) で完結し、データ源が FFLogs (ACT / IINACT 経由で固定の誰か 1 人がアップロードしたログ) までのもの | 練習ログ、ワイプ原因サマリー、軽減 計画×実測、レポート自動発見、出席突合、Discord 通知 | 7 章で機能候補として評価 |
| **参考** | クライアント側にプラグイン / オーバーレイ / 常駐ソフトが必要、または戦闘中の外部補助にあたるもの | Dalamud プラグイン (BisBuddy / PassportChecker / StratBoardImport / XIVRaidPlannerPlugin 等)、Triggevent、TTS タイムライン読み上げ、cactbot トリガー | UI や概念の参考として記録のみ。導線・導入案内は置かない (第 3 回 A-5 の判断を維持) |
| **対象外** | メモリ改変・自動化・他者の詮索にあたるもの | ストーカーツール (PlayerScope 2025-01 / EchoVault 2026-07 ⚠️)、オートマーカー、DPS 晒し bot | 規約・リスクの根拠として言及のみ |

補足 2 点:
- **cactbot のタイムラインデータ (テキストファイル) をサーバー側で読むこと**はクライアント連動ではない (Apache-2.0 のデータを表示に使うだけ)。「採用可」に含める。
- **Lodestone ID をキーにメンバー横断のデータを保存・公開すること**は、ストーカーツール問題と同じ火種になる ⚠️。single-tenant で同意済メンバーのみでも、公開共有リンクや Discord 投稿に Lodestone ID を含めない設計を推奨する (5-2)。

---
## 2. 他ゲームのギルド / レイド管理ツールから学ぶ

FF14 の固定運営ツールは「個人開発 + スプレッドシート」が主流で、WoW 圏のように 1 万チーム規模のギルド管理 Web が育っていない。8 人固定に移植できる概念を拾う目的で、WoW / Destiny 2 / GW2 / ESO / Lost Ark の主要ツールを横断した。価格は 2025〜26 年時点の断片情報で、⚠️ 付きは要再確認。

### 2-1. 主要ツール比較

| ツール | ゲーム | 何をするか | 8 人固定へ移植しやすい要素 | 料金 | 確度 |
|---|---|---|---|---|---|
| [WoWAudit](https://wowaudit.com/) | WoW | ロスター監査 / レイドカレンダー (出席) / ロット wishlist / ロット履歴統計。1 万チーム超 | **「デフォルト出席・欠席時のみ理由コメント」**、wishlist の **緑=最良 / 黄=代替あり / 赤=古い** 3 色、出席履歴パネル、幹部が他人の RSVP を修正可 | 無料 (Patreon 任意) | ✅ |
| [Raider.IO](https://raider.io/) | WoW | キャラ・ギルドの進行度・順位。API で boss 別 `best percent / pull count / kill` | 討伐順の **ボスアイコン列** (hover で詳細)、ギルドキル判定ルール (7 人在籍) | 無料 + Patreon ⚠️ | ✅ |
| [Warcraft Logs ギルドページ](https://www.archon.gg/wow/articles/help/guilds) (Archon) | WoW | **Progress タブ** (進行時間・pull 毎 boss% グラフ・30 秒更新)、**Attendance** (ログ出現で出席率)、OBS 用 Widgets、Stealth Mode | 進行トレンドグラフ、ログ由来の自動出席率 (遅刻・途中退席は表現不可という既知の欠点)、配信オーバーレイ | 無料 (一部 Premium) | ✅ |
| [Wipefest](https://www.wipefest.gg/) | WoW | ログから Insights (定型 Q&A) / Timeline / **複数プル横断解析** (最大 150 pull) | プル横断のギミック失敗集計、**死亡カットオフ** (終了 30 秒前以降の最初のクラスタのみ採用、以降はワイプコール扱い) | Patreon $3/月〜 | ✅ |
| [Lorrgs](https://lorrgs.io/) ([OSS, MIT](https://github.com/gitarrg/lorrgs)) | WoW | 上位 50 ログの CD 使用をタイムラインに重ね表示 | **Cast (縦線) / Duration (帯) / Cooldown (薄帯) の 3 要素バー**、「CD 期間を表示」で温存かフル回転かを判別、ゲーム内ノート出力 | 無料 | ✅ |
| [WoWAnalyzer](https://github.com/WoWAnalyzer/WoWAnalyzer) (OSS, AGPL) | WoW | Suggestions / Checklist / Timeline / Statistics | **5 段階パフォーマンス色スケール**、PerformanceBoxRow (1 キャスト = 1 小箱)、TimelineHeatmapGrid、HideGoodCastsToggle | 無料 | ✅ |
| Method Raid Tools | WoW | アドオン。Raid Attendance (ロスター履歴)、**Encounters Statistics** (boss 毎 pull 数 / kill 数 / 平均戦闘時間 / 初撃破) | 統計項目の設計 (クライアント側なので概念のみ) | 無料 | ✅ |
| RCLootCouncil / Gargul / [That's My BIS](https://github.com/thatsmybis/thatsmybis) | WoW | ロット評議会・履歴・wishlist。TMB は **ボス別「欲しい人」一覧**、Gargul は **+1 カウンタ** | ロット決定の理由記録、ボス別 wishlist 行列 | 無料 (OSS) | ✅ |
| [Guilds of WoW](https://guildsofwow.com/) | WoW | Discord RSVP ⇄ ゲーム内カレンダー同期、未回答者 DM、**イベントカード上に装備警告** | 予定カードへの「週次消化未完了」警告 | 無料 + Patreon | ✅ |
| [Warcraft Insights](https://www.warcraftinsights.com/) | WoW | 公開ログから進行時間・pull 数・**pace (時間あたり pull)**・死因・**再発ギミック失敗** (ログイン不要) | pace、再発失敗ランキング | 無料 | ✅ |
| [Viserio Cooldowns](https://wowutils.com/viserio-cooldowns) | WoW | 軽減タイムラインをチームで編集、**各プルを計画と照合してレビュー** | 軽減プラン vs 実績比較 | 無料 (一部 Premium) | ✅ |
| [Raidstrats.gg](https://raidstrats.gg/) | WoW | アニメ付き戦術図、**アカウント不要の共有リンク** | 共有リンク閲覧 | 無料 | ✅ |
| [Raid Report](https://raid.report/) / [RaidHub](https://raidhub.io/) / [Dungeon Report](https://dungeon.report/) | Destiny 2 | クリア数・速攻・Sherpa・**Flawless (全員ノーデス)** バッジ、`/subscribe` で Discord にクリア通知、**バッジ上書きルールの明文化** | チーム実績バッジ、クリア/ログ到着の Discord 通知 | 無料 | ✅ |
| [Braytech](https://bray.tech/) (OSS, GPL) | Destiny 2 | 週次リセット連動チェックリスト、クラン Roster / Stats | 週次チェックリスト (既存の消化チェックに近い) | 無料 | ✅ |
| [dps.report / Elite Insights](https://github.com/baaron4/GW2-Elite-Insights-Parser) (OSS, MIT) | GW2 | ダメージグラフに敵 HP + ギミックマーカー重畳、**Mechanics タブ = 人 × ギミック成否表**、フェーズ別バフ維持率、Combat Replay | ギミック別 × 人別ヒット表、フェーズ別集計 | 無料 | ✅ |
| [raidTimeline](https://github.com/danifischer/raidTimeline) (OSS, MIT) | GW2 | 1 晩のログを束ね **拘束時間・戦闘時間 vs ダウンタイム・ボス毎 try/kill/fail** の一覧を生成、各行から詳細へ | **セッションサマリー** | 無料 | ✅ |
| [GW2 Wingman](https://gw2wingman.nevermindcreations.de/) | GW2 | ログ集約 DB。**バランスパッチ期 (era) 別の記録・キルタイム**、Burst Analyzer | キルタイム推移 (消化期)、パッチ期区切り | 無料 + Patreon | ✅ |
| ESO Logs | ESO | Archon 系。FFLogs と同系のため差分は小 | — | 無料 + Premium | ✅ |
| loa-todo / la-tools | Lost Ark | 週次宿題 Todo | 既存の消化チェックで代替済 | 無料 | ⚠️ |
| Guilded | 汎用 | RSVP・繰り返し・Docs。**2025-12-19 に終了** (Roblox Communities へ) | 参考のみ | — | ✅ |

Wowhead に専用のギルド管理機能は確認できず ❌。Raidbots (Top Gear / Droptimizer) は FF14 では xivgear が担う領域で、料金体系は未確認 ⚠️。

### 2-2. FF14 側のツールに無い 4 つの概念

| 概念 | 出典 | FF14 固定でどう効くか | 個人 DPS 非表示ルールとの整合 |
|---|---|---|---|
| **セッションサマリー** (拘束時間、戦闘時間 vs ダウンタイム比、pull 数、平均プル長、kill/wipe) | raidTimeline / MRT Encounters Statistics | 「今日は 3 時間で 28 pull、実戦闘 61 分」が数字で残る。ダウンタイム比は固定の"効率"を客観化する。FFLogs の fight 開始/終了時刻から算出可能で **追加 API 不要** | PT 単位の値のみ。整合する |
| **進行トレンド** (pull 毎 best% の折れ線、累積 pull、pace) | WCL Progress / Warcraft Insights / Raider.IO | 既存の「日ごとの到達度バー」を時系列化。「先週より進んだか」に加え「このペースならクリアまで何 pull か」の目安が出る | 整合する |
| **デフォルト出席・例外だけ入力** | WoWAudit | 毎週固定枠なら入力負荷が激減する。ただし無反応 = 出席とみなす危うさがあり、現行の「8 人回答で自動確定」とは思想が逆。**定期枠 + 例外モデル (W-15) を入れるなら選択肢として持つ**程度に留める | — |
| **3 色 / 5 段階セマンティクスの全画面統一** | WoWAudit (緑/黄/赤)、WoWAnalyzer `colorForPerformance` (5 段階) | 現行は層チップ (sky/teal/violet/rose) と残 HP% 熱量色 (sky→amber→orange→rose) が別体系。「良 / 注意 / 悪」を 1 スケールに揃えると学習コストが下がる (8 章 UI-12) | — |

加えて **チーム実績バッジ** (Raid Report の Flawless = 全員ノーデスクリア、Sherpa、初クリア日) は、個人でなくチームの実績なので方針に整合し、消化期のモチベ維持に効く (W-31)。逆に **出席率ランキング・streak** は 8 人という小集団では特定個人への圧になりやすく、国内の固定文化 (6 章) にも合わないため不採用を推奨する。

### 2-3. 設計パターンとして共通していたもの

- (a) 高密度テーブル + 行クリックで詳細ログへ deep link (raidTimeline / Elite Insights / FFLogs) — 本 portal の練習ログと同じ方向。
- (b) 「例外だけ入力」思想 (WoWAudit)。
- (c) 個人の順位ではなく **チーム集計・実行品質** を前面に出す (Wipefest / WoWAnalyzer)。
- (d) 通知は「新レポート到着 / ベスト更新 / 初クリア」のイベント駆動 (RaidHub `/subscribe`、WCL 30 秒更新)。本 portal の Discord 通知は現在スケジュール系のみで、ここが空白。

---

## 3. FF14 海外ツール: 新顔と 2025〜26 年の更新

前 3 回で押さえた主要ツール (FFLogs / XIVAnalysis / Tomestone / xivgear / RaidCanvas / Toolbox / XIVPlan / RaidPlan / EchoPlan / MitPlan / XIVMitigation / XIVLoot / Throney / CoGM / TANGOS / Raid-Helper / Waymark 系 / ストラテジーボード周辺 / fight シム群 / NAUR / Ulti Strats / wtfdig / Materia Raiding / IINACT / cactbot / Archon) は割愛し、**未言及のもの**と**実質的な更新**だけを記す。GitHub の数値 (★ / 最終更新) は 2026-09-06 時点。

### 3-1. 新顔 (GitHub 一次確認 ✅ を中心に)

| 名称 | 種別 | 最終更新 | 何をするか | 本 portal との関係 | 確度 |
|---|---|---|---|---|---|
| [FFXIV Raid Planner](https://github.com/aaronbcarlisle/ffxiv-raid-planner) (xivraidplanner.app, MIT) | Web: BiS / 装備進捗 / ロット優先 / セッション RSVP | 2026-09-04 (817 コミット) | 11 スロットの BiS 出典 (層ドロップ / トームストーン)、強化素材追跡、**層別ロット優先スコア (ロール重み × BiS 未達度)**、武器キュー、G1/G2 編成、セッション RSVP + Discord Webhook、読取専用共有リンク、Owner/Lead/Member/Viewer 権限。React 19 + Tailwind 4 + FastAPI。7.4 対応、日本語なし。付属 Dalamud プラグイン (参考のみ) | **本 portal に最も近い競合**。ロット優先度の自動算出 + ティア毎スナップショットは取り込み価値あり | ✅ |
| [ffxiv-static-loot-bot](https://github.com/christyke1170/ffxiv-static-loot-bot) | Discord bot: ロット + Split reclear | 2026-08-29 | `/reclear` で **35 通りの正規分割**を評価、Main/Alt の同ジョブ・別回、追記専用履歴 | 国内固定では alt 運用が薄く需要は限定的 | ✅ |
| [ffxiv-loot-optimizer-app](https://github.com/iago-ca/ffxiv-loot-optimizer-app) | Web: 8 週ドロップ配分シミュ | 2025-06 | 固定週ドロップとページ蓄積をシミュ、**3/4/6/8 週目のページ交換を提案**、ジョブアイコン付き Discord 貼付サマリ | ロット計画の自動提案 (W-24) | ✅ |
| [Dev-2A/ffxiv-loot-tracker](https://github.com/Dev-2A/ffxiv-loot-tracker) (韓国, MIT) | Web: リアルタイム入札 | 2026-04 | **Supabase Realtime** で「ロット部屋」、Need > Greed の上で抽選 / DKP / 事前順番、配布履歴 | 同スタックの Realtime 実装例 | ✅ |
| [static-raid-coordinator](https://github.com/ruminabottle/static-raid-coordinator) | Discord bot | 2026-03 | 定期開催日を各人ローカル TZ で表示、DST 補正、**臨時日提案 (最大 8 名投票)**、リマインダー | 臨時日投票 (W-22 周辺) | ✅ |
| [shiraishiyokai/ffxiv-raid-tracker](https://github.com/shiraishiyokai/ffxiv-raid-tracker) (中国「副本开荒犯错记录表」) | Web: 開荒ミス記録表 | 2026-07-12 | 記録単位 = 日付・フェーズ・ミス内容・責任者。テンプレで「1 件 3 秒」入力、**チーム帰属ミス (軽減不足 / ヒール穴) を個人と分離**、FFLogs から死亡 + 軽減タイムライン取込、傾向グラフ、アナウンス用サマリ、Cloudflare Worker で FFLogs OAuth 代理 | **練習ログの注釈レイヤー** (W-7) の先行例 | ✅ |
| [XIVtimelineMaker](https://github.com/Yilegendoflink/XIVtimelineMaker) (中国) | Web | 2026-07-11 | FFLogs ログイン → ボス技・被ダメイベント抽出 → **軽減表に貼れるスプレッドシート形式**で出力 | FFLogs → 軽減表雛形 (W-10) | ✅ |
| [xivodreview](https://github.com/k0etsu/xivodreview) / [xivodreview-local](https://github.com/k0etsu/xivodreview-local) (AGPL) | Web / Electron: FFLogs ↔ VOD 同期レビュー | 2026-07-15 | 左サイドバーに pull 一覧 (fight% / フェーズ色分け)、**死亡イベントをクリックで動画ジャンプ**、オフセット微調整 + **「ここで同期」ワンクリック校正**、ショートカット | 既存の動画ジャンプの延長 (W-11) | ✅ |
| [ffreplay](https://github.com/Xinrea/ffreplay) (中国, ★50, MIT) | Web (WASM): FFLogs レポートの盤面リプレイ | 2026-08-11 | `events(DamageTaken, includeResources: true)` を 2 分チャンク × 並列 10 で取得し座標復元。「GraphQL はフィールドマーカーを提供しない」と明記 | リンク先候補 / 座標データの取り方の実証 | ✅ |
| [rmoskwa/ffxiv-timeline-app](https://github.com/rmoskwa/ffxiv-timeline-app) (Tauri, ★6) | デスクトップ: タイムライン / 軽減プランナー | 2026-06 | **Canvas ビュー (D&D + リアルタイム軽減量) と Simple ビュー (一覧) の 2 モード**、21 ジョブ内蔵 | 軽減表 UI の参考 (8 章 UI-11) | ✅ |
| [Flickwire-Agent/xivmitplan](https://github.com/Flickwire-Agent/xivmitplan) / [jln-tail/ffxiv-mitigation-planner](https://github.com/jln-tail/ffxiv-mitigation-planner) | Web: 軽減プランナー | 2026-08 / 2026-04 | 前者は **Next.js 16 + Auth0 + Prisma** (本 portal と同スタック)、M1S〜M12S 内蔵、CD 二重使用 / 共有枠の衝突検知、共有と fork。後者は spreadsheet 風グリッド + 競合インラインエラー + **フェーズ単位ナビ** | 軽減表ネイティブ化を検討する際の参照実装 | ✅ |
| [mu-ns/ffxiv-raid-analyzer](https://github.com/mu-ns/ffxiv-raid-analyzer) (CLI) | FFLogs → TSV | 2026-07-28 | 死亡 / DamageDown / **軽減アビリティ使用状況**を TSV でクリップボードへ。「**アーカイブ済レポートの fight 取得には有効なサブスクが必要**」と明記 | 軽減「実績」列の抽出ロジック参考 | ✅ |
| [aeruru/berry-fflog-analyzers](https://github.com/aeruru/berry-fflog-analyzers) | Web (クライアント完結) | 2026-06 | ある固定が自作。FFLogs GraphQL v2 + OAuth PKCE、pull 単位で死亡 + **ダメージダウン debuff (ability id 1002911)** をハイライト | 練習ログ拡張 (W-8) にそのまま使える設計 | ✅ |
| [vincent5816/ff14-logs-review-skill](https://github.com/vincent5816/ff14-logs-review-skill) | LLM エージェント用 skill | 2026-05 | 絶竜詩のワイプ原因帰属。「**最初の死亡 ≠ 最初の責任**」「メカニクス窓で判断」を原則化、信頼度付き出力 (中/英/日) | AI ワイプ要約 (W-12 見送り寄り) の設計参考 | ✅ |
| Tomestone 周辺 ([progwatch](https://github.com/z0w13/progwatch) / TomestoneViewer / ProgressPeeper / [Dalamud.Tomestone](https://github.com/TomestoneGG/Dalamud.Tomestone)) | CLI / Dalamud | 2026-01〜05 | progwatch のソースに **非公式 JSON** `tomestone.gg/character/progress-graph/{lodestone_id}/{encounter_id}` (pull 毎 % / Best Pulls / 到達メカニクス名) が実装されている ✅。ToS・bot チェックは未確認 ❌ | まずはリンクのみ (W-32) | ✅ (コード) |
| [XIV ToDo](https://github.com/olivi-eh/xivtodo) (★145) | Web: 日次/週次チェックリスト | 2026-09-06 | Discord OAuth、複数キャラ、Lodestone 連携、エンカウンター踏破状況 | 週次消化チェックの参考 | ✅ |
| StaticForge (Java Spring + Next.js) | 募集・編成・管理 | 2026-05 | README 不在、122 issue は TDD サブタスク | 実体不明 | ⚠️ |
| [XIV Recruit](https://www.xivrecruit.com/lfm) | 募集サイト LFM/LFG | 稼働中 | focus/mindset・スケジュール・募集ジョブで検索 | 募集カードの項目設計 (W-29) | ⚠️ |
| xivpf.com エコシステム ([ff14-partyfinder-analytics](https://github.com/abdulrahman-khan/ff14-partyfinder-analytics) 等) | PF 集約 | 2025〜26 | 15 分毎スクレイプで 100 万件超を BigQuery に蓄積、「募集の最適時間帯・ロール不足・DC 別活況」を算出 | 外部リンクで足りる | ⚠️ |
| lailai (中国 QQ bot, ★17) / astrbot_plugin_tataru | チャット bot | 2026-07〜09 | FFLogs キル通知・分位・募集板 | Discord 通知の型 (キル通知) | ✅ |
| PassportCheckerReborn / BisBuddy / LootView / FFLogsUploader / StratBoardImport | Dalamud | 2026-07〜08 | PF に FFLogs 分位 + Tomestone 進捗を重畳 / etro・xivgear 取込で必要品ハイライト / ロット記録 / 自動アップロード / ボード取込 | **参考のみ** (1 章) | ✅ |

[karashiiro/xiv-resources](https://github.com/karashiiro/xiv-resources) の README を一次確認したところ、static 運用に関わる未言及エントリは XIV Recruit / The PF Strat (PF 標準戦術集) / XIVDirectory / Characa・XIV-Character-Cards / Kal's FFXIV API / Thaliak (パッチ追跡 GraphQL) / Lodestone News API / FFXIV Collect API / Lalachievements。**attendance / progression 専用ツールは掲載なし** ✅ — この領域は依然として空白で、本 portal の練習ログ・出欠が埋めている。

### 3-2. 既知ツールの 2025〜26 年更新

| ツール | 更新内容 | 本 portal への含意 | 確度 |
|---|---|---|---|
| **Tomestone.gg** | 2025-04: 進捗グラフの tooltip に「各 pull で到達した最後のメカニクス名 + ボス%」を表示 / 2025-05: detailed activity view ベータ / 2026-01 頃: 開発者 (Kihra) がキャラカードから prog point 表記を外し pull チャートを見せる方向を検討中と発言 / Static ページ `/static/{id}/{slug}/progress` が存在 / Savage 層 × ジョブの装備分布 | prog point を序列化表示しない流れは本 portal の方針と一致。Static ページは「メンバー行に外部リンク」で十分 | ⚠️ (X スニペット) |
| **Archon.gg (FFXIV)** | **Raid Team Support**: ギルド配下に複数「Raid Team」(Type = Static) を作成、チーム毎の募集オプション、参加コード/URL / **New Archon App (Open Beta)**: Uploader と Companion を統合、エンカウンター内の主要 CD をタイムライン表示 (攻撃/防御/ユーティリティで filter) / ティアリスト・Builds ページ | FFLogs 側でも「static = guild 配下の team」が公式概念になった → W-5 の guildID 運用と噛み合う。CD タイムラインは W-9 と正面競合するがクライアントアプリ側 | ⚠️ (help 記事スニペット、無料/有料境界 ❌) |
| **FFLogs** | 2025〜26 の公式アナウンス本文は取得失敗 ❌。間接確認: アーカイブ済レポートの fight / events 取得には有効なサブスクが必要 ✅、Auto Logging (第 3 回既出) | events の永続保存が必須 (4 章) | ✅ / ❌ |
| **XIV in the Shell** (ローテーション プランナー) | 2025-08 時点で全 22 ジョブ対応、Vite 移行 | リンクカードで十分 | ✅ |
| **xivgear** | ほぼ全ジョブで DPS シム内蔵 | 既存の埋め込みで足りる | ⚠️ |
| **Amarantine sim** | pip `ama-xiv-combat-sim`、GUI xivraider.com (遮断)、Etro/FFLogs 連携「部分完了」 | 参考 | ✅ |
| **arcan1s/ffxivbis** | 2026-01 も更新継続 (Scala、Swagger API、公開インスタンス) | ロット/BiS の API 設計参考 | ✅ (UI は未確認) |
| **KaneTW/FFXIVBisSolver** | 2025-05 が最終 = 実質停止 | — | ✅ |

### 3-3. 中国語圏 / 韓国語圏の所見

中国語圏は QQ / AstrBot 等の**チャット bot** と**単一 HTML の Web ツール**が主流で、開荒 (prog) 向けの「ミス記録表」「FFLogs → 軽減表」「盤面リプレイ」が独自色 ✅。韓国語圏は GitHub 上では Dev-2A のロット入札のみ発見、出席 / 固定管理サイトは未確認 ❌ (検索上限)。

---
## 4. ログ由来 (FFLogs / ACT) の深掘り — 技術的に何が作れるか

ユーザー指示で「許容」と明示された領域なので、ここは他章より一段深く、API のフィールド名まで確認した。fflogs.com 本体と公式 v2 docs は egress 遮断のため、**第三者リポジトリに commit された FF 用 `schema.graphql` ダンプ** ([ssilve1989/ulti-project](https://github.com/ssilve1989/ulti-project/blob/82917729bee7e07bd57962608e1a8be09f81d4ba/apps/bot/schema.graphql)) と、実際に v2 を叩いている OSS の実装コード (Better Deaths / ffreplay / xivodreview / FFLogsViewer) でフィールドの存在を確認した (✅)。公式ドキュメント本文に基づく記述はスニペット経由 (⚠️)。

### 4-1. v2 GraphQL で使える能力 (本 portal が未使用のもの)

現行実装 (`src/lib/server/fflogs-fights.ts`) は `reportData.report.fights` のメタ情報 (`kill` / `fightPercentage` / `lastPhase` / `startTime` / `endTime` / `encounterID` / `difficulty`) と Summary table (PT 合計 DPS・死亡数) までを使っている。**未使用で価値が高いもの**:

| 能力 | 内容 | 使い道 | 確度 |
|---|---|---|---|
| `ReportFight.phaseTransitions { id startTime }` | 1 プル内で **観測されたフェーズ遷移の時刻列**。ID は fight 内で絶対 (同 ID = 同じ意味のフェーズ) | フェーズ滞在時間、フェーズ帯付きタイムライン、死亡のフェーズ判定 | ✅ |
| `Report.phases[{ encounterID, separatesWipes, phases[{ id, name, isIntermission }] }]` | フェーズ名メタデータ | `lastPhase` → 表示名 (現行は P1〜 の番号表記) | ✅ |
| `ReportFight.lastPhaseAsAbsoluteIndex` / `lastPhaseIsIntermission` / `combatTime` / `wipeCalledTime` / `inProgress` | 0 起点フェーズ番号 (intermission 込み)、prepull 除外の戦闘時間、ワイプコール時刻、進行中フラグ | 正確な戦闘時間集計、ライブ取込の観測点 | ✅ |
| `events(dataType: Deaths, hostilityType: Friendlies, fightIDs, limit: 10000, useAbilityIDs: false)` | 各 death に `timestamp` / `targetID` / **`killingAbilityGameID`** | ワイプ原因サマリー (4-5) | ✅ |
| `events(dataType: Casts, hostilityType: Enemies / Friendlies)` | ボス詠唱列 / PT のアクション列 (`abilityGameID`, `sourceID`, `timestamp`) | 実測ボスタイムライン、軽減の実使用タイミング | ✅ |
| `events(dataType: DamageTaken, includeResources: true)` | 被ダメ毎に `amount` / `unmitigatedAmount` / `absorbed` / `mitigated` / **`buffs` (有効バフ ID 列)** / `targetResources { hitPoints maxHitPoints x y }` | 死亡直前の HP 推移・「軽減が乗っていたか」判定・死亡位置 | ✅ |
| `events` の引数 `death` / `wipeCutoff` / `filterExpression` / `translate` | 特定死亡の周辺だけ取る / N 人目の死亡以降を無視 / サイトのクエリ言語 / 技名の翻訳 | 帯域節約、JP/EN 技名の対応 | ✅ |
| `Report.masterData(translate) { abilities { gameID name type icon } actors { id name subType } }` | 技名・アイコン・ジョブ (subType) の解決表 | ID → 日本語技名、ジョブアイコン | ✅ |
| `Report.archiveStatus { isArchived isAccessible archiveDate }` | アーカイブ済かどうか | **アーカイブ後は購読なしで `events` が取れない** → 取得した events は Supabase に永続保存 | ✅ |
| `reportData.reports(guildID / guildTagID / userID / guildName+server, startTime, endTime, zoneID, limit 100, page)` | レポート一覧 (scrape 不要) | **レポート自動発見** (現行の fights-and-participants scrape 経路を置換できる) | ✅ |
| `guildData.guild { tags { id name }, attendance(guildTagID, zoneID) { code startTime zone players } }` | FFLogs 上の static ページ (= "guild") と Report Tag、レポート × 参加者 | **出席簿の自動化** | ✅ |
| `rateLimitData { limitPerHour pointsSpentThisHour pointsResetIn }` | 任意クエリに同梱可 | 自計測してバッチ幅を決める | ✅ |

制約・注意:
- **`Mutation` / `Subscription` はスキーマに存在しない** ✅ → Webhook / Push は無く、ポーリングのみ。
- レート上限の具体値は公式に到達できず。第三者メモに「3,600 points/hour per client」(WoW 向け記述) ⚠️、FFLogsViewer の UI 文言に「Patreon 購読で上限が上がる」✅。`limit: 10000` の大ページで往復を減らし、`rateLimitData` で実測する。
- `visibility` は `public | private | unlisted`。**unlisted は code を知っていれば client API で読める** (xivanalysis の運用ドキュメントが明記 ✅)。private は所有者の user token (既存の OAuth 保管が使える)。
- xivanalysis / cactbot の main は現時点でも **v1 REST** を使用 ✅ → 既存の v1 キー経路は当面有効と推定 ⚠️。

### 4-2. 既存ツールの到達点 (ログから何を可視化しているか)

| ツール | FFLogs 取込 | 到達点 | 確度 |
|---|---|---|---|
| xivanalysis (MIT, `dawntrail` ブランチ) | v1 REST | 22 ジョブ (21 戦闘 + BLU)、`supportedPatches` 7.0〜7.5。個人向け Checklist / Suggestions / Timeline。**PT 単位のタイムラインや軽減可視化は無い** | ✅ |
| [MitPlan](https://github.com/MarbleSodas/MitPlan) (MIT) | ユーザー向け取込なし (開発用 CLI で cactbot / FFLogs と突合) | `src/data/timelines/*.timeline.json` に M5S/M7S/M8S、M9S〜M12S の **被ダメ表** (`time` / `unmitigatedDamage` / `damageType` / `isTankBuster` / `isRaidwide` / `phaseId`)。**絶は未収録** | ✅ |
| [Better Deaths](https://github.com/Nainaiowo/better-deaths) (Dalamud, MIT) | v2 (Deaths / DamageTaken / Buffs / Debuffs / Casts / CombatantInfo) | killing blow + overkill、有効バフ、HP + シールド、lead-up 10s/30s/1m、What-if 軽減。**v2 events だけで死亡解析が再構成できる実証** (表示はゲーム内 = 参考) | ✅ |
| ffreplay (MIT) | v2 `DamageTaken` + `includeResources` | 盤面リプレイ。座標変換は `gameData.map { sizeFactor offsetX offsetY }` | ✅ |
| xivodreview (AGPL) | v2 `fights` + `phases` + `events(Deaths)` | VOD 同期、死亡クリックで動画ジャンプ | ✅ |
| FFXIV Raidwide Planner (ffxiv-raidwide.vercel.app) | レポート URL 貼付 | PT 構成・タイムライン・初期軽減案を自動生成 | ⚠️ (到達不可) |
| Triggevent (Timeline Mitigation Recording) | レポート再生 | 軽減エントリをタイムラインへ記録 (クライアント常駐 = 参考) | ⚠️ |
| Lorrgs / Wipefest (WoW) | WCL v2 | CD タイムライン 3 要素バー / 死亡カットオフ + 定型 Insights | ✅ |

**含意**: 「ボスタイムライン × 計画軽減 × 実測軽減」を **Web だけで**重ねて出すツールは、FFXIV では確認できる範囲で存在しない。死亡解析は Better Deaths が「API だけで再構成できる」ことを示している。

### 4-3. サーバー側で使えるエンカウンタ・タイムラインデータ

| データ | ライセンス | 内容 | 使い方 / 制約 | 確度 |
|---|---|---|---|---|
| [cactbot raidboss timelines](https://github.com/OverlayPlugin/cactbot/tree/main/ui/raidboss/data) | **Apache-2.0** ✅ | `07-dt/raid/r1..r12{n,s}.txt` (M1S〜M12S)、`07-dt/ultimate/futures_rewritten.txt` / `dancing_mad.txt`。形式は `時刻 "技名" LogType { id: "9CD1" } window a,b jump/forcejump label hideall` ([TimelineGuide](https://github.com/OverlayPlugin/cactbot/blob/main/docs/TimelineGuide.md))。FRU 約 1,000 行、r12s 約 1,350 行 (label 13+、jump 24) | `timeline_parser.ts` は DOM 非依存で Node 流用可 ✅。ただし分岐・ループ・HP プッシュのある絶/零式では **静的に 1 本の時間軸にならない** → 時間軸ではなく **「ability ID (hex) → 技名・見出し」の辞書**として使う。ビルド時 vendoring (NOTICE 同梱) が安全 | ✅ |
| MitPlan `*.timeline.json` | MIT | 零式の被ダメ表 (独自加工値) | 「この全体攻撃に計画軽減が乗っていたか」の判定表 | ✅ |
| ff14-act.com timeline-data (JP) | 不明 | SpecialSpellTimer 向け | DNS 解決不能 (`ENOTFOUND`) → 現状入手不能 | ❌ |
| Materia Raiding / NAUR のタイムライン記述 | — | 未確認 (検索上限) | — | ❌ |

### 4-4. 「ボスタイムライン + 計画軽減 + 実測軽減」の描き方 (実現性の結論)

**描ける。ただし x 軸は cactbot ではなく FFLogs 実測を主にする。**

1. **x 軸** = そのプルの `events(dataType: Casts, hostilityType: Enemies, fightIDs: [N], useAbilityIDs: false, limit: 10000)` (`type: cast | begincast`)。`abilityGameID` (10 進) を hex 化して cactbot の `id` と突合し、cactbot の技名・`hideall`・見出しを **ラベル辞書**として借りる (分岐問題を回避)。
2. **フェーズ帯** = `phaseTransitions` + `report.phases` の名前。FFLogs がフェーズ定義していないエンカウンタは cactbot の `label` / MitPlan `phaseId` で代替。
3. **計画レイヤ** = 既存の Sheets 由来フェーズカード (`sheet-cards.tsx` が読んでいる表) の技名でボス詠唱にスナップ。JP 名 ⇄ EN 名は `masterData(translate: true)` で吸収。
4. **実測レイヤ** = `events(dataType: Casts, hostilityType: Friendlies)` を軽減アクション ID の許可リストでフィルタ (8 人 × 1 プルで数千件、1 ページ 10,000 で概ね収まる ✅ 推定)。Lorrgs 風に「Cast 時刻 + 効果時間 + リキャスト」の 3 要素バー。

- **コスト**: 1 プルあたり Casts (Enemies) 1 往復 + Casts (Friendlies) 1〜2 往復。`inProgress = false` の fight は不変なので **Supabase に永続保存して二度取らない**。
- **メリット**: 「軽減表はあるが守れているか」を、ヒーラー/タンクの記憶ではなくデータで議論できる。FFXIV の Web ツールに無い。
- **デメリット**: 軽減アクション ID 許可リストの保守 (パッチ毎)、cactbot 更新追従、JP/EN 技名対応、個人別バーの表示粒度 (ロール単位に丸めるか) の配慮。工数は本書の候補中で最大級 (大)。

### 4-5. 死亡解析 UX と「プル毎のワイプ原因サマリー」MVP

**既存の見せ方**: FFLogs Deaths タブ = 死亡時刻・近似 killing blow・直前の被ダメ/被回復 → クリックで death summary (「DoT が最後の一撃でも真因は別」の注意書きあり) ⚠️。Wipefest = 死亡カットオフ (終了 30 秒前以降の最初のクラスタのみ) + 定型 Insights ✅。Better Deaths = killing blow + overkill、有効バフ、HP + シールド推移、lead-up 10s/30s/1m、What-if 軽減 ✅。

**MVP (サーバーだけで計算可能) ✅**:

```graphql
query($code: String!, $fid: [Int]!) { reportData { report(code: $code) {
  fights(fightIDs: $fid) { id encounterID startTime endTime kill fightPercentage
    lastPhase lastPhaseAsAbsoluteIndex lastPhaseIsIntermission phaseTransitions { id startTime } }
  phases { encounterID separatesWipes phases { id name isIntermission } }
  masterData { abilities { gameID name } actors(type: "Player") { id name subType } }
  events(dataType: Deaths, hostilityType: Friendlies, fightIDs: $fid, limit: 10000, useAbilityIDs: false) { data nextPageTimestamp }
  rateLimitData { limitPerHour pointsSpentThisHour pointsResetIn }
}}}
```

- 各 death の `timestamp` / `targetID` / `killingAbilityGameID` → `masterData.abilities` で技名、`actors` でジョブ (`subType`)。
- **フェーズ** = `phaseTransitions` のうち `startTime ≤ death.timestamp` の最後、名前は `phases[encounterID]`。
- **ワイプ原因行** = 「最初の死亡 (時刻・ジョブ・技名・フェーズ)」+「N 秒以内の死亡数」+ Wipefest 式カットオフで「ワイプコール後の巻き添え」を除外。
- **表示は個人名ではなくロール / ジョブ表記**を推奨 (死亡は DPS ではないが、扇動的にならない粒度に)。
- **コスト**: 1 プル 1 往復 (fights / phases / masterData はレポート単位でキャッシュ)。Deaths は ≤ 8 件 / プルで極小。lead-up (HP 推移・有効バフ) を取る場合のみ +1 往復 / 死亡。

### 4-6. ACT / IINACT 側 — 準リアルタイムとレポート自動発見

- **ライブロギング**: Uploader がログ末尾を監視して逐次送信 (公式ヘルプのスニペット ⚠️)。API 側の観測点は `ReportFight.inProgress`、`Report.endTime / segments / revision` ✅。Webhook 相当は無い。
- **ポーリング実例**: [tomouchuu/fflogs-pull-stats](https://github.com/tomouchuu/fflogs-pull-stats) は `reports(userID, zoneID, startTime, limit: 10)` を **2 分間隔**で再実行 ✅ (約 30 回/h、軽量)。本 portal なら pg_cron (既に毎時 trigger の基盤あり) or Route Handler + 「練習日のみ有効化」フラグで `reports(guildID or userID, startTime: 当日 0 時)` → 新規 code 検出 → `fights` 差分取込、が妥当。
- **自動発見**: `reportData.reports(guildID | guildTagID | userID)` ✅ (scrape 不要)。static が FFLogs 上に guild (static ページ) を作り、メンバーが Uploader で static と Report Tag を選んでアップロードすれば `guildID` で一括取得できる。Archon の「Raid Team Support」(3-2) はこの運用を公式に後押しする方向。private レポートは所有者の user token で `userID` 指定。
- **出席**: `guild.attendance(guildTagID, zoneID)` で「レポート × 参加者」✅ → 出席簿の自動化 (個人 DPS ではないので方針に整合)。
- **IINACT**: 追加調査は未実施 ❌ (第 3 回 D-1 の「FFLogs Uploader と 100% 互換」から変化なしと推定)。Uploader は誰かの PC で動く前提であり、portal 側の設計には影響しない。

### 4-7. ログ由来の実装候補 (コスト / メリット / デメリット)

| # | 候補 | 主データ | API コスト目安 | メリット | デメリット / リスク | 確度 |
|---|---|---|---|---|---|---|
| L-A | **プル毎ワイプ原因サマリー** (初死亡: 時刻・ジョブ・技・フェーズ、死亡クラスタ数) | `events(Deaths)`, `phaseTransitions`, `phases`, `masterData` | 1 往復/プル、永続キャッシュ | 既存の練習ログ行に列を足すだけ。最小工数で最大効果 | killing blow ≠ 真因 (DoT)。ジョブ表記で個人非難色を抑える必要 | ✅ |
| L-B | **フェーズ滞在時間 / 到達ヒートマップ** | `phaseTransitions` | 追加コスト無し (fights と同時取得) | 「P3 に何分費やしたか」の prog 可視化。既存 `lastPhase` の自然拡張 | FFLogs がフェーズ定義していないエンカウンタでは不可 | ✅ |
| L-C | **ボスタイムライン (実測詠唱) × 計画軽減 (Sheets) × 実測軽減 (Casts)** | `events(Casts)`, cactbot 技名辞書, MitPlan 被ダメ表 | 2〜3 往復/プル (`limit: 10000`)、永続キャッシュ | FFXIV の Web ツールに無い。「予定と実際のズレ」が一目 | cactbot 追従、軽減 ID 許可リスト保守、JP/EN 技名、個人別バーの粒度 | ✅ 実現性 / ⚠️ 工数 |
| L-D | **死亡 lead-up ミニ recap** (HP / シールド推移・有効バフ・被ダメ列・ダメージダウン debuff 1002911) | `events(DamageTaken, includeResources: true)`, `Buffs` | +1 往復/死亡 | Better Deaths 相当を Web で。「軽減が乗っていなかった」を客観化 | 帯域大 (includeResources)。What-if 計算は軽減率テーブルの保守が必要 | ✅ |
| L-E | **レポート自動発見 + ライブ取込** (2 分ポーリング) | `reportData.reports(guildID / userID, startTime)`, `inProgress` | 約 30 往復/h (練習日のみ) | URL 手入力・scrape を廃止。ライブログ中に次プルまでに前プルの L-A/L-B が出る | Webhook 無し。static を FFLogs guild として登録する運用が前提 | ✅ |
| L-F | **出席簿の自動化 / ○×△ との突合** | `guild.attendance(guildTagID, zoneID)` or fights の `friendlyPlayers` + `masterData.actors` | 1 往復/日 | 「○なのに不在 / △なのに参加」の差分が自動で出る。手入力ゼロ | guild/tag 運用、または actors とメンバー表示名の対応表が必要。可視範囲は本人 + 幹部に限定 | ✅ |
| L-G | **死亡位置スナップショット** (アリーナ上に x, y) | `targetResources.x/y`, `gameData.map { sizeFactor offsetX offsetY }` | L-D と同時取得 | 「どこで死んだか」を図示 (Replay の簡易版) | 座標変換の実装 (ffreplay 参照)、マーカー座標は API に無い、アリーナ画像の権利 | ⚠️ |
| L-H | **セッションサマリー** (拘束時間・戦闘時間 vs ダウンタイム・平均プル長) | 既存 `fflogs_fights` の `startMs / endMs` | 追加コスト無し | 2-2 の概念。既に持っているデータの集計のみ | 「ダウンタイム」を休憩と区別できない (表示文言で吸収) | ✅ |

**推奨順**: L-A → L-B → L-H → L-E → L-F → L-C → L-D → L-G。L-A / L-B / L-H は既存のプル行モデルに列を足すだけで、ポイント消費もごく小さい。L-C は差別化要素だが cactbot 依存を「名前辞書」に限定して x 軸は実測に置くことで保守リスクを下げられる。

---
## 5. 国内ツールと公式動向 (2026-09-06 時点)

### 5-1. 国内の新顔・差分 (既出リストに無いもののみ)

| 名称 | 概要 | 本 portal への示唆 | 確度 |
|---|---|---|---|
| [GuildHub](https://github.com/mattyan1053/ff14-guildhub) (mattyan1053/ff14-guildhub) | 2026-07-20 作成、最終 push 08-24。TypeScript 製 Discord Bot、Docker Compose でセルフホスト。「FF14 の固定活動を中心とした Discord コミュニティ向け運営支援 Bot」。実装中: スケジュール調整 (候補日時登録 → 回答 → 確定 → リマインド)。将来予定: 出欠・投票・募集・連絡事項・進捗管理・メンバー管理。★0、開発初期 | 今期唯一確認できた**国内発の固定運営ツール新顔**。方向性は本 portal と同一だが **Discord 内で完結** (Web に飛ばない) が差分 → 出欠回答を Discord のボタンでも受ける案 (W-21) | ✅ (GitHub) |
| [KNT Tools for FFXIV](https://knt-a.com/) | 個人開発 Web ツール群: 絶武器取得チェックリスト、**BiS 取得状況チェックリスト**、まとめて幻影化、**PT 募集文ジェネレータ** (希望武器制ジョブ管理 → 募集文反映)、新式素材計算。7.51 / 7.55 対応更新を継続 | ロット表に「BiS 取得率 (n / 11)」の個人進捗 (W-23)。欠員補充時の **募集文テンプレ生成** (W-28) | ⚠️ (サイト取得不可、複数ブログ言及) |
| 軽減表作成サイト (2026-01 公開、名称未特定、[馬鳥速報 X](https://x.com/umadori0726/status/2012496122342756601)) | 「ヘビー級零式や絶の軽減表が作成でき、作成者が許可していればコピーも可能」。t.co 短縮で実体 URL 未特定 | **ネイティブ軽減表エディタ + 共有 / コピー許可**という方向の国内先行例 | ⚠️ (単一ツイート) |
| [らすと (Last Agous) 軽減表タイムライン](https://note.com/lastagous/n/ncfcb027117fd) | Google Sheets ベース。**FF Logs から軽減表タイムラインを自動生成**、不要行の非表示、チャット用テキスト整形。ヘビー級零式版を 2026-01 に配布 (Lodestone 日記)。サポート Discord あり | 「FFLogs → 軽減表の実績列」自動化の国内実例。本 portal は FFLogs 連携済みなので W-10 / L-C に直結 | ✅ (note 複数 + Lodestone + X) |
| [ぶんちりー 軽減表タイムラインシート 7.5](https://bunchiry.com/ff14-mitst-7x/) | Google Sheets 配布、7.5 対応 | 軽減表テンプレの参照実装 (カードビューのパース規約を確認する材料) | ✅ |
| [xivtlsheet](https://github.com/okapiffxiv/xivtlsheet) (okapiffxiv、xivraidteam と同作者) | GAS。ACT ログ or FFLogs 戦闘 ID から**零式タイムライン表を自動生成**、シナジー発動グラフ、召/黒のアクション可視化。61 コミット | 「シナジー窓の重なり」可視化の参考 (個人 DPS を出さずに PT の噛み合わせを見る例) | ✅ |
| FFTimelines (β) (yukapero.com、[Lodestone 日記](https://na.finalfantasyxiv.com/lodestone/character/18968752/blog/3918607/)) | 動画連携型タイムライン作成・共有 Web。登録制 | 既存の動画ジャンプと同発想。2026 の稼働状況は未確認 | ⚠️ |
| [FF14 タイムライン読み上げるやつ](https://timeline-reader.pages.dev/) / [FF14-Timeline-Voice-Coach](https://github.com/leo04264/FF14-Timeline-Voice-Coach) (2026-08) | ブラウザ TTS でタイムライン読み上げ (ゲーム状態は読まない) | **戦闘中の外部補助はグレー** → 1 章の「参考」区分。見送り | ⚠️ / ✅ |
| [Gamee](https://blog.gamee.games/ff14-fixed-pt-friend-recruitment-2026/) | ゲーム友達募集アプリ。2026 年に FF14 固定募集記事を連続投稿 | 募集はポータル外。**加入後のオンボーディング**が本 portal の守備範囲 (W-22) | ✅ (自社ブログ、宣伝性に注意) |
| [Gran Sacbe 零式固定かんたん管理ツール Ver 6.2.c](https://na.finalfantasyxiv.com/lodestone/character/19187632/blog/5079482/) | スプレッドシート。**断章交換を考慮した自動ロット判定 (ロットチェッカー)**。6.2 期 | 「断章交換を織り込んだ優先度提案」の国内ロジック例 (W-24) | ⚠️ (旧いが未既出) |
| Notion で FF14 (まくしえ note 3 本) / TimeTree 固定利用 (Lodestone 日記) | 汎用ツールの固定転用記事 | 借りる物は薄い (Notion のビュー切替は 8 章 UI-5 の参考) | ⚠️ |
| [Catacatata/ff14-calendar](https://github.com/Catacatata/ff14-calendar) | 中国サーバー版のメンテ・パッチ日程を ICS 生成 | 公式メンテ日程を固定カレンダーへ合成 (W-30) | ✅ |

Lodestone コミュニティファインダーは 2026 年の新機能なし、固定専用の募集区分も無し ⚠️。公式フォーラムには「マクロを共有できるようになると嬉しい」([threads/527131](https://forum.square-enix.com/ffxiv/threads/527131)) の要望、8.0 新難易度のスレ ([threads/529893](https://forum.square-enix.com/ffxiv/threads/529893)) がある ✅。

### 5-2. 公式動向

| 項目 | 内容 | portal への含意 | 確度 |
|---|---|---|---|
| 現行パッチ | **7.55** (2026-07-28)。**7.56 = 2026-09-08 (火)** — 7.x 最終。新リミテッドジョブ「魔獣使い」、ソロコンテンツ「闘獣練」 | 9/8 メンテと活動日の衝突警告 (W-30) の実例 | ✅ |
| 7.5x の系譜 | 7.4 (2026-01 至天の座アルカディア零式ヘビー級) → 7.45 (03) → 7.5 (04-28) → 7.51 (絶妖星乱舞) → 7.55 | 現行ティアの残期間は約 4 か月 | ✅ / ⚠️ (7.51 内容) |
| リージョン内フリーマッチング | DC の垣根を越えた CF マッチング・PT 募集・ワールド間テレポ。**7.5x 中に日本リージョンでテスト開始** ([公式 X](https://x.com/FF_XIV_JP/status/2047743466885820496)) | 野良補充の母集団が広がる → 募集文ジェネレータ (W-28) の価値が上がる。メンバー行に DC 表記 | ✅ |
| **8.0「白銀のワンダラー」** | **2027 年 1 月発売** (Lodestone / PR TIMES)。具体日・アーリーアクセスは未発表。Lv 100 → 110。新ジョブ: タンク **バスティオン** (ベルリンで発表) + 遠隔物理 DPS (**東京ファンフェス 10/31〜11/1 で発表予定**)。既存ジョブに REBORN / EVOLVE モード | 第 1 回 C-3 (立ち上げウィザード・難易度軸分離) の期限は変わらず 2026-12 | ✅ |
| 8 人レイド新難易度 | ノーマルと零式の中間。ベルリン基調講演で「極相当以下の新レイヤー、クリアで **シーズンギア** を入手・成長させ零式装備に近い性能まで育てられる」。**正式名称は未発表** (公式フォーラムも「新難易度(仮)」) | カテゴリの難易度モデルは **設定値で吸収** (enum 固定にしない)。ロット対象に「シーズンギア」を足せる余地 | ✅ / ❌ (名称) |
| 8.0 のコラボ | 8 人レイド = FF7 リメイクシリーズとのクロスオーバー、アライアンス = エヴァンゲリオン「Ghosts of Desire」 | テーマ (Evercold) は既に実装済 | ✅ |
| 8.0 のシステム | **デイリー廃止 → 週単位ボーナス制**、アラガントームストーンは **2 週管理** (前週分の遡り取得可)、キャラクリのフルカラーピッカー | 「今週の消化チェック」(火 17:00 JST リセット) の論理を「2 週ウィンドウ」に対応させる必要 (W-33) | ✅ |
| 8.0 の UI / PT 募集 / ストラテジーボード / ウェイマーク / マクロ改修 | 公式発表を確認できず | 第 3 回 B/C の判断 (ウェイマーク入出力なし・ボードは最小保管) を維持 | ❌ |
| Switch 2 版 | **2026-08-04 サービス開始** (クロスプレイ、フリートライアル、タッチ操作) | 第 3 回 A-4 の「予定」表記を「開始済」に更新。コンソール勢混在の前提は確定 | ✅ |
| ファンフェス 2026 | アナハイム 4/24〜25、ベルリン 7/25〜26、**東京 (幕張) 10/31〜11/1**。ロンドン / 上海は無し | 東京で 8.0 の残り情報 (2 ジョブ目・発売日) が出る見込み → 11 月に 8.0 準備の再確認 | ✅ |
| 外部ツール | 公式スタンス「一切禁止」は不変。2025-01 PlayerScope に削除要請・法的措置検討 ✅。**2026-07 に同種のストーカーツール EchoVault が報告** ⚠️。2026-08 吉田 P「MOD の使用を執拗に追跡・詮索する必要はない」旨の発言 ⚠️ (単一ソース)。2026 年の新規処罰事例は確認できず ❌ | FFLogs / ACT 由来データの表示は従来通り許容圏。**Lodestone ID をキーにした横断保存はストーカーツール問題と同じ火種** → 1 章の補足 | ✅ / ⚠️ |

### 5-3. 国内固定の運営上の困りごとと解決状況

| 困りごと | 声 (ソース) | ツールで解けているか |
|---|---|---|
| **出欠が集まらない / 予定が合わない** | 「8 人のスケジュールが合わない」、「週 5 活動と言って週 2 に × をつける」(クポ速)、「週 6 なのに今週 2 回」(馬鳥速報)、「7.4 零式固定 8 人集まらない」(知恵袋) | 収集・催促・確定は解決済 (本 portal / こてまる / xivraidteam / GuildHub)。**未解決: 募集時の活動日数の期待値ズレ** — 馬鳥速報の慣行「募集時に 1 か月分の予定を提出させる」は手作業 (W-22) |
| **遅刻** | 「5 分遅刻が常態」「事前連絡があれば可」「回数制限」が掲示板・知恵袋で頻出 (6 章) | ○×△ では「出るが遅れる」を表現できない → **遅刻の事前申告を構造化** (W-13) |
| **ロットの揉め・ルール理解** | 「揉めたくない」、左取り抜け / フリロ / 買い取りの違い、「初零式でロットの仕方が分からない」 | 部分解決 (断章交換込みの自動判定 = Gran Sacbe、優先度自動計算 = Raid Planner)。**未解決: ルールの合意形成と可視化** |
| **共有した攻略情報が読まれない** | 「何の話？」「見てなかった」(クポ速) | **未解決**。本 portal の Discord 自動取り込みは「集約」までで「既読」が無い (W-27) |
| **練習の振り返り** | FFLogs の見方記事は多数 (あせろぐ等) だが個人向け | 固定単位の振り返りは海外個人開発が先行 (3-1)。焦点は「死亡 + ダメージダウン + 軽減使用」= 本 portal の方針と整合 (L-A / L-D) |
| **モチベ・解散・補充** | 上達意欲の欠如、1.5 か月で見込み無しと判断し解散、8 人揃わず補充が負担 | ツール未対応。到達度の推移可視化 (練習ログ) と進行トレンド (W-4)、チーム実績バッジ (W-31) が間接的に効く |
| **Discord サーバー構成に迷う** | 知恵袋 | テンプレ記事が少ない → 「推奨チャンネル構成 + Webhook 設定手順」を README に (W-34) |
| メンバー入れ替え時の引き継ぎ | 有力な記事は検索上限のため未確認 ❌ | 第 1 回 B-3 学習パスが該当 |

---

## 6. スケジュール・出欠 UX (Discord bot / 日程調整 Web の横断)

本 portal の自前作成式スケジュールは「候補日 → ○×△ + コメント → 全員回答で自動確定 → Discord 通知 / 未回答者への毎時 @mention → Google カレンダー導線 → 過去回と FFLogs / 動画の接続」まで持っている。ここに**無いパターン**を Raid-Helper / Apollo / Sesh / Chronicle / Discord 標準イベント / デイコード / xivraidteam / Mawiszus bot / Throney / WoWAudit / Guilded / Crab Fit / When2meet / Rallly / 伝助 / 調整さんから抽出した。

### 6-1. 比較の要点

| パターン | どのツールが持つか | 本 portal に無い点 | 確度 |
|---|---|---|---|
| **遅刻 / 早退 / 補欠 (Tentative / Late / Bench)** の構造化ステータス | Raid-Helper (Tentative / Late / Bench / Absence ボタン)、WoWUtils (Late / Standby)、xivraidteam (開始可能時刻の入力、空欄 = 不参加) | ○×△ のみ。「出るが 21:30 になる」を表現できない | ⚠️ / ✅ |
| **定期枠 + 例外** | Apollo (繰り返し、毎回 RSVP 初期化、無料 5 系列)、Atomcal、Discord 標準 (`recurrence_rule` は weekly で 1 曜日のみ・終了指定不可 ✅ API docs)、デイコード (**期間 + 曜日で候補を一括生成**) | 候補日は毎回入力 | ✅ |
| **タイムスタンプの相対表示** | Discord の `<t:unix:F>` / `<t:unix:R>` (閲覧者の TZ とロケールで描画 ✅ API docs) | 通知本文は固定文字列 | ✅ |
| **催促の頻度モデル** | デイコード = 回答期限到来時に 1 回 + 当日 1 回 | 本 portal は毎時 @mention → 日本の固定文化では「催促圧」と感じられる可能性 ⚠️ | ✅ |
| **デフォルト出席・例外だけ申告** | WoWAudit (Present が初期値、幹部が RSVP をドラッグで修正可)、Guilded (主催が他人の RSVP を追加 / 削除) | 幹部による代理入力が無い | ⚠️ / ✅ |
| **空き時間ヒートマップ (曜日 × 時間)** | Crab Fit (GPLv3、Specific dates / Days of the week の 2 モード ✅)、When2meet、LettuceMeet | 枠決め段階の可視化が無い | ✅ |
| **成立判定の自動化** | Mizarsid / silky 系シート「1 人でも × なら活動なし」 | 全員回答での確定はあるが「中止候補」の提案が無い。「開始 2h 前に 8 人未満 → 中止」を持つ bot は未確認 ❌ | ✅ / ❌ |
| **iCal 購読** | Sesh / Apollo (iCal 提供)、Chronicle (GCal → Discord イベント) | Google カレンダーへの単発リンクのみ。購読は Google 側で 8〜24 時間遅延 ✅ | ✅ |
| **出席統計** | WoWAudit / Throney (出席ポイント → ロット) / Raid-Helper Premium | 統計が無い。国内文化では順位・バッジで競わせる文脈は見当たらず (6-2) | ⚠️ |
| **VC 在室者の一括出席記録** | Throney / CoGM (1 コマンド) | — (Web 完結なので該当なし。FFLogs の参加者で代替 = L-F) | ⚠️ |
| **臨時日提案の投票** | static-raid-coordinator (最大 8 名投票) | 候補日の追加は admin のみ | ✅ |
| **Web Push (PWA)** | — | iOS はホーム画面追加時のみ。Discord @mention と二重になる → 見送り | ✅ |

### 6-2. 国内固定文化との整合 (判断材料)

- 掲示板・知恵袋・まとめでは「遅刻理由が曖昧だと揉める」「ルールを決めておけば安心」という論調が主で、**順位やバッジで競わせる文脈は見当たらなかった** ⚠️。公開ランキングや streak は 8 人という小集団では特定個人への圧になりやすく、モラル面のリスクが高い (この評価は推論)。→ 出席サマリーは「本人には自分の履歴、幹部には集計のみ」に限定 (W-19)。
- 「自動中止」は「まだ来るかも」の余地を潰す冷たさがある → まず **中止候補の提案 → 幹部がワンクリック確定** (W-17)。
- デイコード方式 (期限ベースの催促 1〜2 回) が国内で受容されている実績を踏まえ、催促頻度は設定可能に (W-20)。

候補の詳細 (メリット / デメリット / コスト) は 7 章の W-13〜W-22。

---
## 7. 機能候補 総合表 (メリット / デメリット / コスト / 優先度)

6 領域の候補を統合し、重複を排除して **W-番号** で通し番号を付けた。コスト感: 極小 (数時間) / 小 (1〜2 日) / 中 (1 週) / 大 (数週)。優先度: ★★★ すぐ / ★★ 秋〜12 月 / ★ 8.0 以降 or 運用次第 / ☆ 見送り寄り。スコープは 1 章の基準で **全て「採用可」** (「参考」「対象外」は 9 章に分離)。前 3 回で提案済みのものは「元ネタ」に旧番号を併記。

### 7-A. ログ由来 (練習ログの拡張)

| # | 機能 | 元ネタ | メリット | デメリット / リスク | コスト | 優先 |
|---|---|---|---|---|---|---|
| W-1 | **プル毎ワイプ原因サマリー** (初死亡の時刻・ジョブ・技名・フェーズ、N 秒内の死亡数) を練習ログの pull 行に列追加 | 4-7 L-A / FFLogs Deaths / Wipefest / Better Deaths | 反省会の起点が自動で出る。1 往復/プルで API コスト極小。`fflogs_fights` に列を足し既存 sync (`fflogs-fights.ts`) を拡張するだけ | killing blow ≠ 真因 (DoT・遅延死)。**個人名ではなくジョブ / ロール表記**にして扇動的にならない粒度に。CHECK 制約と RLS の追加が必要 | 小 | ★★★ |
| W-2 | **フェーズ滞在時間 / 到達ヒートマップ** (`phaseTransitions` から P1〜P4 の滞在秒を集計、日 × フェーズの熱量表) | 4-7 L-B / WoWAnalyzer TimelineHeatmapGrid | fights と同時取得で追加コスト無し。「P3 に何分費やしたか」が prog の実感と一致する | FFLogs がフェーズ定義していないエンカウンタでは出ない (零式は層 = encounter で代替) | 小 | ★★★ |
| W-3 | **セッションサマリー** (拘束時間・実戦闘時間・ダウンタイム比・平均プル長・pull 数・kill/wipe) を日ヘッダーに | 4-7 L-H / raidTimeline / MRT | 既存データの集計のみ。固定の"効率"が数字で残り、休憩の取り方や開始時刻の議論に使える | 「ダウンタイム」に休憩・解説時間が混ざる (文言で吸収) | 小 | ★★ |
| W-4 | **進行トレンドグラフ** (pull 毎 best% / 到達フェーズの折れ線、累積 pull、pace) を練習ログ上部 + コンテンツカードにスパークライン | WCL Progress / Warcraft Insights / Raider.IO / 第 1 回 A-1 の未実装分 | 「日ごとのバー」を時系列化。「このペースならクリアまで何 pull か」の目安 | グラフ描画ライブラリの追加 (bundle)。dataviz の色を 8 章 UI-12 と揃える | 中 | ★★ |
| W-5 | **レポート自動発見 + ライブ取込** (`reportData.reports(guildID / userID)` を練習日のみ 2 分ポーリング、新 code を自動登録) | 4-7 L-E / tomouchuu/fflogs-pull-stats / Archon Raid Team | URL 貼り付け・scrape 経路を廃止できる。ライブログ中に前プルの W-1/W-2 が次プルまでに出る | Webhook 無し。**固定が FFLogs 上に static (guild) を作り Uploader で選ぶ運用**が前提。private は user token。pg_cron の毎時 → 練習日のみ 2 分の設計変更 | 中 | ★★ |
| W-6 | **出席の自動突合** (`guild.attendance` or fights の `friendlyPlayers` → ○×△ 回答との差分「○なのに不在 / △なのに参加」) | 4-7 L-F / WCL Attendance / WoWAudit | 手入力ゼロ。W-19 の出席サマリーのデータ源になる | actors とメンバー表示名の対応表が必要。可視範囲は本人 + 幹部に限定 (6-2) | 小〜中 | ★ |
| W-7 | **ミス注釈** (pull 行にテンプレ付きタグ: AoE 被弾 / スイッチ遅れ / 軽減不足 …、個人 or チーム帰属、傾向グラフ、Discord 用サマリ生成) | shiraishiyokai/ffxiv-raid-tracker / ff14-logs-review-skill | FFLogs に無い「なぜ」を残せる。W-1 の自動値に人の判断を重ねられる | 個人責任の可視化は雰囲気悪化の恐れ → **既定はチーム帰属、個人タグは本人のみ**等の運用設計が必須。新テーブル + RLS | 中 | ★ |
| W-8 | **死亡 lead-up recap** (HP / シールド推移、有効バフ、直前 3 ヒット、ダメージダウン debuff 1002911 のハイライト) を pull 詳細に展開行で | 4-7 L-D / Better Deaths / berry-fflog-analyzers / Wipefest 死亡行 | 「軽減が乗っていなかった」を客観化。Better Deaths 相当を Web で | `includeResources` で帯域大。+1 往復/死亡。What-if 軽減は軽減率テーブルの保守が要る | 中 | ★ |
| W-9 | **軽減 計画 × 実測タイムライン** (実測ボス詠唱の x 軸 + Sheets の計画カード + `events(Casts)` の実使用を Lorrgs 風 3 要素バーで重ねる) | 4-4 L-C / Lorrgs / Viserio / らすと | FFXIV の Web ツールに無い差別化。「軽減表はあるが守れているか」をデータで議論 | 工数最大。軽減 ID 許可リストのパッチ毎保守、cactbot 追従、JP/EN 技名、個人別バーの粒度。**8.0 の軽減再編後に着手**する方が保守が楽 | 大 | ★ |
| W-10 | **FFLogs → 軽減表雛形の自動生成** (新層初週に実測プルのボス詠唱・被ダメ行を TSV / CSV で出力 → Sheets に貼る) | XIVtimelineMaker / らすと / mu-ns / 第 1 回 C-1 の代替 | 新層の軽減表作成が大幅短縮。Sheets を「正」とする方針を崩さない (書込 API は使わず貼り付け方式) | 新層初週にしか効かない。W-9 の部分集合なので W-9 を作るなら不要 | 小〜中 | ★ |
| W-11 | **動画オフセットの「ここで同期」校正** (pull 一覧の死亡や pull 開始をクリック → 動画のその瞬間で「ここ」を押すとオフセット確定、微調整 ±1s) | xivodreview-local | 既存の「レポート開始 = 動画の何秒か」入力を、数字を数えずに済む UI に置換。動画ジャンプの精度が上がる | 動画プレイヤーの現在時刻取得 (YouTube IFrame API) の実装 | 小 | ★★ |
| W-12 | 死亡位置スナップショット (x, y をアリーナ上に描画) | 4-7 L-G / ffreplay | 「どこで死んだか」を図示 | 座標変換の実装、アリーナ画像の権利、マーカー座標は API に無い。ffreplay へのリンク (W-32) で足りる | 中 | ☆ |

### 7-B. スケジュール・出欠

| # | 機能 | 元ネタ | メリット | デメリット / リスク | コスト | 優先 |
|---|---|---|---|---|---|---|
| W-13 | **遅刻 / 早退の構造化ステータス** (○×△ + 「遅刻 到着予定 HH:MM」「早退 HH:MM まで」。実質開始時刻を確定通知に載せる) | Raid-Helper Late / xivraidteam 開始可能時刻 / 5-3 | 国内固定で最も揉める「遅刻」を事前申告に変える。自己申告なのでモラルリスク低 | △ との役割分担を UI で明確に (△ = 未定、遅刻 = 出るが遅れる)。`native_schedule_attendances.symbol` の CHECK 制約と自動確定判定の変更 | 小〜中 | ★★★ |
| W-14 | **Discord 通知の `<t:unix:F>` / `<t:unix:R>` 化 + Web の「本日活動」カウントダウンバナー** (あと 2 時間・回答 7/8) | Discord API docs ✅ / Guilded | ほぼ無コストで「あと何時間」「未回答 1 人」が見える。TZ 混在メンバーにも自動対応 | なし (Discord 側は文字列置換のみ) | 極小〜小 | ★★★ |
| W-15 | **定期枠テンプレ + 例外** (毎週 X 曜 21:00 を期間 + 曜日で一括生成、「今週スキップ」「今回だけ 22:00」の例外操作) | デイコード / Apollo / Discord `recurrence_rule` | 毎週の候補日入力が消える。デイコードの「期間 + 曜日」生成が国内で実証済み | 例外 UI が無いと定期化は逆効果。層クリア後の枠変更フローも必要 | 中 | ★★ |
| W-16 | **iCal 購読フィード** (メンバー別トークン URL、確定セッションのみ) | Sesh / Apollo / Chronicle | Google / Apple / Outlook で自動同期。既存の単発 Google カレンダーリンク (`calendar-link.ts`) と共存 | Google 側の取り込みが 8〜24 時間遅延 → 「中止・時刻変更の正は Discord 通知」と明記。Route Handler + トークン発行 | 小 | ★★ |
| W-17 | **成立判定ルールの明示化** (「1 人でも × → 中止候補」「開始 2h 前に 8 人未満 → 中止提案」を幹部へ提案 → ワンクリック確定) | Mizarsid / silky シート / 6-2 | pg_cron が既にあるので判定は容易。「中止候補」の提案モードなら冷たさを回避 | 完全自動中止は「まだ来るかも」の余地を潰す → 提案止まり | 小〜中 | ★ |
| W-18 | **有志練習 (任意参加) セッション種別** (自動確定閾値・未回答催促・出席統計から除外) | Apollo tentative 運用 / Discord Interested | 「参加できる人だけ」を公式化。既存フラグの追加で成立 | 本活動との区別を UI で強く出さないとコミットが薄まる | 小 | ★ |
| W-19 | **出席サマリー** (本人 = 自分の履歴、幹部 = 集計。公開ランキング・streak は作らない) | WoWAudit / WCL Attendance / 6-2 | 次層の枠決め・補欠検討の根拠。過去セッションデータが既にある | 8 人固定での公開は個人攻撃化しやすい → 可視範囲を絞る設計が前提 | 小 | ★ |
| W-20 | **催促頻度の設定** (現行の毎時判定 → 期限ベース 1 回 + 当日 1 回 / 1 日 1 回 を選択) | デイコード | 国内で受容されている頻度に合わせ「催促圧」を下げられる。既存 `attendance-reminder-section` に選択肢を足すだけ | 回答遅延が増える可能性 | 極小 | ★★ |
| W-21 | Discord ボタンで ○×△ 回答 (催促メッセージに回答ボタン、Web と双方向同期) | GuildHub / Raid-Helper | Web を開かない層の入力率向上 | Bot の Interactions endpoint (署名検証) 常駐運用、二重管理。Vercel の serverless でも可能だが運用面が増える | 中 | ★ |
| W-22 | 加入前アンケート / 月間予定提出ページ (招待リンク → 活動日数・時間帯・ロットルール同意) | 馬鳥速報の慣行 / Gamee / static-raid-coordinator | 期待値ズレ由来の解散を減らす | 単発利用で ROI 低め。B-3 学習パスと束ねると価値が出る | 小 | ☆ |

### 7-C. ロット・装備

| # | 機能 | 元ネタ | メリット | デメリット / リスク | コスト | 優先 |
|---|---|---|---|---|---|---|
| W-23 | **BiS 取得率バッジ** (n / 11 部位。ロットタブの BiS リンク行に、xivgear `fulldata` の部位一覧 × メンバーの「取得済」チェック) | KNT Tools bis / FFXIV Raid Planner / 第 1 回 A-4 の残り | 消化週の「残り目標」が一目で分かる。既存の xivgear 取得 (`xivgear-fetch.ts`) と週次チェック (`loot_weekly_checks`) の間を埋める | 「取得済」を誰が入力するか (本人 or admin)。Sheets のロット表と二重にならないよう「部位 × 取得済」だけに絞る | 小 | ★★ |
| W-24 | **ロット優先度の自動提案 + 断章カウンタ** (週の断章枚数 vs 交換必要数、部位別の必要人数、提案は人が確定) | Gran Sacbe ロットチェッカー / FFXIV Raid Planner / ffxiv-loot-optimizer | 「誰が取るべきか」の議論を短縮。8 週完成の見通し | ルールが固定ごとに多様 (左取り抜け / 優先制 / フリロ) → **提案止まり**にし確定は人が押す。Sheets との二重管理リスク | 中 | ★ |
| W-25 | **ボス別「欲しい人」行列 + 3 色セマンティクス** (層 × 部位 × メンバー、緑 = 最良 / 黄 = 代替あり / 灰 = 済) | WoWAudit wishlist / That's My BIS / TMB | 「誰がどこで何を待っているか」が一目。W-23 のデータから派生できる | W-23 が前提。表の密度が高いので 8 章の可読性指針に従う | 小〜中 | ★ |
| W-26 | ロット履歴 (誰が何をいつ、理由) | RCLootCouncil / TMB | 揉めた時の記録 | Sheets のロット表に既にある。二重管理 | 小 | ☆ |

### 7-D. 情報共有・運営・通知

| # | 機能 | 元ネタ | メリット | デメリット / リスク | コスト | 優先 |
|---|---|---|---|---|---|---|
| W-27 | **攻略リンクの既読チェック** (メンバー別「見た」ボタン、カードに「未読 n 人」、活動前催促に未読リンクを同梱) | 5-3 クポ速「見てなかった」 | 国内固定の未解決課題に直撃。Discord 自動取り込みの「集約」を「到達」まで伸ばす。新テーブル 1 つ | 監視感 → 表示は「未読 n 人」程度に、誰が未読かは幹部のみ | 小 | ★★★ |
| W-28 | **PT 募集文ジェネレータ** (欠員時の野良補充: コンテンツ・フェーズ・希望武器・時間・DC を変数差し込み) | KNT Tools / 5-2 リージョン内マッチング | 既存の募集テンプレ (`recruitment_templates`) に変数を足すだけ。DC 越えマッチングで母集団が広がるほど効く | 単純機能 | 小 | ★★ |
| W-29 | 公開用「募集カード」ページ (prog point・曜日時間・募集ロール・期待値・連絡先。Discord ゲートの外に 1 枚) | XIV Recruit / Archon Raid Team / r/FFXIVRECRUITMENT の慣行 | 欠員時のみ有効化。募集の一次情報が Web に 1 枚ある | single-tenant では頻度が低い。公開面にはメンバー個人情報を載せない設計 | 小 | ☆ |
| W-30 | **公式メンテ / パッチ日程の登録 + 活動日との衝突警告** (app_settings に手入力 → スケジュールに帯表示、iCal にも合成) | Catacatata/ff14-calendar / 7.56 メンテ 9/8 | 「今夜メンテだった」を防ぐ。公式 API が無いので手入力だがコスト極小 | Lodestone トピック監視まで自動化すると scrape 依存になる → 手入力で十分 | 極小〜小 | ★★ |
| W-31 | **チーム実績バッジ** (初クリア日、ノーデスクリア = `deaths = 0 && kill`、クリア回数、上書きルールを明文化) | Raid Report Flawless / Dungeon Report / MRT | 既存の `deaths` / `kill` 列から算出可能。個人ではなくチームの実績なので方針に整合。消化期のモチベに効く | バッジの乱発は陳腐化 → 種類を 3〜4 に絞る | 小 | ★★ |
| W-32 | **リンク判定辞書の追加** (`link-site.ts`): ffreplay (公開ホストは要確認) / knt-a.com / xivraidplanner.app / xivrecruit.com / thepfstrat 系 / tomestone static ページ | 3-1 / 3-2 | 極小コスト。Discord 取り込みの整理精度が上がる | 外部依存のみ | 極小 | ★★ |
| W-33 | **8.0 準備** (①カテゴリの難易度を設定値化し「新難易度 (仮)」「シーズンギア」を受けられるように ②消化チェックのリセット論理を「2 週ウィンドウ」対応に ③メンバー行に DC 表記 ④第 1 回 C-3 の立ち上げテンプレ) | 5-2 / 第 1 回 C-3 | 2027-01 に慌てない。スキーマに触る部分は現ティア中に | 名称・仕様が未確定 → enum 固定にせず設定値で吸収。東京ファンフェス (11/1) 後に再確認 | 小〜中 | ★★★ (期限 2026-12) |
| W-34 | **ドキュメント 2 本**: ログ担当の手引き (計測担当・パッチ週の注意・Auto Logging・unlisted 推奨) / 推奨 Discord チャンネル構成 + Webhook 手順 | 第 3 回 D-1 / 5-3 知恵袋 | 導入障壁と「誰がログを回すか」の属人化を下げる。コード変更なし | — | 極小 | ★★ |
| W-35 | **Discord 通知のイベント駆動化** (新レポート到着 / ベスト到達更新 / 初クリア / 軽減表・マクロ更新) | RaidHub `/subscribe` / WCL 30 秒更新 / 第 1 回 B-4 | portal を見に来る動機になる。W-5 の取込結果と W-31 の判定をそのまま流せる | 通知過多 → 種類ごとに ON/OFF (既存の通知トグル基盤を流用) | 小 | ★★ |

### 7-E. 前回からの継続候補 (再掲・再評価)

| 旧番号 | 機能 | 今回の位置づけ | コスト | 優先 |
|---|---|---|---|---|
| B-1 | 攻略リンクのフェーズ / ギミックタグ | W-27 (既読) と同じカード改修で同時に入れると安い。`tags` テーブルは既存 | 小 | ★★ |
| B-3 | 新規メンバー学習パス (動画 → 散開図 → マクロ → 軽減表の順序付きチェックリスト) | W-22 (加入前アンケート) と束ねて「オンボーディング」1 機能に | 小〜中 | ★ |
| B-5 | 個人ページ `/me` (自分の担当軽減 / 残り BiS / 出欠 / 直近ログ) | W-19 (本人向け出席履歴) + W-23 (BiS 取得率) が揃うと自然に成立。新規データ無し | 中 | ★ |
| C-2 | 動画の自動チャプタリング | W-11 (同期校正) でオフセット精度が上がってから | 中 | ★ |
| C-3 | 8.0 立ち上げウィザード + 難易度軸分離 | W-33 に統合 | — | — |
| C-4 | 週次サマリの自動生成・Discord 投稿 | W-3 + W-4 + W-31 の出力を 1 枚に束ねる。それらの後 | 中 | ★ |

### 7-F. 優先度上位 10 (実装順の提案)

1. **W-1 ワイプ原因サマリー** — 1 往復/プル、練習ログ行に列追加。今回の調査で最も費用対効果が高い。
2. **W-2 フェーズ滞在時間** — W-1 と同じ sync 拡張で同時に取れる。
3. **W-13 遅刻 / 早退ステータス** — 国内固定で最も揉める点を構造化。
4. **W-27 攻略リンク既読** — 未解決課題に直撃、テーブル 1 つ。B-1 タグと同時に。
5. **W-14 Discord `<t:>` + カウントダウン** — 極小。
6. **W-33 8.0 準備** — 期限あり (2026-12)。スキーマに触る部分を先に。
7. **W-3 セッションサマリー** / **W-31 チーム実績バッジ** — 既存データの集計のみ。
8. **W-5 レポート自動発見** — 運用前提 (FFLogs guild) を固定内で合意してから。
9. **W-4 進行トレンド** + **W-35 イベント駆動通知** — W-5 の後に載せると一気通貫。
10. **W-16 iCal 購読** / **W-20 催促頻度** / **W-23 BiS 取得率** / **W-28 募集文** / **W-30 メンテ日程** / **W-32 辞書** / **W-34 ドキュメント** — 小粒の束。空き時間に順次。

---
## 8. UI 比較と取り入れ候補

### 8-1. 現状の把握 (repo 実測、2026-09-06)

| 項目 | 実測 | 含意 |
|---|---|---|
| `text-[10px]` の使用箇所 | 272 | 第 2 回 UI 監査の残課題「10px 基調の他画面への展開」は、**逆方向 (12px へ引き上げ) に転換**すべき (8-4) |
| `text-[11px]` の使用箇所 | 226 | データ行の基準。ラベル / チップ用途に限定していく |
| `logs-view.tsx` | 1,827 行 | 練習ログは機能追加が集中する場所。W-1〜W-4 を載せる前に、行ヘッダー / pull 行 / サマリの部品分割が要る |
| popover 実装 | `use-dismissable-popup.ts` に統一済 (2.12〜2.14) | 第 2 回監査の残課題 2 は解消。フォーカス復帰の初回 mount 問題も 2.14 で修正 |
| テーマ | 7 拡張テーマ + 背景エフェクト | エフェクト上の文字はコントラスト保証が必要 (スクリム) |
| シート表示 | PC = Google Sheets iframe (80%)、スマホ = カード | iframe はデータを持てないため、W-9 / W-10 / W-25 のような「表に列を足す」系はカード側 (portal 側データ) にしか置けない |

### 8-2. 観察のまとめ (詳細は各ツール名で検索可能)

**FF14 系** (✅ = OSS リポジトリ / 公式マニュアルで確認、⚠️ = スニペット):

| ツール | 一画面目の情報設計 | 密度・色 | 署名コンポーネント | 確度 |
|---|---|---|---|---|
| FFLogs (Deaths) | 死亡一覧 (時刻・推定 killing blow・直前の被ダメ / 被回復) → 行クリックで HP 推移グラフ + 直前イベント → Replay へ | プル終了時のボス HP% が主要指標 | **死亡行 → HP グラフ → Replay の 3 段ドリルダウン** | ⚠️ |
| xivgear | 上段セット一覧テーブル (1 行 = 1 セット、シム列)、下段スロット別エディタ、間にドラッグ可能ツールバー | 結果数値を **緑 → 赤で tint** | 読み取り専用 URL は「編集機能を除いたクリーンな UI」、`page=embed` | ✅ |
| xivanalysis | About → Checklist → Suggestions → ジョブ別 → Timeline の縦一列 | Checklist: passed 緑 / failed 赤 + % + Progress バー、**failed のみ自動展開**。Suggestions: **Major = 赤 ↑ / Medium = 橙 / Minor = 青 ↓**、severity 順、「show minor」トグル | 重要度ラベル付きカード、CSS Grid の折りたたみタイムライン | ✅ |
| MitPlan | クリック → ドラッグ → ドロップ → 自動バリデーション | **CD 中 = 赤ボーダー / 使用可 = 青ボーダー**、軽減率をリアルタイム計算 | ライブカーソル + アバター、編集 / 閲覧リンク分離、320〜1440px、「bottom capsule」型セレクタ | ✅ |
| XIVMitigation / jln-tail / rmoskwa | 8 ロールレーン / spreadsheet 風グリッド + 競合インラインエラー + フェーズナビ / **Canvas と Simple の 2 モード** | — | フェーズ単位ナビ、2 モード表示 | ⚠️ / ✅ |
| XIVPlan | 左パレット・中央キャンバス・右オブジェクト一覧 + プロパティ、上部ステップ切替 | — | ステップ (フェーズ) 切替、F1 ショートカット一覧 | ✅ |
| wtfdig | fight → strat → ロール → LP で **個人向けチートシート**。左サイドバーに表示オプション (テキストモード All / Role Only / Actions Only / Image Only、フェーズ別トグル、セルサイズ) | — | **ロール別チートシート**、「strat の違い」で選択中を ring ハイライト、設定を fightKey 単位で localStorage、モバイルはオーバーレイドロワー | ✅ |
| Materia Raiding | 難易度別サイドバー自動生成、fight ページは Raidplans → POV Videos (フェーズ別 details) → Waymarks → Resources | — | **TANK / HEALER / DAMAGE / EVERYONE のロールブロック**、`macro` / `waymarks` / `stratboard` のコードフェンス、TimingWindow (2 分バースト / 薬窓) | ✅ |
| Tomestone / ゲーム8 / xivpf / Lodestone | Tomestone はキャラページに prog point + best pull%、ゲーム8 は層ごとに「マクロ・タイムライン・フェーズ別解説・散開図・動画」の縦長、xivpf はカテゴリ → 残り時間ソートの募集リスト | — | — | ⚠️ |

**他ゲーム**: WoWAnalyzer (✅ ソース) の `PerformanceBoxRow` (1 キャスト = 1 小箱、Perfect / Good / Ok / Fail で色分け、hover ツールチップ)、`colorForPerformance` の **5 段階** (≥1.0 `#4ec04e` / >0.666 `#a6c34c` / >0.5 `#ffc84a` / >0.333 `#df7102` / それ以下 `#ac1f39`)、`TimelineHeatmapGrid` (行 = ブラケット、列 = 時間バケット、α 0.25〜0.95)、`HideGoodCastsToggle`。Lorrgs (✅ 構成) の Canvas タイムライン (`FightRow` / `PlayerRow` / `Cast` / `Death` / `PhaseMarker` / `Ruler`)。Wipefest (⚠️) の死亡行展開「死亡までの時間・被ダメ・被回復・直前 3 ヒット」。Raider.IO (⚠️) の討伐順ボスアイコン列。Guilded (⚠️) の Going / Maybe / Declined + サーバー時刻とローカル時刻の併記。

**汎用**: Linear (⚠️) の Cmd+K + 単キーショートカット + 段階的開示、Notion (⚠️) の同一データの table / board / calendar / timeline ビュー切替、Google カレンダー mobile (⚠️) の日付見出し付きアジェンダリスト。

### 8-3. 取り入れる価値のある UI パターン (ランク順)

| # | パターン | 出典 | 配置先 | 現状より良い理由 | 工数 | リスク / 注意 |
|---|---|---|---|---|---|---|
| UI-1 | **プル・ボックス列** (1 pull = 1 小箱、到達フェーズ / 残 HP% で色分け、箱内に P1〜P4 の略号、kill は強調、hover で時刻・死亡数、クリックで行展開) | WoWAnalyzer `PerformanceBoxRow` ✅ | 練習ログの各日ヘッダー | 現行の「1 pull = 1 行」は縦に伸びる。箱列なら 1 日 30 pull を 1 行で俯瞰でき、W-1 のワイプ原因を hover に載せられる | 小 | 色のみ判別は WCAG 1.4.1 違反 → 略号併記。タッチは 24px 以上か間隔例外 |
| UI-2 | **pull 数 / best% のヘッダー + 日別 best% スパークライン** | FFLogs ウィジェット ⚠️ / WCL Progress ⚠️ | 練習ログ上部、コンテンツカードのサブ情報 | 「今どこまで来たか」がタブを開かずカードで分かる (= W-4 の UI) | 中 | スパークラインの線色は 1.4.11 の 3:1 |
| UI-3 | **重要度ラベル付きの注意事項** (Major = 赤 ↑ / Medium = 橙 / Minor = 青 ↓、Minor 非表示トグル、空状態文言) | xivanalysis Suggestions ✅ | 日付メモ・軽減表の注意書き・W-7 ミス注釈 | 現行のメモは平坦。重要度で並び替え・絞り込みでき「今夜直すこと」が揃う | 小 | ラベルは色 + アイコン + 文字を必須に |
| UI-4 | **ロール別チートシート** (テキストモード All / Role Only / Image Only、フェーズタブ、設定を content 単位で localStorage) | wtfdig `ModernCheatsheet` ✅ / Materia ロールブロック ✅ | 攻略タブ (将来) / まず軽減カードの「自分の担当だけ」を拡張 | 各メンバーが自ロールだけを大きく見られる。モバイルで最も効く。既存の「自分の担当だけ」フィルタの発展形 | 中 | 攻略データの構造化入力が前提。本タブは 12px 以上 |
| UI-5 | **フェーズ・セグメント + URL 状態同期** (`?phase=2` を Discord に貼れる) | jln-tail フェーズナビ ✅ / XIVPlan steps ✅ / Notion ビュー ⚠️ | 軽減 (層タブは既存 → フェーズまで) / 攻略 / マクロ / 練習ログ (層フィルタは既存) | 長い表を 1 フェーズ分に絞れる。共有 URL が「その場所」を指す | 小 | ネストタブが深くなる → セグメントコントロールで 1 段に |
| UI-6 | **マクロ / ウェイマーク / 共有コードをコードフェンス風ブロック + コピー** (等幅 12px 以上、ロール別ブロック) | Materia `macro` / `waymarks` フェンス ✅ | マクロタブ | 貼り付け精度が上がり、モバイルでもコピーしやすい。現行のカード表示の微修正で済む | 極小〜小 | なし |
| UI-7 | **「strat の違い」比較ブロック** (複数マクロが並ぶとき、採用中を ring ハイライト + 差分の要点) | wtfdig `ModernStratView` ✅ | マクロ / 攻略タブ | PF 流入や配置変更時に「うちはどれか」が一目 | 小 | 「採用中」フラグの管理 UI が必要 |
| UI-8 | **コマンドパレット (Cmd+K) + 単キー移動** (コンテンツ間ジャンプ、管理操作の直接呼び出し) | Linear ⚠️ / XIVPlan F1 ✅ | ヘッダー (全体) | 第 2 回監査の残課題 3「管理操作が設定ダイアログの奥にある」への回答。デスクトップの操作速度 | 中 | 恩恵はデスクトップ中心。モバイルは既存ダイアログを残す |
| UI-9 | **出欠三値 + 参加者アバター列をカード直下に常時表示** (popover を開かずに人数と未回答者が見える) | Guilded ⚠️ / MitPlan ユーザーリスト ✅ | スケジュールの各セッション行 | 8 人なのでアバター列は収まる。W-13 の遅刻表示もここに載る | 小 | JST 固定なら時刻併記は省略可 |
| UI-10 | **モバイルはアジェンダ (Schedule) リスト** (日付見出し付き縦リスト、12px 以上) | Google カレンダー mobile ⚠️ | スケジュール (モバイル) | 表形式が 10px 化の主因。縦リストなら文字を大きくできる | 中 | デスクトップは現状維持で二系統になる |
| UI-11 | **Canvas / Simple の 2 モード** (Sheets iframe の代替として「Simple = カード一覧」を全端末で選べる) | rmoskwa ffxiv-timeline-app ✅ / xivgear のクリーン UI ✅ | 軽減・ロットタブ | iframe が使いにくい端末で Simple を選べる。既存の `sheet-view-switch` を拡張 | 小 (切替) 〜 大 (ネイティブ編集) | ネイティブ編集まで行くとデータ二重管理。**表示切替に留める** |
| UI-12 | **5 段階パフォーマンス色スケールの統一** (残 HP% 熱量・到達バー・プル箱・W-31 バッジで同一スケール) | WoWAnalyzer `colorForPerformance` ✅ / xivgear tint ✅ | 全データ表 | 現行は層チップと HP% ヒートが別体系。1 スケールで学習コストが減る | 極小 | 赤緑のみだと色覚多様性に弱い → 数値 / 略号を併記。層チップの識別色 (カテゴリ色) とは役割が違うので混ぜない |
| UI-13 | **CD 期間の影表示 + 競合の赤枠** (レーン型軽減タイムライン) | Lorrgs ⚠️ / MitPlan ✅ | 軽減タブ (W-9 の UI) | 表では見えない「温存 / 被り」を可視化 | 大 | 独自エディタは工数大。まず既存カードに「CD 中」バッジ (小) から |
| UI-14 | **死亡 / ワイプ要因の構造化リキャップ** (時刻・技・対象ロール・直前要因の展開行) | Wipefest ⚠️ / FFLogs Deaths ⚠️ | 練習ログの pull 詳細 (W-1 / W-8 の UI) | 自由記述メモを「技 + フェーズ + ロール」に寄せると集計できる | 中 | タグは選択式に、個人名はロール表記 |
| UI-15 | **ボスアイコン列で進行度** (討伐順、hover で詳細) | Raider.IO ⚠️ | コンテンツ一覧のティア見出し | ステータスバッジより一覧性が高い | 小 | アイコン素材の権利確認 (公式素材は利用規約に従う) |

### 8-4. 可読性・アクセシビリティ指針 (高密度ダークテーマ向け)

前 2 回の UI 監査で「10px → 11px + 意味色」に寄せたが、外部の基準に照らすと **10px は下限を割っている**。以下を portal の基準として提案する。

| 項目 | 基準 (出典) | portal への適用 |
|---|---|---|
| 文字コントラスト | 大きい文字 (約 24px / 太字 18.7px) 未満は **4.5:1** (WCAG 1.4.3 ✅) | 11px ラベル・チップの muted 色は 4.5:1 を満たす明度に |
| 非テキスト | アイコン・チップ枠・バー・スパークラインは **3:1** (WCAG 1.4.11 ✅) | 到達度バー・熱量色・スパークラインの線色 |
| 色だけに頼らない | WCAG 1.4.1 ✅ | 層チップ・HP% ヒート・プル箱に略号 / 数値を併記 |
| 最小フォント | WCAG に規定なし。Apple HIG **11pt** ✅、Material label-small **11px** ⚠️ | **表本文は 12px 以上** (`font-variant-numeric: tabular-nums` で桁揃え)、**11px はラベル / チップのみ、10px は廃止**。密度は行高 1.25 と左右 padding 6〜8px の削減で維持 |
| タッチターゲット | WCAG 2.5.8 (AA) **24×24 CSS px** (間隔例外 / 同等手段例外あり) ✅、Apple **44×44pt** ✅、Material 48dp ⚠️ | プル箱や表内アイコンは 24px 未満でも「行全体タップで同等操作」を用意。出欠・コピー・タブなどモバイルの主要操作は 44px 以上 |
| ダーク背景 | Apple: 4.5:1 以上、段階的に明るくなる背景レイヤーで階層、実機確認 ✅。Material: サーフェス `#121212`、純白テキスト回避 ⚠️ | 拡張テーマの背景エフェクト上の文字は **スクリム** (半透明の暗い面) を挟み、エフェクト強度に依存せず 4.5:1 を保証 |

**移行方針の提案**: 一括置換ではなく、W-1 / W-2 / UI-1 で練習ログを改修するときに練習ログだけ 12px 基準へ移し、続いて軽減カード → スケジュールの順に画面単位で揃える。272 箇所の `text-[10px]` は「ラベル (11px へ) / 本文 (12px へ) / 装飾 (削除)」の 3 分類で棚卸しする。

### 8-5. 第 2 回 UI 監査の残課題との接続

| 残課題 (2026-08-30) | 今回の対応方針 |
|---|---|
| 1. 10px 基調の他画面への展開 | **方針転換**: 展開せず 12px 基準へ引き上げ (8-4) |
| 2. popover 3 系統併存 | 2.12〜2.14 で統一済 → 完了 |
| 3. 管理操作の発見性 (設定ダイアログの奥) | UI-8 コマンドパレット、または各画面へのショートカット導線。2.12 で「予定表から Logs 整理へ直行」は実装済 |
| 4. 軽減表の層タブは card ビュー限定 | UI-5 のフェーズ・セグメントと URL 同期で card 側を先行させ、iframe 側は `#gid` 追随のみ |
| 5. 練習ログの層フィルタ | 2.12 で実装済 → UI-1 プル箱 + UI-5 フェーズ絞り込みへ発展 |

---
## 9. 作らないもの / 参考に留めるもの (アンチ提案の更新)

| 却下・保留対象 | 区分 | 理由 | 前回からの変化 |
|---|---|---|---|
| **Dalamud / プラグイン連動** (BisBuddy / PassportChecker / StratBoardImport / XIVRaidPlannerPlugin / FFLogsUploader 等との連携、導入案内) | 参考 | 第 3 回 A-5 の判断を維持。コンソール勢混在 (Switch 2 は 2026-08 開始済) と規範面 | 維持 |
| **TTS タイムライン読み上げ** (timeline-reader / Voice-Coach 型) | 参考 | ブラウザ完結ではあるが「戦闘中の外部補助」で、外部ツール議論の火種。プラグイン前提ではないので方針に直接は触れないが見送り | 新規 |
| **Split reclear 計画** (ffxiv-static-loot-bot 型) | 採用可だが不要 | 国内の 8 人固定で alt 運用は薄い。複雑さに見合わない | 新規 |
| **Lodestone ID をキーにした横断保存・公開** (Lodestone 装備同期 → BiS 差分、Tomestone 非公式 JSON の取り込み) | 対象外寄り | ストーカーツール問題 (PlayerScope / EchoVault) と同じ火種。Tomestone の非公式エンドポイントは ToS 未確認。**リンクで足りる** (W-32) | 新規 |
| **個人 DPS ランキング / 出席ランキング / streak バッジ** | 対象外 | 第 1 回 §1-F + 6-2。8 人の小集団では個人への圧になる。出席は本人 + 幹部集計のみ (W-19) | 出席にも拡張 |
| **AI によるワイプ原因要約** (ff14-logs-review-skill 型) | 保留 | 成立した製品は無く、コンテンツ毎のギミック知識が必要。W-1 の機械的サマリー + W-7 の人手注釈で足りる。待つ | 第 3 回 D-5 を維持 |
| **Web Push (PWA)** | 見送り | iOS はホーム画面追加時のみ。Discord @mention と二重 | 新規 |
| **完全自動の中止判定** | 提案止まり | 「まだ来るかも」の余地を潰す。W-17 の提案モードまで | 新規 |
| **ネイティブ軽減表エディタ** (MitPlan / xivmitplan / 国内の軽減表作成サイト相当) | 保留 | 「表の正は Sheets」を維持。国内でも作成サイトが出たが、iframe + カードで読む体験は解決済。W-9 は「表示に実測を重ねる」のであってエディタではない | 維持 |
| 作図エディタ / 装備シミュレータ / fight シムの自作、マルチテナント化 | — | 第 1〜3 回の判断を維持 | 維持 |

---

## 10. ロードマップ案 (更新)

| 時期 | 内容 | 狙い |
|---|---|---|
| **2026-09〜10 (7.56 期)** | W-1 → W-2 → W-13 → W-27 (+B-1 タグ) → W-14 → UI-12 色スケール + 練習ログの 12px 化 (UI-1 と同時) | 費用対効果が最も高い束。練習ログを「到達度」から「なぜ止まったか」へ、スケジュールを「来るか」から「いつ来るか」へ |
| **2026-10〜11** | W-33 8.0 準備 (スキーマ部分を先に) → W-3 / W-31 → W-30 / W-32 / W-34 / W-20 の小粒 → 東京ファンフェス (11/1) 後に 8.0 情報を再確認 | 期限のあるものを先に。小粒で体験を整える |
| **2026-11〜12** | W-5 レポート自動発見 (FFLogs guild 運用の合意後) → W-4 進行トレンド → W-35 通知 → W-16 iCal → W-23 BiS 取得率 → W-28 募集文 | データ取込の自動化とその上の可視化・通知を一気通貫に |
| **2027-01 (8.0)〜Q1** | W-15 定期枠 / W-11 同期校正 / W-6 出席突合 / W-19 出席サマリー / W-17 中止提案 / W-18 有志練習 / B-5 `/me` / C-4 週次サマリ | 新ティア立ち上げの運用負荷を下げる |
| **2027 Q2 以降** | W-9 軽減 計画 × 実測 (大) → W-8 死亡 lead-up → W-7 ミス注釈 → W-24 / W-25 ロット提案・行列 → C-2 チャプタリング | 差別化領域。8.0 の軽減再編・新難易度の運用が固まってから |

---

## 11. 情報が薄い点 / 再確認推奨

- **FFLogs**: 2025〜26 年の公式アナウンス本文 (Auto Logging の課金条件、Timeline ビューの有無)、v2 のレート上限の具体値とポイント算定式、`guild.attendance` の実挙動。実装前に公式 docs を手元ブラウザで確認し、`rateLimitData` で実測する。
- **Tomestone / Archon**: Static ページのタブ構成、Raid Team Support の無料 / 有料境界、非公式 JSON の ToS。いずれもリンク運用 (W-32) なら影響なし。
- **国内**: 「軽減表作成サイト (2026-01)」の実体 URL と名称、KNT Tools の詳細、断章計算専用ツールの有無、メンバー入れ替え時の引き継ぎ慣行 (検索上限で未着手)。
- **8.0**: 新難易度の正式名称・仕様、2 ジョブ目、発売日、UI / PT 募集 / ボード / ウェイマーク改修 → 東京ファンフェス (2026-10-31〜11-01) 後に再確認。
- **韓国語圏**の固定管理ツール、**IINACT** の 2026 年の変化、xivanalysis の 7.55 以降の対応状況。
- **UI**: WoWAudit の出席ヒートマップ、Tomestone のチップ、Lodestone の UI 詳細は取得不可。RaidCanvas は GitHub 上に無い (非 OSS) ため UI は前回のスニペット情報のまま。
- 本書の「国内固定文化」に関する評価 (ランキング不採用など) は、まとめサイト・知恵袋・掲示板のスニペットからの推論を含む ⚠️。

---

## 12. 参照リンク (主要なもの)

**他ゲーム**: [WoWAudit](https://wowaudit.com/) / [Raider.IO](https://raider.io/) / [Archon: Guilds](https://www.archon.gg/wow/articles/help/guilds) / [Wipefest](https://www.wipefest.gg/) / [Lorrgs](https://github.com/gitarrg/lorrgs) / [WoWAnalyzer](https://github.com/WoWAnalyzer/WoWAnalyzer) / [Method Raid Tools](https://www.curseforge.com/wow/addons/method-raid-tools) / [RCLootCouncil2](https://github.com/evil-morfar/RCLootCouncil2) / [Gargul](https://github.com/papa-smurf/Gargul) / [That's My BIS](https://github.com/thatsmybis/thatsmybis) / [Guilds of WoW](https://guildsofwow.com/) / [Warcraft Insights](https://www.warcraftinsights.com/) / [Viserio Cooldowns](https://wowutils.com/viserio-cooldowns) / [Raidstrats.gg](https://raidstrats.gg/) / [Raid Report](https://raid.report/) / [RaidHub](https://raidhub.io/) / [Braytech](https://bray.tech/) / [Dungeon Report](https://dungeon.report/faq) / [GW2 Elite Insights](https://github.com/baaron4/GW2-Elite-Insights-Parser) / [raidTimeline](https://github.com/danifischer/raidTimeline) / [GW2 Wingman](https://gw2wingman.nevermindcreations.de/)

**FF14 海外 (新顔)**: [FFXIV Raid Planner](https://github.com/aaronbcarlisle/ffxiv-raid-planner) / [ffxiv-static-loot-bot](https://github.com/christyke1170/ffxiv-static-loot-bot) / [ffxiv-loot-optimizer-app](https://github.com/iago-ca/ffxiv-loot-optimizer-app) / [Dev-2A/ffxiv-loot-tracker](https://github.com/Dev-2A/ffxiv-loot-tracker) / [static-raid-coordinator](https://github.com/ruminabottle/static-raid-coordinator) / [shiraishiyokai/ffxiv-raid-tracker](https://github.com/shiraishiyokai/ffxiv-raid-tracker) / [XIVtimelineMaker](https://github.com/Yilegendoflink/XIVtimelineMaker) / [xivodreview](https://github.com/k0etsu/xivodreview) / [ffreplay](https://github.com/Xinrea/ffreplay) / [ffxiv-timeline-app](https://github.com/rmoskwa/ffxiv-timeline-app) / [xivmitplan](https://github.com/Flickwire-Agent/xivmitplan) / [ffxiv-mitigation-planner](https://github.com/jln-tail/ffxiv-mitigation-planner) / [ffxiv-raid-analyzer](https://github.com/mu-ns/ffxiv-raid-analyzer) / [berry-fflog-analyzers](https://github.com/aeruru/berry-fflog-analyzers) / [ff14-logs-review-skill](https://github.com/vincent5816/ff14-logs-review-skill) / [progwatch](https://github.com/z0w13/progwatch) / [Dalamud.Tomestone](https://github.com/TomestoneGG/Dalamud.Tomestone) / [XIV ToDo](https://github.com/olivi-eh/xivtodo) / [XIV Recruit](https://www.xivrecruit.com/lfm) / [ff14-partyfinder-analytics](https://github.com/abdulrahman-khan/ff14-partyfinder-analytics) / [xiv-resources](https://github.com/karashiiro/xiv-resources) / [Archon: Raid Team Support](https://www.archon.gg/ffxiv/articles/help/raid-team-support) / [arcan1s/ffxivbis](https://github.com/arcan1s/ffxivbis) / [XIV in the Shell](https://github.com/xivintheshell/xivintheshell)

**FFLogs / ログ技術**: [v2 スキーマダンプ (第三者)](https://github.com/ssilve1989/ulti-project/blob/82917729bee7e07bd57962608e1a8be09f81d4ba/apps/bot/schema.graphql) / [公式 v2 docs (遮断)](https://www.fflogs.com/v2-api-docs/ff/) / [fflogsapi (Python)](https://github.com/halworsen/fflogsapi) / [Better Deaths](https://github.com/Nainaiowo/better-deaths) / [FFLogsViewer](https://github.com/Aireil/FFLogsViewer) / [fflogs-pull-stats](https://github.com/tomouchuu/fflogs-pull-stats) / [xivanalysis: uploading-example-logs](https://github.com/xivanalysis/xivanalysis/blob/dawntrail/docs/uploading-example-logs.md) / [MitPlan](https://github.com/MarbleSodas/MitPlan) / [XIVTimelineGenerator](https://github.com/MarbleSodas/XIVTimelineGenerator) / [cactbot raidboss data](https://github.com/OverlayPlugin/cactbot/tree/main/ui/raidboss/data) / [cactbot TimelineGuide](https://github.com/OverlayPlugin/cactbot/blob/main/docs/TimelineGuide.md) / [cactbot LICENSE](https://github.com/OverlayPlugin/cactbot/blob/main/LICENSE) / [Waymark Studio](https://github.com/sourpuh/ffxiv_waymarkstudio) / [Triggevent Timeline Mitigation Recording](https://triggevent.io/pages/tutorials/Timeline-Mitigation-Recording/) / [FFLogs Deaths 解説 (Icy Veins)](https://www.icy-veins.com/ffxiv/fflogs-death-information) / [FFLogs Replay 解説](https://www.icy-veins.com/ffxiv/fflogs-replay)

**国内**: [GuildHub](https://github.com/mattyan1053/ff14-guildhub) / [KNT Tools](https://knt-a.com/) / [らすと 軽減表タイムライン一覧](https://note.com/lastagous/n/ncfcb027117fd) / [ぶんちりー 軽減表 7.5](https://bunchiry.com/ff14-mitst-7x/) / [xivtlsheet](https://github.com/okapiffxiv/xivtlsheet) / [xivraidteam](https://github.com/okapiffxiv/xivraidteam) / [Gran Sacbe ロットチェッカー](https://na.finalfantasyxiv.com/lodestone/character/19187632/blog/5079482/) / [デイコード解説 (とらめも)](https://toramemoblog.com/daycord1) / [Catacatata/ff14-calendar](https://github.com/Catacatata/ff14-calendar) / [FF14-Timeline-Voice-Coach](https://github.com/leo04264/FF14-Timeline-Voice-Coach) / [Gamee 固定募集 2026](https://blog.gamee.games/ff14-fixed-pt-friend-recruitment-2026/)

**公式動向**: [白銀のワンダラー 2027-01 (Lodestone)](https://jp.finalfantasyxiv.com/lodestone/topics/detail/894c4e750cad021b3dc8e3fc74b4811cf1bd72e6) / [ベルリン基調講演 (ファミ通)](https://www.famitsu.com/article/202607/82441) / [新難易度 (エオルゼア攻略ガイド)](https://www.eorzea-guide.com/entry/2026/07/25/201358) / [公式フォーラム: 新難易度(仮)](https://forum.square-enix.com/ffxiv/threads/529893) / [リージョン内フリーマッチング (公式 X)](https://x.com/FF_XIV_JP/status/2047743466885820496) / [7.56 (ヤーン速報)](https://yan-flash.com/articles/ffxiv-patch-756-september-8) / [7.55 (電撃)](https://dengekionline.com/article/202607/82751) / [Switch 2 版 (ファミ通)](https://www.famitsu.com/article/202608/83420) / [ファンフェス 2026](https://fanfest.finalfantasyxiv.com/2026/jp/) / [PlayerScope (AUTOMATON)](https://automaton-media.com/articles/newsjp/final-fantasy-xiv-20250124-326417/) / [FF14 事件簿 wiki: EchoVault](https://w.atwiki.jp/ff14incident/pages/323.html)

**スケジュール / Discord**: [Discord API: Guild Scheduled Event](https://github.com/discord/discord-api-docs/blob/main/developers/resources/guild-scheduled-event.mdx) / [Discord API: Timestamp Styles](https://github.com/discord/discord-api-docs/blob/main/developers/reference.mdx) / [Raid-Helper](https://raid-helper.dev/) / [Apollo](https://apollo.fyi/) / [Sesh](https://sesh.fyi/) / [Chronicle](https://chroniclebot.com/) / [Mawiszus/discord-ffxiv-raid-bot](https://github.com/Mawiszus/discord-ffxiv-raid-bot) / [Crab Fit](https://github.com/GRA0007/crab.fit) / [Rallly](https://github.com/lukevella/rallly) / [Throney](https://throney.gg/tools/ffxiv/guild-management) / [Atomcal FFXIV](https://atomcal.com/ffxiv-discord/) / [ICS フィードと同期の違い](https://calendarbridge.com/blog/ics-icalendar-feeds-vs-real-time-sync-whats-the-difference/) / [PWA on iOS 制約](https://brainhub.eu/library/pwa-on-ios)

**UI / アクセシビリティ**: [xivgear USER_MANUAL](https://github.com/xiv-gear-planner/gear-planner/blob/main/USER_MANUAL.md) / [xivanalysis (Checklist / Suggestions)](https://github.com/xivanalysis/xivanalysis) / [wtfdig (ModernCheatsheet / ModernStratView)](https://github.com/mczub/wtfdig) / [Materia Raiding (VitePress)](https://github.com/materiaraiding/materiaraiding) / [XIVPlan](https://github.com/joelspadin/xivplan) / [WoWAnalyzer colorForPerformance](https://github.com/WoWAnalyzer/WoWAnalyzer) / [lorrgs-frontend](https://github.com/gitarrg/lorrgs-frontend) / [WCAG 1.4.3](https://github.com/w3c/wcag/blob/main/understanding/20/contrast-minimum.html) / [WCAG 1.4.11](https://github.com/w3c/wcag/blob/main/understanding/21/non-text-contrast.html) / [WCAG 1.4.1](https://github.com/w3c/wcag/blob/main/understanding/20/use-of-color.html) / [WCAG 2.5.8](https://github.com/w3c/wcag/blob/main/understanding/22/target-size-minimum.html) / [Apple HIG Typography](https://developer.apple.com/design/human-interface-guidelines/typography) / [Apple HIG Dark Mode](https://developer.apple.com/design/human-interface-guidelines/dark-mode) / [Linear design breakdown](https://www.925studios.co/blog/linear-design-breakdown-saas-ui-2026)
