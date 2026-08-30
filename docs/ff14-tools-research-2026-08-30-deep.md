# FF14 ツール調査 第 3 回 (深掘り): ランチャー系連動の是非 / ウェイマーク入出力 / ストラテジーボード実態 / 広域スキャン (2026-08-30)

> 前 2 回 (`ff14-tools-research-2026-08.md`, `ff14-tools-research-2026-08-30.md`) への追加調査。発端のユーザー指摘:
> 1. ランチャー (クライアント組み込み・改造系) と連動するツールは海外で利用率が高いが日本では一部 — これに関する機能を追加すべきか
> 2. ウェイマークはゲーム内で入出力できなかったはず — 確認
> 3. プリセットは提示されるまで探し当てられなかった。海外用なので若干違うものがあるかもしれない
> 4. ストラテジーボードはほぼ現状ゲーム内で使われていない
>
> **調査手段の制約**: 本環境からの直接 fetch は GitHub 以外ほぼ egress ブロック (game8 / 公式フォーラム / note / まとめ / archive.org 等)。Web 検索スニペット + GitHub 一次情報が主で、各所に確度ラベルを付す: ✅ 複数ソースで確認 / ⚠️ 薄い (スニペット依存等) / ❌ 到達不能・未確認。

---

## 総括 — 提起された 4 点への回答

1. **ランチャー (Dalamud) 連動機能を追加すべきか** → **追加しない**。理由は A-5。プラグイン利用者"も"得をするテキスト保管 (現行実装) + ブラウザ完結の可視化を上限とし、導入案内・必須化・API 連携には踏み込まない。
2. **ウェイマークはゲーム内で入出力できないのでは** → **その認識で正確** (B-1)。公式は保存 30 枠のみで共有/入出力機能は存在しない。7.4 ストラテジーボードもマーカー「アイコンの絵」を共有するだけで実体の入出力ではない。取り込み経路は PC + Dalamud プラグインのみ。ただし**設置後のマーカーは PT 全員に見える**ので「PC の 1 人が import して設置」で実務は完結する。
3. **プリセットが探し当てられなかった / 海外用でズレがあるかも** → **両方正しい** (B-4)。JP には ウェイマーク JSON を配布する文化自体がほぼ無く (スクショ + マクロが主流)、公開 DB (Em-Six wiki / Materia Raiding) は EN/OCE strat 前提で JP 式と配置が一致しないことが多い。「自固定用を自分で置く」現行設計が正解。
4. **ストラテジーボードはほぼ使われていない** → **観察はおおむね正しい** (C)。日常のゲーム内利用は定着せず (EN フォーラム「実質皆無」/ JP まとめも同調)、ただし**ゲーム8 が層別攻略に共有コードを載せ続ける「配布フォーマット」としては生きている**。第 2 回レポートの「#1 推奨」は過大評価と判定し、「マクロタブ内の 1 種別として最小保管、プレビューは作らない」に格下げする (C-6)。

---

## A. XIVLauncher / Dalamud (クライアント改造系) 連動機能の是非

### A-1. XIVLauncher / Dalamud とは何か、2026 年のエコシステム

- **XIVLauncher** はサードパーティ製ランチャー、**Dalamud** はそれが起動時にゲームプロセスへ**注入する C# プラグインフレームワーク** ([goatcorp/Dalamud](https://github.com/goatcorp/Dalamud) / [dalamud.dev](https://dalamud.dev/faq/getting-started/))。「クライアント改造」というよりプロセス内 addon 基盤で、プラグインはゲーム内 UI (`/xlplugins`) から導入する。
- **公式リポジトリの規模 (git clone による一次確認)**: 公式プラグインマニフェスト [goatcorp/DalamudPluginsD17](https://github.com/goatcorp/DalamudPluginsD17) は **stable 398 個 / testing 289 個**、最終コミット **2026-08-29** (毎日動いている現役プロジェクト)。これに puni.sh 等のカスタムリポジトリ群が上乗せ。
- **レイド実用系の主要プラグイン** (メンテ状況は repo clone で一次確認):

| プラグイン | 配布 | 状態 |
|---|---|---|
| [WaymarkPresetPlugin](https://github.com/PunishedPineapple/WaymarkPresetPlugin) | 公式 repo (stable) | 現役。配布実体は **sourpuh フォーク**で API 15 (7.4x 世代) 対応。原作者版は 2023-05 停止 |
| [Waymark Studio](https://github.com/sourpuh/ffxiv_waymarkstudio) | puni.sh カスタム repo | 最終コミット 2026-06-16、活発。ゲーム内エディタの完全代替 + URL 共有 + FFLogs import |
| [MemoryMarker](https://github.com/MidoriKami/MemoryMarker) | 公式 repo | 2025-08 に Codeberg 移転宣言、公式 repo には現存 |
| Splatoon (AOE 描画/トリガー) | カスタム repo | JP 解説ブログが 2025-12 更新を明記 (⚠️ 間接確認) |
| [cactbot](https://github.com/OverlayPlugin/cactbot) | ACT+OverlayPlugin / [IINACT](https://www.iinact.com/) 経由 | OverlayPlugin org へ移管済みで活発 |

- **前提**: Dalamud は **Windows PC (+Mac/Linux 版) 専用**。PS4/PS5/Xbox/Switch 2 では一切動かない。

### A-2. 利用率「海外は高い・日本は一部」の検証

- **ハードな数字は存在しない**。goatcorp はユーザー数・DL 数統計を公表しておらず、Lucky Bancho 国勢調査は Lodestone 公開データのみ (ツール使用統計は原理的に含まれない)。
- **定性的証拠 (方向としては支持)**:
  - 海外 (特に NA) の絶募集では「**AM (オートマーカー) あり**」を公然と条件に書く文化がある。
  - **ただし JP 公式フォーラムには「日本の野良・固定でも AM 前提化が進んでいる」ことへの苦情スレ** ([オートマーカーによるギミック処理について](https://forum.square-enix.com/ffxiv/threads/481530)) や、外部ツール議論の巨大スレッド ([299 ページ超](https://forum.square-enix.com/ffxiv/threads/368521)) が存在する。つまり「日本＝ほぼ使わない」は不正確で、**JP でも高難易度層 (絶・零式前線) には相当浸透、ただし公言しない文化**が実態に近い。
  - JP 語圏にも導入ガイドが多数あり継続更新 (とらめもブログ 2026-04 更新 ⚠️間接確認 / [さらちゃんのつぶやき](https://sarachantubuyaki.jp/column/how-to-install-act-and-plug-ins))。
  - 操作環境の傍証: M+KB 使用者は NA 60% / EU 67% (Game Rant ⚠️間接確認) → JP はより pad/コンソール寄りと推定され、プラグイン不能人口が構造的に多い。
- **結論**: ユーザーの理解は**方向として支持**。補正 2 点: (1) 定量的裏付けはどこにも存在しない、(2) 「日本の一部」はカジュアル層でなく**高難易度層に偏って浸透**している。

### A-3. 規約とリスク

- **公式スタンス**: 規約上、外部ツールは一切禁止。2022-05 絶竜詩世界レースの際に吉田 P/D が「一貫して使用は認めていない」と声明、最速クリア動画は削除 ([電撃オンライン](https://dengekionline.com/articles/131606/) ほか)。
- **処罰の実態**: 公知の BAN 事例は (a) チート性の高いツール、(b) DPS 晒し・ハラスメント、(c) 配信等でのツール映り込み・公言、に集中。私的な QoL プラグインや ACT 単体使用の検出 BAN 事例は確認されていない (⚠️ 公表されないだけの可能性は残る)。
- **ウェイマーク固有の前例 = 脱法マーカー事件 (2022-09)**: P3S でツールにより場外・空中に設置されたプリセットが野良に蔓延。公式は「**作成者を処罰、コピー使用者は処罰せず**、地形側を修正」で対応 ([Game*Spark](https://www.gamespark.jp/article/2022/09/13/122279.html))。Waymark Studio 自身も README で公式告知を引いて警告している。
- **portal への含意**: FFLogs (ACT 前提のログを扱う Web サービス) が黙認され標準化しているのと同様、**「プラグイン利用者が消費できるテキストを保管する」こと自体は Web 側の行為でありクライアント改変ではない**。リスクが立つのは (1) 導入手順の掲載・推奨、(2) プラグイン必須機能、(3) 出所不明プリセット (脱法マーカー含む) の配布、に踏み込んだ場合。

### A-4. コンソールの現実

- **Nintendo Switch 2 版は 2026-08-04 に正式ローンチ済み** (クロスプレイ対応) — 前回レポートの「2026 年予定」は要更新 ([Siliconera](https://www.siliconera.com/ffxiv-switch-2-release-date-and-pre-orders-open/))。
- コンソールではプラグイン不可 (技術的事実)。JP レイダーのコンソール比率のハードデータは無し (❌)。

### A-5. 判断 / 提案

**「プラグイン連動機能」は作らない。「プラグイン利用者"も"得をするテキスト保管 + ブラウザ完結の可視化」までに留める。**

1. **技術的制約**: 8 人中にコンソール勢が 1 人でもいればプラグイン前提機能はその人に無価値。逆にウェイマークは **PC+Dalamud の 1 人が import して設置すれば全員の画面に出る**ので、全員がプラグインを持つ必要はそもそも無い。
2. **規範的制約**: 建前上全面禁止のツールについて、semi-public な JP portal が「導入手順」「必須化」に踏み込むのは、処罰事例が集中する『公言・喧伝』側に自ら寄る行為。テキスト保管は FFLogs と同じ「Web 側の行為」で安全圏。
3. **公式代替の登場**: 散開図の共有はストラテジーボード (コンソール込みで全員使える) が公式解。**共有コードが一級市民、ウェイマーク JSON は「PC 勢向けの便利品」という序列**が正しい。

具体策: (a) 現行のテキスト保管は維持、(b) 拡張はブラウザ完結の JSON 検証・簡易プレビューまで、(c) UI 文言は「PC + プラグイン環境の方は import できます」程度の中立表記に留め、**プラグインの導入ガイド・リンク集は置かない**、(d) 保管時に「座標が場外・空中でないか」の粗い検証を付けると脱法マーカー混入の事故防止になり、むしろリスクを下げる。

---

## B. ウェイマークのゲーム内入出力の事実確認

### B-1. 公式機能の正確な範囲 (7.4x / 2026 時点) — ユーザーの認識は正しい

- **保存枠**: 6.3 (2023-01) で 5 → **30 枠** ([consolegameswiki](https://ffxiv.consolegameswiki.com/wiki/Waymark))。
- **保存場所**: プリセットは**クライアント側・キャラ毎の `UISAVE.DAT`** (フォーマット解析済み — [UISAVE_Reader](https://github.com/PunishedPineapple/UISAVE_Reader) / [xiv.dev](https://xiv.dev/game-data/character-data-files))。サーバー同期されない = PC 買い替えで消える (⚠️ 公式一次ソースは無くコミュニティ解析ベース)。
- **公式の共有・import/export 機能は存在しない**。7.4 ストラテジーボードは図面上にマーカー**アイコンを描いて**共有できるだけで、実体のウェイマーク配置データの入出力ではない。公式が実体共有を予定している情報も見つからず。

### B-2. import 経路はプラグインのみ (各ツールの現状、git clone で一次確認)

| ツール | 種別 | 状態 | import 方法 |
|---|---|---|---|
| WaymarkPresetPlugin | Dalamud (公式 repo) | 現役 (sourpuh フォーク、API 15) | **PaisleyPark 形式 JSON をペースト** |
| [Waymark Studio](https://github.com/sourpuh/ffxiv_waymarkstudio) | Dalamud (puni.sh repo) | 2026-06-16 コミット、活発 | `sourpuh.github.io/waymarkstudio?preset=wms1.…` 形式 URL を import。**FFLogs レポートからの import も可**。Em-Six wiki のプリセット同梱 |
| MemoryMarker | Dalamud (公式 repo) | Codeberg 移転宣言済みだが現存 | スロット管理系 (共有の主役ではない) |
| PaisleyPark | スタンドアロン | **2021-07 で開発停止**。ただし **JSON フォーマットは事実上の共有標準として存続** | — |

### B-3. 混成 (PC + コンソール) JP 固定での実務

- 共有プリセットを「取り込める」のは PC + Dalamud のメンバーだけ。ただし**設置後のマーカーは PT 全員に見える**ため、実務は「PC の 1 人が import → 開幕前に設置」で完結。全員コンソールの場合のみ、スクショ / ストラテジーボードを見ながらの手置きになる。
- **Waymark Studio の Web プレビュー**: README に「preset URL を開くとマップ付きプレビュー」と明記 — **プラグイン無しのブラウザ閲覧に使える**。⚠️ ただし本環境から実レンダリングは未検証 (実装前に手元ブラウザで 1 度確認推奨)。プレビュー可能なのは `wms1.` 形式 URL のみで、生の PaisleyPark JSON には Web プレビューは無い。
- **現実解の三層**: (1) PaisleyPark JSON の保管 (PC 勢の 1 人が import すれば全員に届く)、(2) Waymark Studio 共有 URL のリンク保管 (非プラグイン勢もプレビュー閲覧可)、(3) 全員向けの正はスクショ + ストラテジーボード共有コード。

### B-4. JP と海外のプリセット共有文化の差 — 「探し当てられなかった」のは当然

- **JP でウェイマーク JSON を配布する文化はほぼ確認できない** (「ウェイマーク JSON」等の日本語検索は FF14 関連をほぼ返さない)。JP の主流は**配置スクショ + 散開マクロ** ([ff14macro.net](https://ff14macro.net/) 等)、7.4 以降は**ストラテジーボード共有コード**に「構造化データを渡す」文化が形成された。JSON を扱うのは XIVLauncher 利用を公言する一部ブログと固定内 Discord に限られる。
- EN 圏は Em-Six wiki / Materia Raiding が fight 別 JSON をガイドに標準同梱 — ただし **EN/OCE strat 前提で JP 式の散開・処理法とマーカー位置が一致しない** (第 2 回レポート §1 の結論を再確認)。
- **結論**: 「自分たち専用のプリセットを固定内で回す」現行設計が文化的にも正しい。

### A/B の検証できなかった点 (明示)

1. XIVLauncher/Dalamud の総ユーザー数・DL 数 (公表統計が存在しない)。
2. JP レイダーのプラットフォーム比率・プラグイン使用率の定量値。
3. Waymark Studio Web プレビューの実動作 (README 記載のみ)。
4. UISAVE.DAT がサーバーバックアップされないことの公式一次ソース。

---

## C. ストラテジーボード (7.4, 2025-12-16) の実際の利用状況

### C-1. 結論サマリ

**ユーザーの観察はおおむね正しい。** ただし「完全に死んだ機能」ではなく、**「配布フォーマットとしては生きているが、日常の運用ツールとしては定着しなかった」**という非対称な実態:

- **配布フォーマットとしては定着しつつある**: ゲーム8 の零式攻略ページ (M9S–M12S 各層) が共有コードを掲載、公式フォーラムに共有専用スレッド、Lodestone 日記・note で共有コード記事が継続的に出ている。
- **プレイヤーが日常的にゲーム内で開く/作る文化は形成されなかった**: EN 公式フォーラム・JP まとめの双方で「もう使われていない/ミーム置き場」という声が実装 2〜8 ヶ月後に出ている。
- **周辺 Web エコシステムは極小のまま**: デコーダライブラリ 2★、ビュワー 21★。前回レポート (第 2 回) の熱量は過大だった。

### C-2. 利用実態の証拠 (EN)

| 証拠 | 内容 | 確度 |
|---|---|---|
| SE 公式フォーラム EN スレ [「Anyone still using strategy boards?」](https://forum.square-enix.com/ffxiv/threads/528854) | 「最近の利用は実質皆無 (practically non-existent)、現状はミーム投稿程度で機能自体が obsolete に見える」という趣旨。スレが立つこと自体が不使用の傍証 | ✅ 趣旨 / ⚠️ 本文直接閲覧不可 |
| [Strategy Board Improvements スレ](https://forum.square-enix.com/ffxiv/threads/525356) | 改善要望スレが継続 (機能不足の認識が共有されている) | ⚠️ タイトルのみ |
| [Sportskeeda「Best Strategy Board Memes」](https://www.sportskeeda.com/mmo/final-fantasy-xiv-best-strategy-board-memes-with-share-code) | メディアの扱いも「ミーム集」記事が上位 | ✅ |
| [board.wtfdig.info](https://board.wtfdig.info/) | コード閲覧 + バンドル + [raidplan 変換](https://board.wtfdig.info/import) + [エディタ](https://board.wtfdig.info/editor)。EN 主要 strat サイト [wtfdig.info](https://wtfdig.info/74/m12s) の付属として存続 | ✅ 存在 / ❌ 利用量 |
| [ffxivstrats.io](https://ffxivstrats.io/) | 共有コード DB として存続 | ❌ 投稿規模は検証不能。活況の証拠は見つからず |
| [mczub/xiv-strat-board](https://github.com/mczub/xiv-strat-board) (デコーダ npm) | **2★ / 2 fork / 15 コミット** | ✅ エコシステムの小ささの定量的証拠 |
| [Ennea/ffxiv-strategy-board-viewer](https://github.com/Ennea/ffxiv-strategy-board-viewer) | ブラウザビュワー。2025-12-18 作成、**21★**、最終更新 2026-06-05 | ✅ |
| raidplan.io | [共有コード export 継続](https://www.icy-veins.com/ffxiv/strategy-board-raid-planner-in-ffxiv)。ただし変換は劣化あり (テキスト 30 文字 / ボード 8 オブジェクト、画像・絵文字・手書き非対応) | ✅ |

### C-3. 利用実態の証拠 (JP)

| 証拠 | 内容 | 確度 |
|---|---|---|
| まとめ [ネトゲ速報「本来の使い方をしている人があまりにも少なすぎるｗｗｗ」](https://ff14net.2chblog.jp/archives/62867654.html) | 「1 ヶ月で利用が落ちた」「大喜利的な使われ方」「共有されたボードは分かりやすいが**戦闘中に実用するのは難しい**」 | ✅ 趣旨 / ⚠️ 本文閲覧不可 |
| まとめ [ひかせん速報「お前らってストラテジーボード活用しているの？」](https://ff14hikasensokuhou.com/blog-entry-27478.html) | 「予習で足りる」等の懐疑的反応 (実装直後の好意的記事からのトーン変化) | ⚠️ |
| JP 公式フォーラム [「ストラテジーボードについて」](https://forum.square-enix.com/ffxiv/threads/524863/?page=2) | 閲覧モード中のテレポで勝手にアクティブ化 → 誤操作で閲覧モード消滅、自動アクティブ化の廃止要望など UI 不満 | ✅ 趣旨 |
| 一方で [ゲーム8 の零式攻略ページ](https://game8.jp/ff14/754895) (M9S〜[M12S 前後半](https://game8.jp/ff14/757988)) | **マクロと並んで共有コードを掲載**。JP 最大手が配布フォーマットとして採用済み | ✅ |
| [公式 X の共有スレ案内](https://x.com/FF_XIV_JP/status/2009173265701548038) (2026-01) / [JP 共有要望スレ](https://forum.square-enix.com/ffxiv/threads/525664) | 運営自身が SNS/フォーラムでの共有蓄積を推す構図 (ゲーム内だけでは回っていないことの裏返し) | ✅ |
| [馬鳥速報 (2026-01)](https://x.com/umadori0726/status/2008821672925937672) | **零式立ち上げ期には** race チームの解説・野良の意思疎通に実際に使われた | ✅ |
| [あせろぐ「FFXIV Strat Share」](https://asellog.com/strat/) | JP 個人運営の**ストラテジーボード+マクロ共有 DB**。v2.4.0 (2026-03-13) で開発継続 | ✅ 存在 / ❌ 規模 |
| Lodestone 日記・note の共有コード記事 | [M10S 共有コード](https://na.finalfantasyxiv.com/lodestone/character/46813224/blog/5645567/)、[絶エデン P3 (ぬけまる式) ボード](https://jp.finalfantasyxiv.com/lodestone/character/45169022/blog/5650196/)、[極グラシャラボラス (note)](https://note.com/rubianeko/n/n01622a6fcc7d)、[7.5 極エヌオー共有コード+マクロ](https://x.com/RubiaNeko/status/2049787157200658441) — 少数の熱心な作成者が 7.5 期も継続供給 | ✅ |

### C-4. JP 固定の主流は依然「マクロ + カンペ画像」

- 絶妖星乱舞 (DMU, 2026-05〜06) の JP 攻略流通の主役は [ふうcだよの野良主流カンペ集](https://fuucdayo.com/battle/8500/) (画像カンペ、2026-07 更新継続) と[マクロ集](https://fuucdayo.com/macro/8609/)、[ヤーン速報の攻略特設](https://yan-flash.com/ultimate/yosei-ranbu)。**最新最難関コンテンツですらカンペ画像+マクロが基軸**で、ボードは補助的。✅
- 野良の共通言語は今も「ゲーム8式/ハムカツ式/ぬけまる式/犬丸式」といった **strat 名 + マクロ** ([処理法名の混乱が事故を生む例](https://detail.chiebukuro.yahoo.co.jp/qa/question_detail/q10301934870)、[命名文化への批判 note](https://note.com/mokatamk/n/n570e30449eb7))。ボードはそれを置き換えていない。✅

### C-5. なぜ定着しないか (不満点の整理)

1. **戦闘中の実用性が低い**: 表示は可能だが操作がバトル UI と競合、「戦闘中に実用するのは難しい」(JP まとめ)。テレポ時の自動アクティブ化などの UI 不満 (JP 公式フォーラム)。✅
2. **共有コードがゲーム内チャットで渡せない長さ** → 結局 Discord/Web 経由になり「ゲーム内完結」の利点が半減。⚠️ (取り込み手順が全て外部コピペ前提であることからの推定)
3. **表現力の上限**: 8 オブジェクト/ボード、テキスト 30 文字などの制限で、ゲーム8 級の複雑なカンペを再現できない。✅
4. **一時保存 (共有リスト) 20 枚の揮発性**。✅
5. 「90 秒表示制限」への不満は EN/JP どちらの検索でも**確認できなかった** (❌ — ゲーム内仕様の一次確認も不能。体感情報として扱うのが安全)。

### C-6. 判定: 「[stgy:] 共有コード保管」を今作るべきか

**第 2 回レポートの「#1 推奨」は過大評価だった。ただし最小実装なら依然ペイする。**

- **反対材料**: 日常利用の定着失敗 (C-2/C-3)、周辺ツールの極小さ (2★/21★)、JP 固定の主流がカンペ画像+マクロのまま。8 人固定が毎週使う機能にはならない可能性が高い。
- **賛成材料**: ゲーム8 が層別に共有コードを配布し続けている以上、「**自固定が採用した式のコードを 1 個置いておく**」需要は現実にある (野良合流・欠員補充時に「これ取り込んで」で済む)。マクロ/ウェイマークと完全同型なのでコストは極小。コンソール勢も使える唯一の図面手段という利点は不変。
- **推奨**: **マクロタブ内の「種別」追加 (マクロ / ウェイマーク / ストラテジーボード) として最小実装に格下げ**。専用タブ・専用テーブルは作らない。**デコード → SVG プレビュー (第 2 回の第 2 段階案) は見送り** — 依存 OSS が 2★ 規模で、ゲーム内機能ごと風化するリスクに見合わない。

---

## D. 広域・深掘りツールスキャン

### D-1. ACT / IINACT / FFLogs アップロードパイプライン

**JP 固定が「ログを残す」ための最小構成** (portal の練習ログ機能の前提知識):

| 構成 | 内容 | 確度 |
|---|---|---|
| 最小構成は「**固定内 1 名だけ**が計測・アップロード」 | FFLogs はレポート単位なので全員導入は不要。JP の定番解説も 1 名運用前提 ([とらめも ACT 完全ガイド 2026-04 更新](https://toramemoblog.com/act-install) / [FFLogs アップロード解説](https://toramemoblog.com/fflogs-upload)) | ✅ |
| 王道: ACT + FFXIV_ACT_Plugin + OverlayPlugin (+ cactbot) → FFLogs Uploader | cactbot は [OverlayPlugin/cactbot](https://github.com/OverlayPlugin/cactbot) に移管後も活発 (現行レイド trigger 継続) | ✅ |
| 軽量代替: **IINACT** (Dalamud プラグイン) | [marzent/IINACT](https://github.com/marzent/IINACT): 274★、活発。「FFLogs Uploader と **100% 互換**」と明言。ACT 本体不要・低負荷。⚠️ パッチ直後はプラグイン更新待ちが必要 ([古いと rank 無効化の事例](https://github.com/marzent/IINACT/issues/162)) | ✅ |
| JP オーバーレイ文化 | DPS 表示 Kagerou / Skyline、読み上げ「スペスペ」+ [ff14-act.com のタイムライン配布](https://ff14-act.com/timeline-data/)が旧来定番。近年は Dalamud 系へ重心移動 | ✅ 存在 / ⚠️ スペスペの現役度 |
| 2026 新要素: **FFLogs「Auto Logging」** | [発表記事](https://www.patreon.com/warcraftlogs/posts/feature-auto-163794583): ルール設定で対象コンテンツの live log を自動開始。「回し忘れ」への公式解 | ✅ 発表 / ⚠️ 課金条件未確認 |
| JP の ToS 感覚 | 「使用はグレーゾーン・自己責任、**他人を貶める用途が処罰対象**」が JP ブログ圏の共通理解 ([例](https://bunchiry.com/actfflogs/))。配信にオーバーレイを映さない・数値を晒さないのが JP のマナーライン | ✅ |

**portal への含意**: クライアント側は扱わない方針を維持。ただし**「ログ担当の手引き」を静的ページ 1 枚持つ**価値はある (計測担当・パッチ週の注意・Auto Logging 設定例・解説リンク集)。コスト: 極小。

### D-2. 練習・シミュレーション系 — 2025-2026 に「fight 再現シム」がジャンルとして成立

| ツール | 実態 | JP 関連度 | 確度 |
|---|---|---|---|
| [FF14 Toolbox Gaming Space](https://ff14.toolboxgaming.space/) | タイムライン再生の老舗。JP でも Lodestone 日記で教材利用の実績。現行ティアの JP 製コンテンツ作者は特定できず | 中 | ⚠️ |
| [xivsim.com](https://www.xivsim.com/game/) | ブラウザでマルチプレイ練習セッション (リンク共有、同一 RNG リプレイ、bot 補充)。DSR/TOP/FRU 等の絶対応 | 低〜中 | ✅ 存在 / ❌ 活況度 |
| [raidsim (susy-bakaa)](https://github.com/susy-bakaa/ffxiv-raid-sim) | Unity 製・[Web 版あり](https://susybakaaa.itch.io/raidsim)。M12S P2 対応が最大。NA/EU strat 選択式。更新継続 | 低 (**JP 式 strat 非対応**) | ✅ |
| [Waju-Sims](https://github.com/WCGH/Waju-Sims) | **2026-06 出現の本命格** (41★)。**DMU / DSR / FRU** のギミックシム。NA 主流 strat 実装。[Web 動作 fork](https://github.com/califorliu/DMU-Sims-online/) あり | 低 (NA strat 前提) | ✅ |
| [Simulant](https://github.com/MnFeN/Simulant) | CN 発「ゲーム内ネイティブ描画」ACT プラグイン型シム (81★)。クライアント注入系で portal スコープ外 | 低 | ✅ |
| 木人系 | [Stone, Sky, Sea 計算機](https://ffxiv.azizarar.com/) (⚠️ 7.x 追随未確認)、xivgear のシム、[Amas-FF14-Combat-Sim](https://github.com/Amarantine-xiv/Amas-FF14-Combat-Sim) | 中 (xivgear のみ) | ⚠️ |

**要点**: fight シムは **strat (処理法) に強く従属**し、現存シムはほぼ NA/EU strat 実装。**JP 式 (ゲーム8 式等) を実装したシムは確認できなかった** (❌)。JP 固定にとっての実用度は「絶で海外式を採用した場合」に限られる。
**portal への含意**: リンクカード扱いで十分。攻略リンクのサイト判定に xivsim.com 等を足して「シム」バッジを付ける程度。

### D-3. 日程調整の日本標準

| ツール | 実態 | portal との関係 | 確度 |
|---|---|---|---|
| **デイコード (Daycord)** | **重要な発見: portal が同期取り込みしている character-sheets.appspot.com/schedule/ はデイコードそのもの** ([開発者紹介](https://kg-masashige.fanbox.cc/posts/1716399) / [解説](https://toramemoblog.com/daycord1))。Discord bot で調整ページ生成 + **開催日に自動リマインド** | 既に取り込み元。**未借用は「Discord への自動リマインド/催促」** | ✅ |
| 調整さん | 汎用 ○×△ 出欠表。「毎回 URL 発行し直す」手間で固定の週次運用には不向きという声 | 単発イベント向き | ✅ |
| 伝助 | FF14 固定での利用の証拠は確認できず | — | ❌ |
| TimeTree | 固定の予定共有に使う例あり。「×/遅刻時刻/△」の記入ルール運用 | 借りる物は薄い (iCal export くらい) | ✅ 存在 / ⚠️ 普及度 |
| Google シート + GAS + Discord | JP 固定の最大勢力のまま ([例1](https://note.com/suigetukarin/n/n431652fdf1ed) / [例2](https://github.com/okapiffxiv/xivraidteam)) | ○×△ 入力 → 全員入力完了で開催自動判定、が JP の事実上の標準文法 | ✅ |
| Discord イベント / Raid-Helper | JP 固定での主流化の証拠は薄い | — | ⚠️ |

**借りる価値 (優先順)**:
1. **出欠未入力者への自動催促** — デイコードの核心価値。portal は native スケジュール + Discord 通知基盤を持つので追加コスト小。**今回の調査全体で最も費用対効果が高い施策**。
2. ○×△ 3 値入力 + 全員入力完了で開催自動確定の文法。
3. iCal export (スマホカレンダー導線)。

### D-4. JP 攻略情報源の構造

**JP の strat 流通は 4 層構造**:

1. **ゲーム8** — 事実上の中央。層別ページに**マクロ + 図解 + (7.4 以降) ストラテジーボード共有コード**を同梱。「Game8 式」という共通言語の供給源。✅
2. **YouTube 解説者** — [ぬけまる](https://x.com/nukemarugames)が代表格。動画タイトルが「Game8 掲載 ◯◯式」とゲーム8 準拠を明示する構造。式の分裂が野良事故の原因になる程度に影響力あり。✅
3. **個人運営の「野良主流」観測サイト** — **[ふうcだよ](https://fuucdayo.com/)** が最有力 (絶ごとの野良主流カンペ集 + マクロ集を常時更新)。[ヤーン速報](https://yan-flash.com/)も同系。✅
4. **Lodestone 日記 / note / X** — 固定向け改変カンペ・共有コードの散布層。✅

**「JP 版 Materia Raiding はあるか」**: 完全一致は無いが、機能的等価は「**ゲーム8 × ふうcだよ**」の組。Materia の「ウェイマーク JSON 同梱・OSS」に相当するものは JP に無い (JP はウェイマーク JSON 配布文化自体が薄い)。EN 側もこの 1 年で [NAUR](https://naurffxiv.com/) / [Ulti Strats](https://ultistrats.com/) / [wtfdig](https://wtfdig.info/) と per-fight 構造化リソースが乱立。✅

**portal への含意**: リンクカードのサイト判定辞書に **fuucdayo.com / yan-flash.com / naurffxiv.com / ultistrats.com / wtfdig.info** を追加すると Discord 取り込みの整理精度が上がる。コスト: 極小。

### D-5. 2025-2026 の新顔 (前 2 回に無いもの)

| 新顔 | 何か | portal への関係 | 確度 |
|---|---|---|---|
| **FFLogs/Archon の機能拡充** | ① Auto Logging ② [Multiple Report Analysis](https://www.archon.gg/ffxiv/articles/news/multiple-report-analysis) — 複数夜のレポート横断分析 (サブスク) ③ guild ページの prog pull 自動選択 | ②③は portal の練習ログと正面競合だがサブスク壁あり。**「サブスク機能の無料代替」という立ち位置を明確に** | ✅ |
| **Tomestone.gg の prog point 論争** | prog point 表示が PF 門前払い文化を強めるという賛否が継続 | 「個人を序列化して表示しない」原則の傍証 | ✅ |
| **fight シム群** (D-2) | 2025-2026 の最大の新ジャンル | リンクカードで十分 | ✅ |
| **あせろぐ FFXIV Strat Share** | JP 発のボード+マクロ共有 DB (開発継続) | 「探す場所」としてリンク可 | ✅ 存在 / ❌ 規模 |
| **AI ベースのログレビュー** | **成立した製品は確認できず**。xivanalysis がルールベース自動指摘の現役最上位のまま | 今は作らない/待つが正解 | ❌ |

### D-6. 統合推奨の総括 (コスト感つき)

| 施策 | 元ネタ | コスト | 判定 |
|---|---|---|---|
| 出欠未入力者への自動催促 (Discord) | デイコード | 小 | **最優先** |
| ログ担当手引きページ | D-1 | 極小 | やる |
| リンク判定辞書に fuucdayo / yan-flash / NAUR / ultistrats / wtfdig / xivsim 追加 | D-4/D-2 | 極小 | やる |
| [stgy:] コード保管 = マクロタブ内の 1 種別に**格下げ実装** | C | 極小 | やる (プレビューはしない) |
| ○×△ 3 値出欠 + 全員入力で開催確定 | JP シート文化 | 小〜中 | 次点 |
| シム / AI ログレビューの自作・深統合 | D-2/D-5 | — | **やらない** |

### 確度の総括 (C/D)

- ✅ 固い: ゲーム8 の共有コード掲載、GitHub 系の定量、IINACT/cactbot の状況、デイコード = character-sheets の同一性、ふうcだよ/ヤーン速報の役割、EN/JP の「使われていない」基調。
- ⚠️ 薄い: まとめサイト系は本文直接確認不可 (スニペット依存)、スペスペの現役度、Auto Logging の課金条件。
- ❌ 未確認: ffxivstrats.io / あせろぐの投稿規模、「90 秒制限」不満の実在、AI ログレビュー製品、伝助の FF14 利用。
