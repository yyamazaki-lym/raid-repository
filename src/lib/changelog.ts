/**
 * Hand-curated release notes. Shown in the settings dialog when the
 * user clicks the "更新履歴" button.
 *
 * Entries are user-facing (paste-into-a-newsletter level), not
 * commit-level. Add a new top-level item whenever package.json
 * version is bumped, ideally in the same commit.
 *
 * Order: newest first (the UI renders top-to-bottom as-is).
 */

export type ReleaseEntry = {
  version: string;
  /** ISO date `YYYY-MM-DD` of the bump. */
  date: string;
  /** Short bullet points for the release. Markdown not supported. */
  notes: string[];
};

export const RELEASES: ReleaseEntry[] = [
  {
    version: "1.9.37",
    date: "2026-04-28",
    notes: [
      "📐 チップ縦中央: `translateY` を撤回。日付スパンだけ動かしていたので「アイコンが日時から下にずれる」問題が起きていた。代わりに chip 全体に `pt-0 pb-1.5` の非対称 padding → 日付・アイコン双方が同じ量だけ上方にシフト。両者の baseline を維持",
      "🎨 ルールボタン位置を修正: 凡例左寄り → 更新ボタン横の右端 1 グループに統合 (`ml-auto` を group コンテナに適用)。ポップオーバーは `right-0` で button right-edge 揃え、画面右端からの overflow を抑制",
      "🎯 `parseTopText` が `■コメント` 直前で truncate するように修正。コメント内容が運用ルール表示に混入しないように。コメントは出席表ヘッダーの著者名横で別途表示しているため重複も解消",
    ],
  },
  {
    version: "1.9.36",
    date: "2026-04-28",
    notes: [
      "💬 ルールアイコンを「未回答 (－)」横から凡例の右寄りに移動。アイコンのみから「ルール」ラベル付きボタンに変更し、より目立つ位置に独立配置",
      "📐 ルールポップオーバーの幅を `w-[min(20rem,...)]` (320px) → `w-[min(36rem,...)]` (576px) に拡張、フォントサイズも 11px → 12px に上げて読みやすく",
      "🎯 `parseTopText` の HTML エンティティ / 絵文字対応を強化 — 数値文字参照 `&#xNNN;` `&#NNN;` を `String.fromCodePoint` でデコード、`<img alt=\"絵文字\">` 形式の Twemoji も alt テキストを抽出",
      "📐 チップ縦中央: `translateY(-2px)` → `-3px` に強化。Linux/Noto では下寄り過剰になるが、Yu Gothic UI ユーザーの可読性を優先",
    ],
  },
  {
    version: "1.9.35",
    date: "2026-04-28",
    notes: [
      "🔬 Claude Preview の dev server 経由でチップ縦中央問題を実測。Linux/Noto 環境では 4.5/5.5 px と OS 側で既に近似中央。Windows / Yu Gothic UI ユーザーの「上 2x 下」の報告は font 固有の glyph 描画位置によるものと判断。`transform: translateY(-2px)` を inner span に適用し、Yu Gothic UI 環境で中央 (約 4.5/5.5) に揃うよう物理シフト",
      "💬 凡例の「未回答 (－)」横にコメントアイコン (MessageSquare) を追加。スケジュール元サイトの上部にある運用ルール / 注意事項テキストを `parseTopText()` で抽出し、ポップオーバーで表示。元サイトに該当テキストが無ければアイコン自体を非表示",
      "🔧 `parseSchedule` の戻り値型 `ParsedSchedule` に `topText: string \\| null` を追加。`<p>` `<pre>` `<blockquote>` `<h2>`-`<h4>` 要素を `<table>` より前から抽出 → script/style 除外 + HTML strip + 空白正規化",
    ],
  },
  {
    version: "1.9.34",
    date: "2026-04-28",
    notes: [
      "📐 過去の活動カードのチップ縦中央 7 度目: `inline-flex` を撤廃して `inline-grid grid-flow-col auto-cols-max place-items-center` に切り替え。`h-[24px]` 固定 + `leading-none` で line-box=glyph 高さ。grid の `place-items-center` が line-box を box の中央に配置するため、font metric に依存しない数学的な中央揃えに",
    ],
  },
  {
    version: "1.9.33",
    date: "2026-04-28",
    notes: [
      "📐 過去の活動カードのチップ日付縦中央 6 度目: padding ベースの補正 (1.9.30-1.9.32) が全部「変化なし」だったため、CSS `transform: translateY(-1px)` で render された glyph 自体を物理シフトする方式に切り替え。layout box は不変のまま視覚的にだけ 1px 上にずらすため、font metric の非対称や line-box 計算に依存しない直接的な補正",
    ],
  },
  {
    version: "1.9.32",
    date: "2026-04-28",
    notes: [
      "📐 過去の活動カードのチップ日付縦中央 5 度目: 非対称 padding を `pt-0.5 pb-1.5` (4px diff) → `pt-0 pb-2` (8px diff) に強化。1.9.31 の補正でも依然として上が長く下が短く見えていたため、最大限の補正に切り替え",
    ],
  },
  {
    version: "1.9.31",
    date: "2026-04-28",
    notes: [
      "📐 過去の活動カード (簡易チップ) の日付縦中央揃え 4 度目の試行 — symmetric padding でなく **asymmetric padding** で物理的に補正。`pt-0.5 pb-1.5` (上 2px / 下 6px) で、システム日本語フォント (Yu Gothic / Hiragino / Noto Sans CJK JP) が CJK glyphs を em-box の上寄りに描く特性を相殺。1.9.28-1.9.30 の symmetric な解 (`h-6 + items-center`, `leading-6`, `py-1`) は font metrics 自体の非対称性を解決できなかったため、padding 側で 4px の差をつけて視覚的に中央揃えに",
    ],
  },
  {
    version: "1.9.30",
    date: "2026-04-28",
    notes: [
      "📐 ページ全体の最大幅を絞ってスリム化 — `max-w-6xl` (1152px) → `max-w-5xl` (1024px)。PC ブラウザで横に間延びして見えていたのを縮め、カードや表の密度を上げる。site-header / main-tabs / sub-tabs / portal-main の 4 箇所すべて更新",
      "📐 過去の簡易チップ: 日付の縦中央揃えを `h-6 leading-6` 方式から **natural sizing + `py-1`** に変更。固定高さを使わずブラウザの自然な行ボックスで上下対称な padding (4px + 4px) を確保。`leading-tight` でテキスト行が縦中央に配置され、システム日本語フォントの ascent/descent ratio に依存せず確実に等間隔の余白に",
    ],
  },
  {
    version: "1.9.29",
    date: "2026-04-28",
    notes: [
      "📐 過去の簡易チップ: 日付の縦中央揃えを修正 — `leading-tight` (1.25 × 11px = 13.75px line-box) → `leading-6` (24px line-box) に変更。chip 高さ h-6 (24px) と line-box 高さが一致し、ブラウザの自然な baseline-center で glyphs が確実に中央に配置される (システム日本語フォント fallback でも安定)",
      "📐 詳細日程テーブル: 日程列とメンバー列の間隔を縮小 — 日程列 `pr-2 → pr-1`、メンバー列 `px-2 → px-1.5`、日程列内 `gap-1.5 → gap-1`。両テーブル共通のアイコン slot 予約により auto-size が一致するため、`min-w-[15rem]` も撤廃 (タイトな自然サイズ)",
    ],
  },
  {
    version: "1.9.28",
    date: "2026-04-28",
    notes: [
      "📐 過去の簡易チップ: 日付テキストを縦中央揃えに修正。`leading-none` を `leading-tight` に変更し、line-box を自然サイズに戻して h-6 chip 内の上下余白を均等化",
      "📐 日程列を upcoming / past 両テーブルで同じ幅に固定 — `min-w-[15rem]` で最小幅を担保。これでメンバー名列の開始位置が両テーブル間で揃う",
      "📐 日程列内のアイコン間隔を `gap-2` → `gap-1.5`、cell padding を `pr-1` → `pr-2` に微調整。Logs アイコンと隣のメンバー名列との間が空きすぎていた問題を緩和",
      "🔄 スケジュール表の凡例 (Legend) 行の右端に更新ボタンを追加。クリックで `router.refresh()` を呼び、サーバ側 `fetchSchedule()` が再実行されて最新の出欠状況に反映 (`useTransition` でスピナー表示)",
    ],
  },
  {
    version: "1.9.27",
    date: "2026-04-28",
    notes: [
      "📐 次回開催日カード: 左端のカレンダーアイコンと右端の「募集」ボタンを縦中央寄せに統一。`Frame` を `items-start` → `items-center` に変更し、`recruitmentTopButton` を内側コンテンツ列から `rightSlot` として切り出して flex 兄弟要素に。これでアイコン / コンテンツ / ボタンの上下空白が等間隔になる",
      "📐 過去の詳細日程: メモが無い行で行内が左詰めになっていたのを修正。`SessionMemoDot` に `reserveSpace` prop を追加 — 詳細日程テーブルでは true (16px placeholder で行間整列)、簡易チップでは false (コンパクト)",
      "📐 詳細日程の Film / Logs スロットを常に確保 — 動画 / Logs 不在の場合も h-5 w-5 placeholder で予約。全行のアイコンが垂直に同位置で揃う",
      "💬 スケジュールページの簡易/詳細トグルボタンのマウスオーバー文言を整理 — 「簡易表示: ON（クリックで非表示）」のような状態説明を「過去の活動 (簡易) — 直近の日付チップ」「過去の活動 (詳細) — 出席者付きの全件表」のような『何が表示されるか』ベースの分かりやすい文に",
    ],
  },
  {
    version: "1.9.26",
    date: "2026-04-27",
    notes: [
      "🧹 過去の簡易日程チップ: 動画 / Logs / メモのいずれも紐づいていない日に表示されていた `SessionMemoDot` の不可視 placeholder (h-4 w-4) を削除。何もない日付チップは日付テキストだけがコンパクトに表示される",
      "📐 過去の詳細日程: 動画なし + Logs ありの日に Logs アイコンが動画スロットに左ズレしていたのを修正。Logs が存在する場合のみ Film スロットを placeholder で確保し、Logs アイコンは右スロットに固定。両方とも無い場合は何もレンダリングしない",
    ],
  },
  {
    version: "1.9.25",
    date: "2026-04-27",
    notes: [
      "🐛 HTML scrape の日付抽出バグを根治 — レポートページの「Created by NAME on Sat Mar 21 2026」(アップロード日時) が raid 開始日として誤抽出され、3/21 のレポートが 3/23 の動画に紐づくケースが発生していた",
      "🔧 `extractTimestampMs` を全面書き直し: 1) コンテキストから ALL の日付パターンを収集 2) 「Created by / Uploaded / Posted by / Last updated / Updated on / Modified on」 直後の日付は upload metadata として除外 3) 残った候補の中からリンク位置に最も近いものを選択 (priority + distance)",
      "🔧 コンテキストウィンドウを ±1500 (合計 3000 文字) → ±400 (合計 800 文字) に縮小。隣接 report 行の日付が混入するリスクを下げる",
      "📐 優先順位を再構成: 視覚的な日付 (年月日 / Month D, YYYY / ISO) > `<time datetime>` 属性 > `data-timestamp` 属性 > 単独 Unix 数値。FFLogs の `<time>` や data 属性は Created/relative time を含むことがあるため",
    ],
  },
  {
    version: "1.9.24",
    date: "2026-04-27",
    notes: [
      "🎯 FFLogs マッチャを大幅シンプル化 (再設計) — 「動画タイトル日付 == レポートの JST カレンダー日 + content classifier」のみで判定。1.9.4 以降積み重ねた ±時間ウィンドウ / RAID_HOUR_JST / SMALL_PENALTY / diffHours / expectedRaidMs 等のスコアリング機構を全部撤廃",
      "📐 ユーザー知見ベース: 「Log の startTime はコンテンツ挑戦日なので外れ値にならない」 → 同 JST 日マッチで十分。複雑な時刻調整は不要",
      "🔧 session linker (linkReportsToSessions) も同様に「同 JST 日」のみに簡素化。±1h/+4h ウィンドウ撤廃。同日複数レポートのときのみ session 開始時刻に近い report を tie-breaker",
      "撤廃した定数: MATCH_WINDOW_MS / SESSION_WINDOW_BEFORE_MS / SESSION_WINDOW_AFTER_MS",
      "撤廃した診断項目: diffHours (もう意味を持たない)。reportStartJst (HH:mm) は残置 — 開始時刻の目視確認用",
    ],
  },
  {
    version: "1.9.23",
    date: "2026-04-27",
    notes: [
      "📐 コンテンツカード右カラム: Discord 取り込みが無いカードで `⋮` (編集ボタン) が左にずれる見た目を修正。+N/wk と同サイズの `invisible` placeholder を入れて ⋮ を card 右端に固定",
      "FFLogs マッチング: 「Criterion / Variant Dungeon は raid 扱いで除外しない」とのユーザー指示により、1.9.23 で試した非 raid フィルタは撤回。既存の `contentMismatchPenalty` がコンテンツグループ違いを既に reject しているため、現状の挙動で問題なし",
    ],
  },
  {
    version: "1.9.22",
    date: "2026-04-27",
    notes: [
      "📐 コンテンツカード右カラムレイアウト最終形 — `[+N/wk] [⋮]` を card 右端に横並びで配置し、StatusBadge は その上に重ねて 左端を +N/wk に揃える。外側 `items-end` で右寄せ、内側 `items-start` で StatusBadge と +N/wk の左ラインを一致させる二段構造に",
    ],
  },
  {
    version: "1.9.21",
    date: "2026-04-27",
    notes: [
      "📐 コンテンツカード右カラムを再調整 — 上段にステータス、下段に [+N/wk] と [⋮] を横並び (justify-between)。StatusBadge と +N/wk の左端が揃う構造に",
      "⏱ 「動画時間 + 投稿日時を取得」に進捗表示を追加 — 16 件ずつのバッチで処理し、ボタンに `動画時間 X/Y` のリアルタイム数値を表示。「メタデータ取得中…」で止まっているように見えた問題を解消",
      "🔬 「YouTube 取得テスト (1 件)」を再導入 — 「動画時間 + 投稿日時を取得」が `0/N 件` で全件失敗するケース (Vercel 側 IP ブロック / consent gate / sign-in wall 等) の原因を 1 URL ずつ診断できる。試行ログ (status, html size, page markers, matchedStrategy) を表示",
      "DB 側に `backfillVideoDurationsChunk(afterId)` server action を追加。id-cursor pagination で安全にループ可能",
    ],
  },
  {
    version: "1.9.20",
    date: "2026-04-27",
    notes: [
      "📐 コンテンツカード右カラムのレイアウトを 1.9.19 で崩していたのを修正。1.9.18 の見た目を尊重しつつ、ステータス / +N/wk / 詳細メニュー (3点) を縦に並べて右端ラインだけ揃える方式に。w-full でバッジを引き伸ばす一律スタイルは撤回 — バッジの固有サイズを保ったまま右揃え",
    ],
  },
  {
    version: "1.9.19",
    date: "2026-04-27",
    notes: [
      "📐 コンテンツカードの右カラムを縦 1 列に整列 — ステータスバッジ / Discord +N/wk バッジ / 詳細メニュー (3点) を上から順にきれいに並べた。+N/wk が無いカードでも CategoryMenu の縦位置がずれないよう placeholder を確保 (5.5rem 幅で右端揃え)",
      "🐛 「クリア時間が表示されない」原因を診断するバッジ追加 — 結果パネルの各コンテンツ行に「⚠ N 件未取得」を表示。動画時間 (`duration_seconds`) が NULL の動画が累計から除外されている件数が一目でわかる。表示されたら「動画時間 + 投稿日時を取得」を実行 → 再度クリア時間取得",
      "🐛 「クリア日時が取得できない」コンテンツの原因診断を追加 — 結果パネルに「該当なし — 詳細」セクションを新設。コンテンツ別に下記いずれかの理由が表示される: 動画なし / 他コンテンツのみ (フィルター除外) / クリア / clear 含む動画なし / 4 層クリア該当なし。それぞれにサンプル動画タイトル (最大5件) を併記し、何が抜けているか目視確認できる",
    ],
  },
  {
    version: "1.9.18",
    date: "2026-04-27",
    notes: [
      "🏆 コンテンツ一覧のクリア日 (Trophy) バッジをクリック可能に — その日付の動画ページに遷移し、該当動画を自動スクロール + ハイライト表示。動画ページに `?focusDate=YYYY-MM-DD` クエリを追加し、タイトル日付 / posted_at の順でマッチした最初の動画にフォーカス",
      "📐 バッジ並び替え: クリア日 (Trophy) の右隣に「クリアまでの累計時間」 (Hourglass →) を移動。「いつクリアした → かかった時間」の自然な視線順に",
      "📐 Discord 取り込み件数 (`+N/wk`) バッジを右カラムの詳細メニュー (3点) の左隣に移動。練習時間 / クリア時間バッジの並びと混ざらず、Discord 由来は別エリアに",
    ],
  },
  {
    version: "1.9.17",
    date: "2026-04-27",
    notes: [
      "📅 クリア日時の判定を「動画タイトル日付 > posted_at > created_at」優先順に変更 — 投稿は活動後になるので若干ズレる問題を解消。タイトルに「【2024 08 22】4層クリア」のような日付があれば常にそちらを採用",
      "🚫 他コンテンツの動画を自動除外 — クルーザー級カテゴリーに LH級の動画が混ざっている等のケースで、`videoBelongsToCategory` (バイリンガルクラシファイア) によりカテゴリーと別グループに分類された動画はクリア判定 / クリア時間集計から除外",
      "🔧 略称認識追加: 「LH級」「クル級」「ヘビ級」「ウェル級」「ライトヘビー」「クルーザー」をキーワードに追加",
      "🛠 メンテナンスメニュー: 「クリア日時を強制再計算」を「クリア日時 / クリア時間の取得」に改名。確認ダイアログ削除、赤色スタイル → 通常色 (アンバーアイコン)",
      "📊 結果パネルにバッジを追加: 取得元 (`title` / `posted` / `created`)、クリアまでの累計時間、除外件数 (`-N 異`)。コンテンツごとに 1 行で全情報が見えるように",
      "📍 クリア日表示に年下2桁を追加 — `12/15` → `25/12/15` で異年クリアの区別が一目で",
      "♻️ `extractDateFromTitle` / `findContentGroups` / `CONTENT_GROUPS` を `@/lib/title-date.ts` / `@/lib/content-groups.ts` に切り出し、複数モジュールで共有可能に",
    ],
  },
  {
    version: "1.9.16",
    date: "2026-04-27",
    notes: [
      "🧹 メンテナンスメニュー整理 — 「出席状況を即時スナップショット」「1件テスト (診断用)」を削除 (前者は cron 自動運用、後者は使い道不明)。「動画時間取得 (YouTube)」と「投稿日時を Discord から取得」を 1 ボタン「動画時間 + 投稿日時を取得」に統合し、結果も 1 つのパネルに合体。「クリア日時を設定 (NULL のみ)」を削除し「クリア日時を強制再計算」に一本化",
      "🏆 4層クリア検出を導入 — 零式 (Savage) コンテンツでは「4 層」「四層」「P4S/P8S/P12S」「M4S/M8S」のいずれか + 「クリア」 / `clear` キーワードの両方を要求。1〜3 層クリア動画では first_clear_at が立たないように。絶 (Ultimate) と 4 人用 (Criterion / Variant) は単純なクリアキーワードで OK (従来通り)",
      "📋 スケジュール表のメンバーリスト ヘッダーを `Members` (デフォルト) / `Legends` (絶クリア達成済) に切替。グループに「絶〇〇」コンテンツが status=クリア済 で登録されていれば称号として LEGENDS 表記",
      "⏱ 「クリアまでの累計時間」ロジック改修 — 従来は最古の動画 〜 クリア日 で集計だったが、零式は「1層練習」動画 (タイトルに「1層」/「P1S」/「M1S」/「M5S」等を含む最初の動画) を起点に。絶 / 4人用は従来通り最古の動画 〜 クリア日 で集計",
      "🔧 backfill / discord-import / createCategoryLink の first-clear 検出を全部新ロジック (`isClearTitleForCategory`) に移行。category 名を渡すことで tier に応じた判定を実施",
    ],
  },
  {
    version: "1.9.15",
    date: "2026-04-27",
    notes: [
      "🐛 FFLogs HTML scrape のタイムゾーンバグ修正 — `2026年3月28日 22:30` のような JST 表記の日付を `Date.parse` がローカル (Vercel = UTC) として解釈し、9時間ズレで JST カレンダー日が翌日にズレる現象。日本語 / 英語 / ISO の各パターンに `+09:00` を明示し、JST として正しく解釈するように",
      "🎯 マッチング方式を「同 JST 日」厳格 → 「想定 raid 開始時刻 (22:00 JST) ± 12h ウィンドウ」に変更。深夜またぎ raid (23:30開始 → 翌日0:30) を吸収しつつ、24h 差の連続日 raid は 12h ウィンドウから外れて誤マッチを起こさない。ユーザー要望の「±X時間でマッチ」方式",
      "🔍 設定ダイアログのマッチ詳細にレポートの実際の開始時刻 (JST) と期待時刻との差 (±N.Nh) を表示 — 深夜またぎや時刻ズレを目視で検証できる",
      "🔧 スケジュール編集ダイアログ: 1.9.14 で付けた URL fragment / query 自動スクロールヒント (`#date-` / `?date=`) は character-sheets が honor しないので削除。代わりに iframe を CSS `translateY` で初期表示位置をオフセット (デフォルト 280px ずらしてカレンダー入力部分から表示)。「上 / 中央」トグルボタンで切替可能",
      "🗑 動画ページに複数選択 → 一括削除機能を追加。ヘッダーの「選択」ボタンで選択モードに入り、各動画カード全体がチェックボックス化。N 件選択して「N 件削除」で一括削除 (確認ダイアログあり)",
    ],
  },
  {
    version: "1.9.14",
    date: "2026-04-27",
    notes: [
      "🔗 設定ダイアログの「更新履歴」ボタンの隣に GitHub リポジトリへのリンク (Source) を追加。lucide-react v1 系で Brand Icon (Github 等) が削除されたため、simple-icons の SVG をインライン化",
      "📍 スケジュールの出欠セルから開く編集ダイアログで、対象日付までの自動スクロール補助を試行 — `buildEditUrl` に `rawDate` 引数を追加し、URL に `?date=YYYY-MM-DD` クエリと `#date-YYYY-MM-DD` フラグメントを付与。character-sheets 側がアンカーをサポートしていれば自動スクロール、未対応なら無視されるベストエフォート",
      "ダイアログタイトルに対象日付 (例: 「Y.Y の出欠を編集 (2026-04-09 を含む)」) を含めているので、自動スクロールしない場合も画面上でどの行を見るべきかが明確",
    ],
  },
  {
    version: "1.9.13",
    date: "2026-04-27",
    notes: [
      "🐛 FFLogs コンテンツ照合の取りこぼし修正 (重要) — seed の 'アルカディア:ヘビー級' は半角コロン、CONTENT_GROUPS の keyword は全角コロン '：' を使っていたため、classifier が seed カテゴリーを認識できず常に bigram fallback (0.5 ambiguous) になっていた。同日に別コンテンツの FFLogs report があると無関係マッチが成立する状態",
      "fix: `findContentGroups` 前に正規化 (`normalizeContentText`) を追加 — 全角英数字 → 半角、全角コロン → 半角、ideographic space / 中点を空白に。これで seed カテゴリーが正しく group 認識される",
      "🚫 マッチ判定を厳格化 — VIDEO のカテゴリーが既知 group に分類できる場合、report が分類できない (zone 名が keyword に未登録) なら mismatch=1 として強制リジェクト。bigram fallback で 0.5 になり同日別コンテンツが通る抜け穴を塞ぐ",
      "📺 スケジュール表のユーザー名 / 出欠セルが「インライン編集ダイアログ」を開くように — 従来は `target=\"_blank\"` で別タブ遷移だったが、その場で iframe を開いて編集 → 閉じてポータルに即復帰、というフローに。スマホでもタブを行き来せず編集可能",
      "ダイアログ右上に「新しいタブ」ボタンを残置 — character-sheets 側が iframe 表示を拒否する場合のフォールバック",
      "✏️ FFLogs 表示名入力欄の placeholder を 'TaroYamada (display name)' → 'Ascian_Emet-Selch' に変更",
    ],
  },
  {
    version: "1.9.12",
    date: "2026-04-27",
    notes: [
      "🔒 セキュリティ強化: 全頁の URL レンダリングに safeHref() ガードを導入 — `javascript:` / `data:` / `file:` 等の危険 scheme が `<a href>` や `<iframe src>` に到達しないように。動画カード / FFLogs リンク / FFLogs 入力 / 軽減・ロット iframe / セッションメモポップオーバーで適用",
      "🔒 サーバー / API 層も多層防御: `createCategoryLink` / `updateCategoryLink` で URL の scheme + parseability を再検証、`/api/page-title` でも http(s) のみ受理（フォーム検証をバイパスされても DB に危険 URL が入らない）",
      "📐 コンテンツ → 動画ページの統計バッジが折り返し対応 — モバイルで時計 / クリア日バッジが行を超えても綺麗に整列",
      "📐 設定ダイアログのモバイル対応改善: 縦の最大高を sm 未満で `80svh`、sm 以上で `70svh` に分岐。短い縦画面のスマホでも内容が見やすく",
      "📐 設定ダイアログ FFLogs 表示名入力欄: `min-w-[12rem]` を `sm:` 限定にして、狭い画面でフォームが破綻しないように",
      "📐 出席表のユーザー列: 異常に長い名前を `max-w-[7rem]` + ellipsis で切り詰め、テーブル全体の崩れを防止。フル名はホバーツールチップ + 編集リンクで確認可能",
      "🚀 YouTube 埋め込み iframe に `referrerPolicy=\"no-referrer\"` + `loading=\"lazy\"` を追加 — ポータル URL が YouTube に Referer として漏れないように、画面外なら遅延読み込みで初期表示も軽量化",
    ],
  },
  {
    version: "1.9.11",
    date: "2026-04-27",
    notes: [
      "🐛 1.9.10 で残っていた legacy 誤マッチを根治 — schema migration が既存 logs_url 行を全て 'manual' タグで埋めたため、'auto' のみワイプする再同期では 1.9.10 以前の誤マッチ（0328↔0401 等）が残り続けていた。`linkFflogsReportsToVideos` の冒頭に「初回 1 回だけ既存 'manual' 行を 'auto' へ flip する」bootstrap を追加（`app_settings.fflogs_source_bootstrap_v1` フラグでガード）。次回「FFLogs と動画を連動」実行時に legacy 誤マッチが自動的にクリアされる",
      "動画ページ (各コンテンツ → 動画タブ) のヘッダーに統計バッジを追加 — 累計練習時間 / クリアまでの累計時間 / 初クリア日。コンテンツ一覧ページのバッジと同じ表示形式で、ホバーで詳細時間を表示",
      "各動画カードに再生時間バッジを表示 — duration_seconds が NULL のものは表示なし（バックフィル後に自動表示）",
      "クリア検出のタイムスタンプ精度を改善 — `createCategoryLink` 経由の自動 first-clear 検出で、行の `created_at` ではなく `posted_at` (YouTube アップロード日 / Discord 投稿時刻) を優先採用。古いクリア動画を後日登録した場合の誤った日付を防止",
      "duration / clear 表示ヘルパーを `@/lib/duration-format` に切り出し — コンテンツ一覧と動画ページで重複していた formatter を共通化",
    ],
  },
  {
    version: "1.9.10",
    date: "2026-04-27",
    notes: [
      "FFLogs マッチに 自動 / 手動 ソース管理を導入 — 動画と過去予定の logs_url それぞれに `logs_url_source` カラム ('auto' | 'manual') を追加。再同期時に 'auto' のレコードのみクリアし、ユーザーが手動で設定した URL は保持されるように",
      "「FFLogs と動画を連動」実行時、過去の自動マッチ結果（誤マッチ含む）を毎回ワイプしてから再計算。これにより 1.9.9 までに DB に残った旧誤マッチ（0328↔0401 など）も次回同期で自動的に解消",
      "動画編集ダイアログ・予定メモポップオーバーから設定した logs_url は 'manual' フラグ付きで保存され、以後の自動同期で上書きされない",
      "DB スキーマ追加: `category_links.logs_url_source` / `schedule_past_sessions.logs_url_source` (default 'manual', CHECK 'auto' or 'manual')。既存データはマイグレーション時に 'manual' 扱いとなるため、初回のみ「全 logs URL クリア」→「FFLogs と動画を連動」で全件クリーン化推奨",
    ],
  },
  {
    version: "1.9.9",
    date: "2026-04-27",
    notes: [
      "FFLogs 自動マッチを「タイトル日付必須」に厳格化 — タイトルから raid 日が抽出できない動画は自動マッチ対象外に。posted_at fallback による隣接 raid 日との誤マッチ（連鎖ズレ）を完全防止",
      "対象外になった動画は、動画編集ダイアログから FFLogs URL を手動指定する運用に",
      "診断パネルの注記を更新: 「失敗 = 自動マッチ対象外」と明示。失敗タイトル一覧で対象動画を確認可能",
      "スコアリングロジック簡素化: title-date 必須なので fallback 経路を完全削除、コード量 ~50 行削減",
    ],
  },
  {
    version: "1.9.8",
    date: "2026-04-27",
    notes: [
      "FFLogs 連動の詳細診断にタイトル日付抽出統計を追加 — 「成功 N 件 / 失敗 N 件」と、失敗したタイトルのサンプル（上位 10 件）を折り畳みで表示",
      "ユーザー報告の「日時ズレ」を切り分けるため：成功率が低ければ regex を改善する材料に、サンプルの実タイトルを見て対応すべきパターンを判定可能",
    ],
  },
  {
    version: "1.9.7",
    date: "2026-04-27",
    notes: [
      "FFLogs マッチング: タイトル日付の抽出パターンを大幅拡張 — 旧版は「2026 04 01」「2026/04/01」「20260401」など年付き形式のみ対応だった。新規対応: 「4月1日」「4/1」「【0401】」など年無し形式も認識（year は posted_at の年を fallback で使用）",
      "対応パターン詳細: ① 年付き YYYY-MM-DD or YYYY/MM/DD or YYYY 年月日 ② 8 桁 compact YYYYMMDD ③ 年無し M月D日 ④ 年無し M/D (resolution 等の数字には誤マッチしないよう boundary check) ⑤ 年無し 4 桁 compact MMDD ([...] や 【...】 ブラケット内のみ)",
      "DB スキーマ拡張: `categories.expected_fflogs_zone_ids INTEGER[]` を追加（将来的にコンテンツ単位で FFLogs zone ID 厳密フィルタを設定できるようにするための準備。現在はまだマッチには影響しない）",
    ],
  },
  {
    version: "1.9.6",
    date: "2026-04-27",
    notes: [
      "🐛 重大バグ修正: posted_at が null の動画でタイトルに日付があってもスキップしていた → タイトル日付があれば posted_at 不要に変更（タイトルから日付取れる動画 OR posted_at がある動画は全部マッチ対象）",
      "コンテンツ照合をグループベースに刷新 — 「絶アレキサンダー」「Ultimate Alexander」「TEA」を同じ Group 0 として扱う、cross-language 対応。グループは Ultimate (TEA/UCOB/UWU/DSR/TOP/FRU/Zodiark) / 零式 (Asphodelos P1-4S, Abyssos P5-8S, Anabaseios P9-12S) / Arcadion (Light-heavyweight M1-4S / Cruiserweight M5-8S / Heavyweight / Welterweight) / Criterion 等",
      "両側のコンテンツが分類できた場合は厳密グループ照合（同グループ → 0、別グループ → 1 reject）",
      "longest-match-wins masking で「ライトヘビー級」が「ヘビー級」グループに誤分類されないよう保護",
      "片側未分類の場合のみ bigram fallback。未分類同士なら 0.5 で曖昧扱い",
      "結果として 03/28 の AAC Heavyweight レポートと 04/01 の AAC Heavyweight 動画が同グループ → 同日のみ matchable、別グループの誤マッチは絶対起きない",
    ],
  },
  {
    version: "1.9.5",
    date: "2026-04-27",
    notes: [
      "FFLogs マッチング: タイトル日付の一致条件を strict に変更 — 旧版は ±1 日許容していたが、近接 raid 日があると誤マッチの原因に。タイトル日付がある動画は **完全同一日のみ**マッチ可、それ以外は完全リジェクト",
      "結果パネルの match 詳細に `[YYYY-MM-DD]` 形式で video 日付 と report 日付を表示。一致時は緑、不一致時は赤で警告。一目で誤マッチを発見可能",
      "詳細表示例:`▶ [2026-04-01] 【2026 04 01】絶アレキ` (緑 = video 日付と report 日付が一致) / `▶ [2026-04-01→2026-03-28] ...` (赤 = ズレあり、要確認)",
    ],
  },
  {
    version: "1.9.4",
    date: "2026-04-27",
    notes: [
      "コンテンツページの戻る Link を「Categories」→「Contents」に修正（1.9.1 で残っていた）",
      "FFLogs マッチング戦略を 2 段階に再設計 — Step 1: 動画タイトルから raid 日付を抽出 (例「【2026 04 01】」「20260401」「2026年4月1日」等) → FFLogs report の startTime (JST 日付) と比較。同一日 = 完全一致、1 日違い = 弱マッチ、2 日以上 = 完全リジェクト",
      "Step 2: 同一日の動画が複数ある場合、コンテンツ名 bigram overlap で勝者を決定（既存ロジック）",
      "fallback: 動画タイトルから日付が読めない場合のみ posted_at ベースの ±18h window 判定。タイトル日付ありの match に対して 12h ペナルティを付け、タイトル日付ありが優先されるように",
      "結果: 「0401 動画に 0328 レポートが紐づく」のような誤マッチが、タイトルに raid 日が入っている動画では発生しなくなる",
    ],
  },
  {
    version: "1.9.3",
    date: "2026-04-27",
    notes: [
      "🐛 日時ズレの主因を修正: `posted_at` が null の動画では `created_at` (DB 投入時刻) にフォールバックしていた → これが実際の raid 日と全然違う日付になり誤マッチを引き起こしていた。posted_at が null の動画は紐づけ対象から完全に除外するように変更",
      "結果パネルに「posted_at 未設定でスキップした動画 N 件」を表示。多い場合は コンテンツページ → メンテナンス → 「Discord 履歴から posted_at を補完」を実行推奨",
      "コンテンツ照合を bigram (2文字 N-gram) ベースに刷新 — 旧版の hardcode keyword は手動 category 名 (ユーザーが任意につけた raid 名) に対応できなかった。bigram overlap で言語非依存に類似度判定（25% 以上で確定一致、それ未満は曖昧扱いで小ペナルティのみ）",
      "keyword リストは confidence boost として残す (混在言語の zone vs category 名で確実に拾うため)",
      "結果として: 厳密にコンテンツ違いと判断した時のみリジェクト、不確実な場合は時間距離で決まる安全なフォールバック",
    ],
  },
  {
    version: "1.9.2",
    date: "2026-04-27",
    notes: [
      "FFLogs マッチング精度改善: 動画↔レポートのマッチ時間幅を ±36h → ±18h に縮小（隣接する raid 日に誤マッチしないよう）",
      "新規: コンテンツ照合機能 — レポートの zone name と動画のコンテンツ名で keyword overlap を確認。絶アレキサンダーのレポートが絶オメガの動画に紐づくような content mismatch を防ぐ",
      "v2 GraphQL クエリに `zone { name }` を追加して raid 名を取得",
      "動画フェッチに `category:categories(id, name)` を join してコンテンツ名を取得",
      "スコアリング: 同一コンテンツ確認時はそのまま、片側不明時は小ペナルティ (6h 相当)、コンテンツ不一致確定時は完全 reject (Infinity)。これで 絶/零式/極 の違うレポートが混在しないように",
      "認識キーワード: 絶アレキサンダー・絶オメガ検証・絶バハムート・絶ニーズヘッグ・絶エンドシンガー・絶アルテマウェポン・絶ゾディアーク、アスフォデロス零式・アバンギャルド零式・アルカディア (ライト/ヘビー/クルーザー/ウェルター級)、ucob/uwu/tea/dsr/top/fru、p9-12s, m1-4s 等",
    ],
  },
  {
    version: "1.9.1",
    date: "2026-04-27",
    notes: [
      "用語変更: UI 上の「カテゴリー」を「コンテンツ」に置換 — レイドコンテンツの単位として直感的に分かりやすい呼称に変更（DB スキーマ・URL・型名・関数名は `category` のまま、UI 表示文字列のみ変更）",
      "影響箇所: ヘッダーのスイッチャー / ページタイトル / コンテンツ一覧 / 各サブページのエラーメッセージ / 募集テンプレダイアログ / メンテナンスメニュー / コンテンツ追加・編集ダイアログ など、合計 14 ファイル",
      "「Categories」ヘッダーも「Contents」に変更",
    ],
  },
  {
    version: "1.9.0",
    date: "2026-04-27",
    notes: [
      "FFLogs 連動の構成を 3 段階のソースに整理 — ① v1 表示名 (基本・常時表示)、② v2 OAuth (オプション・畳み)、③ Session Cookie (Private/Unlisted 用・オプション・畳み)",
      "v1 path を復活: シンプルセットアップ向け（FFLOGS_API_KEY env var + 表示名のみ、Public レポートを取得）",
      "linker のフェッチを multi-source 統合に変更 — 設定済の v1 + v2 + Cookie 全部で並列取得 → union + dedupe (by report code)",
      "設定ダイアログの UI 整理: v1 表示名フォームが常時見える基本セクションに、v2 OAuth と Session Cookie は折り畳み式（クリックで展開）。Private/Unlisted を取得したい時に Cookie セクションを開く流れが分かりやすく",
      "「FFLogs と動画を連動」ボタンの活性化条件を v1 表示名 OR OAuth 接続のいずれかが必要に変更",
      "matching algorithm 改善 (1.8.4 から継承): 動画↔レポートを「最古を greedy」から「全ペアスコア → 近い順」に変更、絶コンテンツのような連続 raid で誤マッチを防止",
    ],
  },
  {
    version: "1.8.4",
    date: "2026-04-27",
    notes: [
      "FFLogs 紐づけのマッチングアルゴリズムを改善 — 旧版は「ウィンドウ内の最古の未使用レポート」を採用していたため、Day1 のレポートが Day27 の動画に紐づくような誤マッチが起きていた（特に絶コンテンツのように同じ raid を何回も繰り返すケース）",
      "動画↔レポート: グローバルにスコア計算 (delta = video.posted_at - report.startMs、レポートが動画より前なら delta、後なら delta×4 のペナルティ) → 全ペアでスコアが小さい順に貪欲マッチング",
      "過去予定↔レポート: 同様に scheduled start time との絶対時刻差でスコア計算、近い順にマッチング",
      "結果として、近接する複数の raid 日に対して正しい組み合わせが選ばれる（既存の誤紐づけは「全 logs URL クリア」→「再連動」で修正可能）",
    ],
  },
  {
    version: "1.8.3",
    date: "2026-04-27",
    notes: [
      "FFLogs HTML スクレイパーの日時パーサーを大幅強化 — 旧版は英語形式 / ISO のみ対応で日本語ページの「2026年4月17日 00:33」形式をパースできず、25 codes 検出しても 0 reports しか取得できていなかった",
      "新しい `extractTimestampMs` 関数で 7 種類のパターンに対応: ① data-timestamp 属性、② data-time/start 属性、③ datetime 属性、④ 日本語「YYYY年M月D日 HH:MM」、⑤ 英語「Month D, YYYY」、⑥ ISO「YYYY-MM-DD」、⑦ Unix timestamp 数値",
      "コンテキスト窓を ±500 → ±1500 文字に拡張（FFLogs の verbose な HTML 構造で日時が遠くにある場合に対応）",
      "診断パネルに「HTML サンプル」を追加 — 最初のレポートコード周辺の HTML を 800 文字まで折り畳み表示。今後 FFLogs の構造が変わった場合の調査に使える",
    ],
  },
  {
    version: "1.8.2",
    date: "2026-04-27",
    notes: [
      "FFLogs 連動結果の詳細診断パネルに「Session Cookie 適用: あり/なし」表示を追加 — cookie が今回の sync で実際に使われたか一目で分かる",
      "HTML スクレイプの「取得 reports 件数」を診断に追加 — codes 検出数とは別に、最終的に何件のレポートを scraping から得たか確認可能",
      "HTML スクレイプエラーがあれば理由を診断パネルに表示（cookie 期限切れ時の redirect 検出など）",
    ],
  },
  {
    version: "1.8.1",
    date: "2026-04-27",
    notes: [
      "FFLogs Session Cookie 取得手順を Network タブから Cookie ヘッダー全体をコピーする方式に変更 — `_fflogs_session` という特定の名前を探す方式は環境によって名前が違うため確実性が低かった。Network → Headers → Cookie の値全体を 1 行コピーする方法に統一",
      "placeholder と説明文を「Cookie ヘッダー全体 (name1=val1; name2=val2; ...)」に更新",
    ],
  },
  {
    version: "1.8.0",
    date: "2026-04-27",
    notes: [
      "FFLogs Private/Unlisted 自動取得 — 「Session Cookie」opt-in 機能を追加。fflogs.com にログイン状態の cookie を一時的に保存して、ログイン状態のスクレイプで全 visibility のレポートを取得",
      "🛡️ ワンタイムユース設計 — cookie は連動実行直後に自動削除される。次回紐づけ時は再貼り付けが必要（紐づけは新規カテゴリー作成時など頻度が低い操作なのでこの運用で OK）",
      "強い security warning と取り方説明（Chrome DevTools 手順）を UI に明示",
      "「今すぐ削除」ボタンも追加（連動を行わずに cookie を消したい場合用）",
      "introspection を User / ReportData / Query 3 type に拡張 — User 型に reports フィールドが存在しないことを確定（5 fields: id / name / avatar / guilds / characters）",
    ],
  },
  {
    version: "1.7.11",
    date: "2026-04-27",
    notes: [
      "🔬 GraphQL イントロスペクション機能を追加 — 自動化路線で進めるため、FFLogs v2 スキーマの `User` 型に隠されたフィールドがないか調査するための diag 出力。連動結果の詳細診断パネルから「User 型のフィールド一覧」を展開可能",
      "もし `privateReports` / `uploadedReports` などのフィールドがあれば、それを使うことで Private/Unlisted の自動取得が可能になる可能性。フィールドリストの内容次第で次の実装方針が決まる",
    ],
  },
  {
    version: "1.7.10",
    date: "2026-04-27",
    notes: [
      "🔬 FFLogs v2 API の挙動が判明 — `reportData.reports()` フィルタ無しは「自分が見える他人のレポート」を返す仕様（OAuth スコープが許す範囲、ギルド共有など）。自分自身のレポートは含まれない",
      "v2 GraphQL を `reports(userID: me.id)` フィルタ付きに戻す — これが「自分所有のレポート」を取得する正しい API パス。ただし Public のみ返る仕様（v2 OAuth でも Private/Unlisted は API で露出されない）",
      "owner の sanity check を追加 — userID filter で安全のはずだが、API 仕様変更時の保険として `owner.id !== me.id` のレポートは defensive にスキップ",
      "0件マッチ時のヒント文を実態に即して書き換え — 「FFLogs API は Public 設定のレポートしか取得できない」「対処は fflogs.com 上で Public に変更 or 手動 URL 紐づけ」と明示",
    ],
  },
  {
    version: "1.7.9",
    date: "2026-04-27",
    notes: [
      "🐛 重大: 1.7.8 で導入した「Layer 2 (raw 全件採用)」を撤廃 — owner filter を通過しない 600+ 件の他ユーザーのレポートを誤って採用していた。3+3 件マッチした以外のものは全部別人のログだった",
      "新戦略: ユーザー自身のレポートだけを取得する v2 GraphQL owner-filter + HTML スクレイプの **両方を実行 + union + dedupe** 方式に変更。両方とも user-specific なソースなので別人のレポートが混入しない",
      "結果パネルの「クエリしたユーザー名」表示にソース注記: `v2 GraphQL — 自分所有のレポートのみ` / `HTML スクレイプ — 自分のプロフィールページ` / `v2 GraphQL owner-filter + HTML スクレイプ`",
      "レポート 625 件到達時の「上限到達」バッジを結果に追加（FFLogs v2 API のページ上限）",
      "既存の誤紐づけは「全 logs URL クリア」ボタンで除去可能 → 再連動で正しい結果に",
    ],
  },
  {
    version: "1.7.8",
    date: "2026-04-27",
    notes: [
      "FFLogs 連動の取得を 3 段階フォールバック構造に — ① v2 GraphQL with owner filter → ② v2 GraphQL UNFILTERED (raw 採用) → ③ HTML スクレイプ。owner filter で全消えする状況も raw fetch で救済",
      "詳細診断パネルを結果に追加 — v2 currentUser id/name、raw fetch 件数、owner filter 通過件数、owner 上位の出現リスト、HTML スクレイプの page1 サイズと code 検出数を全部表示。0 件原因の切り分けに使用",
      "HTML スクレイパーをより permissive に — 全ての `/reports/{code}` リンクを抽出、周辺 ±500 文字から日時を抽出（`<tr>` 構造に依存しない）",
      "結果パネルの「クエリしたユーザー名」表示にどのソース経由か注記（OAuth 認証済 / OAuth → owner filter なし / OAuth → HTML スクレイプ）",
    ],
  },
  {
    version: "1.7.7",
    date: "2026-04-27",
    notes: [
      "FFLogs: HTML スクレイピングをフォールバックパスとして追加 — v2 GraphQL が 0 件返した場合、`https://www.fflogs.com/user/reports-list/{userId}` の公開ページをパースして Public + Unlisted レポートを取得（ユーザー提案）",
      "v2 GraphQL の owner 比較を改善: `String(owner.id) === String(me.id)` でロバストに、加えて `owner.name === me.name` を fallback に",
      "結果パネルで HTML スクレイピング fallback 経由かどうか判別可能（クエリしたユーザー名表示に「HTML スクレイプフォールバック」と注記）",
      "備考: HTML スクレイピングは Public 公開ページがソースなので、真の Private レポートは依然取得不可。完全に取得したい場合は FFLogs 上で「Public」または「Unlisted」に変更するか、メモポップオーバーから手動 URL 紐づけ",
    ],
  },
  {
    version: "1.7.6",
    date: "2026-04-27",
    notes: [
      "FFLogs v2 GraphQL: ページネーション上限超過エラー修正 — 32 → 25 ページに戻す（FFLogs API は page > 25 を「performance 改善まで使用不可」として拒否）。総取得件数の上限は 25 × 25 = 625 件に",
      "スケジュール表「確定」バッジの文字ズレ修正 — バッジ内の `✓` アイコンを削除して「確定」テキストのみに。これでヘッダーの「確定」と各行のバッジの「確定」が文字位置で揃う",
      "ヘッダー th にも `text-center` を明示してセルの `text-center` と完全に一致するように",
    ],
  },
  {
    version: "1.7.5",
    date: "2026-04-27",
    notes: [
      "FFLogs v2 GraphQL: `reports(userID:)` フィルタを撤廃 — userID で絞ると API 側で Public のみに制限される挙動を発見。代わりに無制限取得 → クライアント側で `owner.id === me.id` フィルタする方式に変更。これで OAuth 認証ユーザー本人の Private/Unlisted を含む全レポートが取得対象になる（FFLogs API の挙動次第。なお Private が依然取れない場合は v2 GraphQL スキーマの制約の可能性が高く、メモポップオーバーから手動で URL 紐づけする必要があります）",
      "ページネーション上限を 16 → 32 ページに拡張（全 800 件まで対応、ギルド共有が多い環境向け）",
      "スケジュール表「確定」バッジを大幅 refine — h-4 w-4 の小さな ✓ から、h-6 + 「✓ 確定」テキスト併記の emerald (緑) バッジに。デフォルトの cyan 系から色を差別化して一目で「確定された日」と分かるように",
      "未確定セルは「·」のみで控えめに、確定との視覚差を最大化",
    ],
  },
  {
    version: "1.7.4",
    date: "2026-04-27",
    notes: [
      "🐛 GraphQL エラー修正: `User.reports` フィールドは存在しないため、2 段階クエリに変更 — まず `userData.currentUser { id }` で自分の userID を取得し、その後 `reportData.reports(userID: $myID)` で自分のレポートだけ取得",
      "二重保険: owner.id が currentUser.id と一致するレポートのみ採用するフィルタを GraphQL filter に加えてクライアント側でも実施",
      "DB クリーンアップ: 旧 `app_settings.fflogs_username` 行を自動削除（設定ダイアログ open 時 + FFLogs 連動実行時の両方で idempotent に削除）",
    ],
  },
  {
    version: "1.7.3",
    date: "2026-04-27",
    notes: [
      "🐛 重大: v2 GraphQL クエリを `reportData.reports` から `userData.currentUser.reports` に変更。前者は API client が見えるレポート全体（**他人のレポートを含む**）を返していたため誤紐づけが発生していた",
      "v1 周りの実装を全削除 — `fetchFflogsReports` (v1 REST)、`setFflogsUsername` / `getFflogsUsername` / `parseFflogsDisplayName`、`FFLOGS_USERNAME_KEY` 定数、`FFLOGS_API_KEY` 環境変数の参照、設定ダイアログの v1 表示名フォーム、保存時の v1 username 自動保存処理など。FFLogs 連動は v2 OAuth のみに",
      "「全 logs URL クリア」ボタンを設定ダイアログに追加 — 過去の誤紐づけを一括削除して再連動するための保守機能。動画 / 過去予定の logs_url を null に",
      "`FFLOGS_API_KEY` 環境変数は不要になりました（残しておいても害はありませんが削除推奨）",
      "DB の `app_settings.fflogs_username` 行は今後参照されません（残しておいても害はありませんが削除しても OK）",
    ],
  },
  {
    version: "1.7.2",
    date: "2026-04-27",
    notes: [
      "FFLogs OAuth トークンエンドポイントの認証方式を Basic Auth に切り替え — FFLogs はリクエストボディに client_id / client_secret を入れる方式を `invalid_client` で拒否するため、HTTP Authorization Basic ヘッダーで送る形に修正（refresh_token のリフレッシュも同じ）",
      "401 / invalid_client エラー時は「client_id/secret が正しいか、Public Client にチェックが入っていないか確認」の具体メッセージを表示",
    ],
  },
  {
    version: "1.7.1",
    date: "2026-04-27",
    notes: [
      "OAuth 接続ボタン押下時に環境変数未設定だった場合、生 JSON エラー表示ではなく、ホーム画面に redirect して toast でメッセージ表示するように修正",
      "エラー文言を具体的な対処手順入りに改善（fflogs.com/api/clients/ で OAuth クライアント作成 → Vercel に環境変数設定 → redeploy）",
    ],
  },
  {
    version: "1.7.0",
    date: "2026-04-27",
    notes: [
      "FFLogs v2 GraphQL + OAuth Authorization Code Flow に対応 — 接続すると Public + Unlisted + Private のすべてのレポートが取得対象に。設定ダイアログから「FFLogs と OAuth 接続」ボタンで認可フロー開始",
      "新ルート: `/api/auth/fflogs/start`（OAuth 開始）/ `/callback`（コード交換）/ `/disconnect`（トークン削除）。state は app_settings に一時保存して CSRF 検証",
      "新 server module: `fflogs-oauth.ts` — トークン保存・自動リフレッシュ・接続状態取得",
      "v2 GraphQL fetcher: `fetchFflogsReportsV2` — `reportData.reports` をページネーション込みで取得（最大 16 ページ × 25 件 = 400 件）",
      "linkFflogsReports: OAuth 接続済みなら v2 を優先、未接続なら v1（表示名 + API キー、Public のみ）にフォールバック。結果パネルに使った API バージョンを表示",
      "ENV 変数追加: `FFLOGS_OAUTH_CLIENT_ID` / `FFLOGS_OAUTH_CLIENT_SECRET`（Vercel に設定要、fflogs.com/api/clients/ で OAuth クライアント作成）",
      "redirect_uri はリクエスト Origin から動的に組み立て — localhost と本番ドメインの両方を OAuth クライアント側で許可リストに登録",
      "メモポップアップの FFLogs URL 編集セクションを最下部に移動（メモ閲覧の邪魔にならないよう）",
      "メモ既読ドット（紫）の表示位置のレイアウトシフトを修正 — count=0 の時も h-4 w-4 の placeholder を確保し、リロード時のチラつきを排除",
    ],
  },
  {
    version: "1.6.8",
    date: "2026-04-27",
    notes: [
      "FFLogs URL の手動紐づけ機能を追加 — メモポップオーバーに「FFLogs URL」セクションを統合。日付クリック → URL 入力 → 保存 で個別の日に直接バインド可能",
      "メモポップオーバー: 現在の URL があれば「現在の URL を開く」直リンク表示、新タブで確認可能",
      "メモポップオーバー: 保存 / クリア両方のアクション、URL 形式バリデーション (fflogs.com/reports/...) 付き",
      "v1 API の `includePrivate=true` パラメータを撤廃 — ドキュメント未記載のため効果がなかった。Unlisted/Private レポートは v1 API では取得不可と確定（v2 OAuth は今後対応予定）",
      "新 server action: `setSessionLogsUrl(rawDate, url, sessionDetails?)` — 既存の past_session を UPDATE、なければ provided details で UPSERT",
    ],
  },
  {
    version: "1.6.7",
    date: "2026-04-27",
    notes: [
      "FFLogs 0件マッチ時の診断パネルに「クエリしたユーザー名」のエコー表示追加（実際に何が API に送られたか確認可能）",
      "0件マッチ時の対処を 3 段階で説明追加 — ① API キーと表示名のユーザーが別人、② 表示名の綴り誤り、③ 別メンバーが最近の分をアップ。原因切り分けの順序を明示",
    ],
  },
  {
    version: "1.6.6",
    date: "2026-04-27",
    notes: [
      "FFLogs 連動の修正: API は表示名 (display name) のみ受け付ける（数値 ID は 400 エラー）。1.6.5 で数値 ID 入力を許可したのを取り消し、表示名専用に戻す",
      "数値 ID / `/reports-list/{id}` URL 形式が入力された場合は保存時に拒否し、「fflogs.com/profile で表示名を確認してください」と案内",
      "URL 形式 `https://www.fflogs.com/user/{name}` または `/user/{name}/reports-list/...` から表示名を自動抽出",
      "API の 400 エラー (Invalid user name) を分かりやすく日本語化し、数値 ID と分かれば具体的な対処を提示",
      "設定ダイアログの placeholder を表示名重視に変更（例: TaroYamada）",
    ],
  },
  {
    version: "1.6.5",
    date: "2026-04-27",
    notes: [
      "FFLogs 連動: API リクエストに `includePrivate=true` を自動付与 — これまで非公開 (Private) レポートが返らないため最近のレポートが取得できていなかった (主因)",
      "FFLogs ユーザー入力: 数値 ID（プロフィール URL 末尾の `70734` 等）と表示名の両方を受け付け、プロフィール URL の貼り付けにも対応（末尾を自動抽出）",
      "設定ダイアログ: FFLogs フィールドのラベル右に「fflogs.com/profile」直リンク追加、placeholder と説明文を実態に合わせて更新",
    ],
  },
  {
    version: "1.6.4",
    date: "2026-04-27",
    notes: [
      "FFLogs 連動: 0件マッチ時の診断パネルに「取得済みレポート (新しい順上位 10 件)」を折り畳み表示。タイトル + 日付 + リンク付きで、設定したユーザー名が想定通りのアカウントを指しているか即座に確認可能",
      "FFLogs 連動: レポート期間が古すぎる場合のヒントを「ユーザー名が最近のレポートをアップしていないことを意味します」に書き換え",
      "スケジュール募集ボタン: hover 時の title 属性 / toast / aria-label からカテゴリー名を削除（次回開催日カードに既に表示されているので冗長だった）",
    ],
  },
  {
    version: "1.6.3",
    date: "2026-04-27",
    notes: [
      "設定ダイアログ — スケジュール URL ラベルの右側に「character-sheets を開く」リンクを追加（ワンクリックで取得元ページへ）",
      "設定ダイアログ — 「URL の取得手順」展開ガイド（折り畳み式 4 ステップ）を追加。初回設定時に貼り付ける URL の形式が分かるように",
      "FFLogs 連動: 0 件マッチ時に診断情報（レポート期間 / 動画期間 / 過去予定期間）を表示。期間ズレが原因かどうかを一目で確認可能",
      "FFLogs 連動: 仕様の説明を強化 — レポート所有者ベースで取得される旨、別メンバー登録時の対処、限定公開 (Unlisted) は取得可・非公開 (Private) は不可の旨を明記",
    ],
  },
  {
    version: "1.6.2",
    date: "2026-04-27",
    notes: [
      "FFLogs マッチが 0 件になる不具合を修正 — v1 API の `start`/`end` は秒単位（10桁）なのにミリ秒として扱っていたため、タイムスタンプが 1970 年扱いになり全マッチ失敗していた。10桁/13桁を自動判別して秒なら ×1000 で正規化",
      "メモポップオーバー: スクロールで閉じる挙動を撤廃 → スクロール追従に変更（多数のメモがあっても表示し続けながらスクロール可能に）",
      "メモポップオーバー: パネル自体に `maxHeight: calc(100vh - top - 16px)` を設定、内部 body 部に `flex-1 overflow-y-auto` で長文対応。新規メモフォームも下部からスクロールで到達可能",
      "メモ一覧: 内部の `max-h-[18rem]` 制限を撤廃 — 外側のパネルスクロールで全メモを閲覧可能に",
    ],
  },
  {
    version: "1.6.1",
    date: "2026-04-27",
    notes: [
      "FFLogs エラーメッセージを改善 — 401 (Invalid key) 時に「Vercel Settings → Environment Variables で v1 Web API キーを確認してください」と具体的に表示",
      "FFLogs 401: v1 Public API key が必要（v2 OAuth の client_id/secret は不可）。設定ダイアログにキーの取得元と種別の説明追加",
      "FFLogs 404: ユーザー名が見つからない場合に「綴りまたは公開設定を確認」と表示",
      "`shadcn` パッケージを runtime → devDep に移動（npm warn の `node-domexception` 由来。CSS import のみで build 時にしか使わないため）",
    ],
  },
  {
    version: "1.6.0",
    date: "2026-04-27",
    notes: [
      "FFLogs 連動 — 過去予定（動画なしの日も）にも logs URL を自動紐づけ。スケジュール表 / 簡易チップで日付セルから直接 FFLogs を開けるように",
      "DB スキーマ追加: `schedule_past_sessions.logs_url TEXT` 列。supabase/schema.sql を本番 DB に再実行してください",
      "FFLogs 連動の挙動修正: 設定ダイアログの「連動」ボタンを押すと、ユーザー名が未保存でも自動保存してから API を呼ぶように（以前は「未設定」エラーで止まっていた）",
      "FFLogs ユーザー名フィールド: プロフィール URL の入力を撤廃（API は username 文字列のみ受け付けるため）。URL が入力された場合は明確なエラー表示",
      "FFLogs 連動結果パネル: 動画 / 過去予定の両方の matched 件数を表示、絵文字で video / session を区別",
      "簡易過去日程チップの縦中央揃え修正: `font-mono` を撤廃（CJK fallback の baseline 不整合が原因）+ `h-6 + leading-none` で固定。Geist Sans + tabular-nums で数字も揃う",
      "スケジュール表の出欠記号（◯⏰△×－）の縦位置揃え修正: 同じく `font-mono` を撤廃して `leading-none` で baseline を統一",
    ],
  },
  {
    version: "1.5.6",
    date: "2026-04-27",
    notes: [
      "全頁の typography を refine — `tracking-widest` (0.1em) を `tracking-[0.18em]` に統一（uppercase mono ラベルが詰まりすぎていた箇所を改善）",
      "スケジュール表 — 日付セルに `tabular-nums`、時刻表記を `font-mono tabular-nums` に統一して縦の揃い改善、`~` を opacity 60% に",
      "スケジュール表 — Film / FFLogs アクションアイコンの hover に glow（box-shadow）追加、ホバーターゲットを h-4 → h-5 に拡張",
      "スケジュール表 — Legends 行の背景を secondary に、行ヘッダーの padding 調整",
      "Past セクションヘッダー — 「Past · 過去の予定」を mono 大文字 + 通常フォントの 2 段組に分割（読みやすさ向上）",
      "簡易過去日程チップ — 角丸を sm → md に、padding 調整、アクションアイコンを h-4 に揃える",
      "次回開催日カード — 時刻に `tabular-nums`、アイコンコンテナに inset shadow 追加",
      "次回開催日カード「確定」バッジのトラッキングを 0.22em に統一",
      "サブタブ — アイコン gap を tighten（gap-1.5）、トラッキング 0.16em に統一",
      "サイトヘッダー — バージョン表記の構造を改善（vX.X.X · BETA を分離 + tabular-nums）",
      "ステータスバッジ — トラッキング 0.18em / 0.22em に統一",
      "カテゴリー一覧 — 「Drag to reorder」見出しに紫ドットと整理された 2 段組を追加",
      "カテゴリーカード — 名前のトラッキング 0.04em で読みやすさ微調整",
    ],
  },
  {
    version: "1.5.5",
    date: "2026-04-27",
    notes: [
      "メモ削除確認ダイアログの暗転（背景ぼかし）を撤廃 — 背景の他の画面が見える状態に",
      "メモポップオーバーのデザインを refine — 紫アクセントのヘッダー帯、メモごとの hover 効果、入力フォームの余白統一、フォントウェイトとアイコンサイズの調整",
      "メモ削除モーダルのデザインを refine — rose アクセント、本文プレビュー枠の改善、ボタンの余白とトラッキング統一",
      "メモ既読ドット（紫）のホバー時のグロー強化",
      "カテゴリースイッチャーのドロップダウン幅を 32rem → 40rem に拡張、長いカテゴリー名は折り返さず truncate（ホバーで full title 表示）",
    ],
  },
  {
    version: "1.5.4",
    date: "2026-04-27",
    notes: [
      "メモ既存日の紫ドットをクリックでもポップオーバーが開くように（日付ラベル / ドットの両方がトリガー）",
      "メモ削除の確認ダイアログをページ中央に表示（ブラウザ標準 confirm を撤廃 → カスタムモーダル）",
    ],
  },
  {
    version: "1.5.3",
    date: "2026-04-27",
    notes: [
      "メモ削除後にリロードしないと一覧と紫ドットが残る不具合を修正（realtime DELETE で `old.raw_date` が欠落する DB 構成のフォールバック + 削除/追加/更新成功時に手動 refetch も発火）",
    ],
  },
  {
    version: "1.5.2",
    date: "2026-04-27",
    notes: [
      "メモが保存・表示されない不具合を修正（呼び出し側で realtime hook に渡す initial 値の参照を安定化 — 毎レンダリング `[]` リテラルを渡していたため、フェッチ済みデータが毎レンダ空配列で上書きされていた）",
    ],
  },
  {
    version: "1.5.1",
    date: "2026-04-27",
    notes: [
      "カテゴリースイッチャーから各ページへの遷移が動かない不具合を修正（DropdownMenuItem に戻して Base UI のクリック処理に乗せる）",
      "メモ realtime のフィルタを撤廃し callback 側で raw_date 照合（特殊文字混入で配信されない問題に対処）",
      "簡易過去日程チップの上下空白を `h-6 + leading-none` を撤廃して padding-only に（CJK グリフの自然な縦中央表示に）",
      "募集ボタンのホバープレビュー — タイトルからカテゴリー名を削除（冗長だったため）",
    ],
  },
  {
    version: "1.5.0",
    date: "2026-04-27",
    notes: [
      "FFLogs 連動: 設定で FFLogs ユーザー名を保存 → 動画の投稿日時 ±36h でレポートを自動マッチして logs URL に紐づけ",
      "サーバー側で FFLOGS_API_KEY 環境変数の設定が必要",
      "簡易過去日程チップの日時を単一 span に統一し上下空白を完全対称化",
    ],
  },
  {
    version: "1.4.2",
    date: "2026-04-27",
    notes: [
      "メモが取得・表示されない不具合を修正（realtime hook の初期 fetch 漏れ）",
      "簡易過去日程チップを固定高さ (h-6) + items-center に変更し、日時テキストの上下空白を対称化",
    ],
  },
  {
    version: "1.4.1",
    date: "2026-04-27",
    notes: [
      "簡易日程のメモポップオーバーがカード境界で隠れる不具合を修正（Portal 描画 + scroll で自動クローズ）",
      "メモ存在を示す紫ドットを時刻の右（行）/ 末尾（チップ）に移動",
    ],
  },
  {
    version: "1.4.0",
    date: "2026-04-27",
    notes: [
      "スケジュール日付（簡易チップ・詳細日時セル）クリックで共有メモのポップアップ — 全員に共通表示",
      "メモには名前と本文。複数登録可。名前は localStorage に保存して再入力不要",
      "メモがある日付には小さい紫ドットが表示",
      "マクロ追加フォームから「全角→半角」ボタンを除外（テンプレ専用に）",
    ],
  },
  {
    version: "1.3.6",
    date: "2026-04-27",
    notes: [
      "募集文ボタン（ヘッダーの ◧）はデフォルト muted 表示、ホバー時とドロップダウンを開いた時のみ cyan",
      "次回開催日カードの「募集」ボタンを少し大きく + 上下空白を統一 (h-7 / px-2.5)",
      "簡易過去日程チップを font-mono + leading-none に統一して文字の上下ずれを解消",
      "次回開催日カードの外枠を強調（border 不透明度 + glow を強化）",
      "マクロページ募集テンプレートのサブラベルが大文字風に見える問題を修正（font-display → 通常フォント）",
    ],
  },
  {
    version: "1.3.5",
    date: "2026-04-27",
    notes: [
      "マクロページから募集文を追加してもリロードまで反映されないバグを修正",
    ],
  },
  {
    version: "1.3.4",
    date: "2026-04-27",
    notes: [
      "募集ボタンを押した時に色が緑＋✓に変化（コピー成功の視覚フィードバック）",
      "簡易過去日程カードの上下パディングを揃えた（内側のスペース対称に）",
    ],
  },
  {
    version: "1.3.3",
    date: "2026-04-27",
    notes: [
      "マクロページの募集文テンプレはデフォルトで展開表示（1行程度なので隠す必要なし）",
    ],
  },
  {
    version: "1.3.2",
    date: "2026-04-27",
    notes: [
      "スケジュール表の各出欠セルを直接クリックで character-sheets 編集ページへ（新タブ）",
      "ホバー時に拡大表示でクリック可能なことを明示",
    ],
  },
  {
    version: "1.3.1",
    date: "2026-04-27",
    notes: [
      "出席状況の即時保存ボタンを過去予定 → 設定ダイアログに移動（結果に閉じるボタン付き）",
      "次回開催日カードの「確定」バッジをタイトル横に移動（右端より目立つ）",
      "次回開催日カードの「募集」ボタンにホバーで本文プレビュー表示",
    ],
  },
  {
    version: "1.3.0",
    date: "2026-04-27",
    notes: [
      "マクロ・募集文テンプレ: クリックで折り畳み式表示（タイトルだけで一覧性アップ）",
      "マクロ追加・編集をポップアップダイアログ化",
      "募集文テンプレを各カテゴリーのマクロページからも追加・編集・削除可能に",
      "過去の予定カードに「保存」ボタン追加（現在の出席状況を即時スナップショット）",
      "設定: DB保存件数の確認ボタンを Discord 履歴ボタンの隣に移動 + 閉じるボタン",
      "設定: 更新履歴の閲覧ボタン追加",
      "ヘッダーバージョンが package.json から自動同期",
      "スケジュール上の募集文ボタンをアイコンのみに統一（他ボタンと整合）",
      "スケジュールの Legend → Legends 複数形に",
    ],
  },
  {
    version: "1.2.1",
    date: "2026-04-27",
    notes: [
      "ヘッダーのバージョン表示を package.json から自動取得",
      "設定ダイアログに「更新履歴」ボタン + 履歴の閲覧",
    ],
  },
  {
    version: "1.2.0",
    date: "2026-04-27",
    notes: [
      "各カテゴリーに「マクロ」サブタブを追加（コピー対応・並べ替え可）",
      "マクロページに、カテゴリーに紐づく募集文テンプレートを read-only 表示",
      "募集文テンプレに category_id（紐づけ）+ サブラベル（1層 / 2層 等）",
      "募集文テンプレを並べ替え可能に（先頭が次回開催日カードのコピー対象）",
      "次回開催日カードに最上段テンプレのワンタップコピーボタン",
      "本文に全角→半角変換ボタン + 募集文テンプレ作成サイトの外部リンク",
      "ドロップダウン最上段に ★ Top のハイライト",
    ],
  },
  {
    version: "1.1.0",
    date: "2026-04-27",
    notes: [
      "出席状況スナップショット機構（毎日 21:50 JST 自動 + 手動ボタン）",
      "schedule_past_sessions に attendances + user_names 列追加",
      "Discord 通知チャンネルから過去日程を取り込み（設定ダイアログ）",
      "過去日程詳細テーブルに動画 / FFLogs リンク（36h ウィンドウ照合）",
      "簡易過去日程に動画 / Logs アイコン",
      "祝日名のホバー表示（holidays-jp.github.io から自動更新）",
      "次回開催日が当日の時に強調表示",
      "削除即時反映（REPLICA IDENTITY FULL）",
    ],
  },
  {
    version: "1.0.0",
    date: "2026-04-27",
    notes: [
      "v0.1 ALPHA → v1.0.0 BETA に正式版移行",
      "セマンティック・バージョニング採用 (PATCH / MINOR / MAJOR)",
      "公開 README 拡充（他固定向けセットアップガイド）",
      "YouTube Data API + Innertube MWEB 対応で限定公開動画も時間取得",
      "カテゴリーごとの累計練習時間 + クリアまでの時間表示",
      "初クリア日時の自動検出 + 手動編集",
      "カテゴリーカード / スイッチャーにサブページショートカット",
      "スケジュール過去日程: 簡易 / 詳細の2モード",
    ],
  },
];
