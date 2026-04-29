/**
 * Hand-curated release notes. Shown in the settings dialog when the
 * user clicks the "更新履歴" button.
 *
 * Entries are user-facing (paste-into-a-newsletter level), not
 * commit-level.
 *
 * Versioning scheme (from 2026-04-28, while staying on v1.9):
 *   `MAJOR.MINOR` + `(YYYY-MM-DD)` date suffix — patch dropped.
 *     - Small fixes / tweaks: keep MAJOR.MINOR, add a NEW entry with the
 *       new date. Multiple entries can share the same `version` field.
 *     - Notable feature additions / reworks: bump MINOR (e.g. 1.9 → 1.10).
 *     - Breaking / sweeping changes: bump MAJOR (e.g. 1.x → 2.0).
 *
 *   Pre-scheme entries (1.9.38 and earlier) used `MAJOR.MINOR.PATCH` and
 *   bumped patch per commit, which inflated 1.9 to 38 patches. Those
 *   entries are kept as-is for history. The transition is the topmost
 *   `version: "1.9"` entry — 1.9 stays put, just no more patches.
 *
 * Order: newest first (the UI renders top-to-bottom as-is).
 */

export type ReleaseEntry = {
  version: string;
  /** ISO date `YYYY-MM-DD` of the bump. */
  date: string;
  /**
   * Short bullet points for the release. Markdown not supported.
   * 旧スキーム (1.9.38 以前) で使用、新スキームでも軽微な変更で使う。
   * `parts` と排他: 同時指定された場合 UI は `parts` を優先表示。
   */
  notes?: string[];
  /**
   * 1 日内に多数のコミットがある日 (新スキーム運用後の典型) で、
   * notes を「コミットごとの part」に分割して表示するためのフィールド。
   * 各 part は折りたたみ可能 (`<details>`) で、title だけ常時表示し、
   * 詳細 body はクリックで開閉する。
   */
  parts?: ReleasePart[];
};

export type ReleasePart = {
  /** 折りたたみ時に常時表示される 1 行サマリー (絵文字 + 短い見出し) */
  title: string;
  /** 展開時に表示される本文 (1〜数文程度の詳細) */
  body: string;
};

export const RELEASES: ReleaseEntry[] = [
  {
    version: "2.1",
    date: "2026-04-29",
    parts: [
      {
        title: "🛡 TODO #24 続報 2: 過去日程は Discord/snapshot を authoritative source に + FFLogs scraper UA を実ブラウザ化",
        body: "ユーザー報告: 「4/27(月)/4/28(火) がまだ過去に出る」「FFLogs Logs バッジが付かない」。\n\n**過去日程フィルタの再設計**: 直前 commit で過去フィルタを `status === \"DECISION\"` 限定にしたが、char-sheets HTML が実際は流した日でも DECISION マーカーを保持し続けるケース (固定が source page を手動更新しない) で未開催日が past に紛れ込んでいた。\n\n修正: `mergeStoredPastSessions` を再設計。過去 (date < cutoff) は **Discord 取り込み / snapshot 由来行のみ authoritative** とする。char-sheets と stored で rawDate が一致したら DECISION 扱いで残す (出欠記号は char-sheets 側を維持) が、char-sheets のみで stored に無い過去行は破棄する。未来 (upcoming) は char-sheets をそのまま採用。これで「Discord に通知が無い = 実開催されていない」を強い signal として past から除外できる。\n\n**FFLogs HTML scraper の UA を実 Chrome 風に変更**: ユーザー画面で `fflogs HTML scrape 403 (page 1)` が出ていた。旧 UA は `Mozilla/5.0 (compatible; RaidRepository/1.0; ...)` で Cloudflare bot 判定に弾かれていたため、実 Chrome 124 の UA + Sec-Fetch-* / Sec-Ch-Ua-* / Referer / Accept-Encoding 等のブラウザ標準ヘッダー一式を付与して自然なナビゲーション風に偽装。これで cookie 認証が通れば Private/Unlisted の最近のレポートも取得可能になる見込み。\n\n**注**: それでも 403 が続く場合は Vercel IP 帯が完全に block されている可能性が高く、その場合は (a) スケジュール上の日付ポップオーバーから手動 URL 貼り付け、(b) FFLogs 側で対象レポートを Public に変更、のどちらかで個別対応してください。",
      },
      {
        title: "🎯 TODO #24 さらに修正: ◯ fallback を撤去して DECISION 限定に",
        body: "ユーザー報告: 「4/27(月)・4/28(火) が過去日程に出るが実際は開催していない、Discord 側にも該当メッセージがない」。\n\n原因: 直前 commit で「◯ 出席が 1 名以上なら過去に表示」という fallback シグナルを入れていたが、character-sheets の ◯ は『参加可投票』であって実際の出席記録ではない (legend: ◯=参加可, ⏰=遅刻, △=要相談, ×=不可, －=未回答)。流れた候補日でもメンバーが事前に「参加可」を入れていれば ◯ が残るため、未開催日が past に紛れ込んでしまっていた。\n\n修正: `schedule-list.tsx` / `schedule-past-simple.tsx` の過去フィルタを `status === \"DECISION\"` のみに戻す。aged out で character-sheets が DECISION を落としても、`mergeStoredPastSessions` が Discord 取り込み / snapshot 由来行を DECISION 扱いで補完するので「実開催だが char-sheets に残っていない」過去日も拾える設計。",
      },
      {
        title: "🧹 TODO #24 続報: Discord 取り込みの過去表示 + 未来日時クリーンアップ",
        body: "ユーザー報告: 「Discord から取り込んだ日時が過去日程に表示されていない、開催日時ではない 27/28 日が表示される、DB に未来日時が残っている」。\n\n原因:\n1. `next-session.ts:138` で Discord 取り込み行を一律 `CANDIDATE` 扱いにしていたため、attendances が空の Discord 由来エントリは新フィルタ「DECISION または ◯ 1 名以上」を全部弾いていた。\n2. `discord-schedule.ts` が未来日時の本日メッセージ (bot が翌日通知を先行投稿したケース等) を無条件で `schedule_past_sessions` に insert しており、後日 past 化すると「実際は開催されていない日」がノイズとして表示されていた。\n\n修正:\n- **Discord 取り込み = DECISION 扱い**: `mergeStoredPastSessions` の status を CANDIDATE → DECISION に変更。Discord 通知は「announce された開催確定セッション」なので DECISION 扱いが正しい。`pickNextDecision` は past を弾くため次回確定の誤選択にはならない。\n- **未来日時行を merge 時にスキップ**: 万一 DB に未来 parsed_date が残っていても、表示時にもう一度ガードして past リストに混ざらないように。\n- **importer が未来日時を insert しない**: `importDiscordScheduleHistory` で `dt > now` を skip し、結果に `skippedFuture` を返す。\n- **既存未来行を import 時に自動クリーンアップ**: `schedule_past_sessions` の `parsed_date > now` 行を import の冒頭で DELETE。`cleanedFuture` 件数を結果に返す。\n- **設定ダイアログ表示も拡張**: import 結果パネルに「未来日時 skip / cleanup」件数を表示。",
      },
      {
        title: "🩹 TODO #24/#30 のフォローアップ修正",
        body: "前 commit のリグレッションをまとめて修正:\n\n**TODO #24 — 過去日程フィルタ過剰除外の修正**: ユーザー報告「過去の開催日程が表示されなくなった」。原因は character-sheets 側の HTML が aged out 行の `dateStatus` 属性を空にする仕様で、parser がそれを CANDIDATE にバケットしてしまうため、`status === \"DECISION\"` 限定のフィルタだと実際に開催された過去日まで全部消えていた。\n\n修正: 過去側フィルタを「`status === \"DECISION\"` または ◯ 出席が 1 名以上ある」に緩める。これで character-sheets が status を落とした古い行も、出席者がいる = 実際に開催された判定で履歴に残せる。完全な無人 CANDIDATE (= 流れた候補日) のみが除外される本来の趣旨どおりに。\n\n**TODO #30 — Stormblood の hue を ember 寄りに振り直し**: ユーザー報告「赤色が出欠の × と被るので分かりやすい色に」。前 commit は chroma を下げただけで hue 22 (≈ rose-red) のまま、Tailwind `rose-400` (hue ≈ 0) の × マーカーと色相が近接していた。\n\n修正: `.dark.theme-stormblood` の hue を `22 → 38-40` (deep ember / 燃え尽き残光) に振り、accent も `45 → 60` (amber 寄り) に。primary lightness は `0.6 → 0.66` に微増させてカード内の text/icon 視認性も向上。深紅 identity は「ember (残火) の暖色赤」として継承しつつ、出欠 × (rose) と明確に区別できる。",
      },
      {
        title: "📝 /category 説明文更新 + ダイアログヘッダー更新 + ロールセクション折りたたみ + 動画追加 UI 撤去",
        body: "ユーザー要望をまとめて反映:\n\n1. ``/category`` 上部の Contents 見出し下の説明文を「軽減・ロット・攻略情報・動画などを切り替えます。」に更新 (動画タブの追加に合わせ)。\n2. CategoryFormDialog の編集モード時の DialogDescription を「コンテンツの情報・URL・ロール制限・クリア記録などを編集」に更新 (フィールド増加に合わせ)。\n3. 「閲覧可能ロール」セクションを ``<details>`` で折りたたみ化、初期状態は閉じる。選択中ロールがあれば summary に「N 選択中」バッジ表示で『設定中』のヒントを残す。\n4. 直前の commit で実装した「カード編集ダイアログから動画追加」UI (URL + タイトル + 「+動画追加」ボタン) はユーザー本来の意図と異なっていたため撤去。state / handler / `Film` icon import / `createCategoryLink` import すべて削除。",
      },
      {
        title: "🧩 TODO #25-27 実装 (説明文 / 手動クリア時間 / 動画追加) + #28 padding で右端揃え + 累計時間 lowercase",
        body: "ユーザー要望に基づきカード編集ダイアログ拡張 + 微調整:\n\n**TODO #25 — 手動クリア時間入力**: `categories.manual_time_to_clear_seconds` 列追加。CategoryFormDialog に「時間/分」の 2 入力欄を追加。card 表示は `manualTimeToClearSeconds ?? computedValue` の優先度。手動値が設定されているとき tooltip に「(手動入力)」表示。YouTube duration が NULL のままで自動計算が低めに出る場合の補完用途。\n\n**TODO #26 — コンテンツ説明文**: `categories.description` 列追加。CategoryFormDialog に textarea (2 行) 追加。`/category/[slug]/layout.tsx` のヘッダー直下に `whitespace-pre-line` で表示 (空欄なら非表示)。\n\n**TODO #27 — カード編集から動画追加**: 編集ダイアログ末尾に「動画追加」セクションを追加。URL + タイトル (空欄時は URL から自動生成) を入力 → 「+動画追加」ボタンで `createCategoryLink` を即時呼び出し。複数追加可、追加後は input がクリアされる。YouTube は内部で duration / uploadDate を自動取得。\n\n**TODO #28 — Status 右端揃え**: 大きなレイアウト変更を避けて、`SubPageShortcuts` の右パディングを `px-3` → `pl-3 pr-2` (= 右カラム `p-2` と同値) に変更。これで Status (icon 行右端) と Trophy/Hourglass (右カラム右端) が同じ右オフセット (= card 右端から 0.5rem) で揃う。\n\n**累計時間バッジの圧縮見え修正**: Hourglass バッジの `uppercase` を撤去。`21h5m` → `21H5M` の uppercase で H/M アルファベットが圧縮されて見える問題を解消、lowercase 維持で読みやすく。\n\n**注**: schema 変更を含むため Supabase の SQL Editor で `supabase/schema.sql` を再実行してください。`categories` に `description text` と `manual_time_to_clear_seconds integer` 列が追加されます。",
      },
      {
        title: "🧹 カード layout 再調整 (Status を icon 行に / Trophy + Hourglass のみ右上) + メンテを単独ボタンに",
        body: "前回の調整 (Status/Trophy/Hourglass を右上揃え) が想定外配置だったためユーザー要望に合わせ再構成:\n\n1. Status (クリア済バッジ) を `SubPageShortcuts` 行 (mitigation/loot/strategy/videos/macros アイコン行) の右端に移設。`SubPageShortcuts` に `statusSlot` props を追加し `ml-auto` で右寄せ。\n2. 中段の Timer (累計練習時間) はカード上から削除 (ユーザー要望「カード表示はクリアまでの累計時間のみで良い」)。データ load (`practiceSecondsByCategory`) は将来の tooltip 等のため残置。\n3. 右カラム上段は Trophy + Hourglass のみ (placeholder で高さ固定)。\n4. メンテメニューを単独ボタンに簡素化 (DropdownMenu wrapper 撤去)。`Cloud / Timer / Stethoscope / DropdownMenu*` import / `diagnoseYoutube` action / `DiagnosePanel` を削除。診断ツールは YouTube API key 設定で限定公開動画も取れる見込みのため不要と判断。\n5. AllPanel の YouTube fail バナーを「全件 fail (= Vercel bot 弾き)」と「部分 fail (= unlisted 動画混在)」で表示分岐。両方とも `YOUTUBE_API_KEY` 設定で改善することを案内。\n6. `.env.local.example` の `YOUTUBE_API_KEY` コメントを「サーバー側 1 回のみ admin 設定で全動画カバー、各メンバー設定不要」と明記。private 動画は不可な点も追記。",
      },
      {
        title: "🧰 メンテ 1 ボタン化 + クリア累計時間/Trophy を上揃え + カードサイズ固定 + Trophy 遷移スクロール修正",
        body: "ユーザー要望 5 件を一括対応:\n\n1. **メンテメニュー 1 ボタン化**: 個別の Discord 取込/動画メタ/クリア再計算/force refresh 項目を撤去し「最新情報を取り込んで再計算」(① Discord 取込 → ② 動画情報 → ③ クリア再計算) の単一項目に集約。`YouTube 取得テスト` だけ診断用に残置。トリガラベルに「更新 ② 動画情報 5/281 (1.8%)」のような % 進捗表示。\n2. **タイトル日付 fallback で posted_at 復旧**: Vercel IP の bot 検出で YouTube が 0 件しか取れない問題に対応。`categories-actions.ts` の `resolvePostedAt(title, meta, existing)` ヘルパーで タイトル日付 (`titleDateToIso`) → YouTube uploadDate → 既存維持 の優先度で解決。タイトルに『【2024 08 22】』等の日付があれば YouTube 失敗時もクリア紐付けが復旧する。SELECT に `title` を追加。\n3. **Status / Trophy / Hourglass を上揃え**: `category-list.tsx` の中段から Hourglass を撤去し、右カラムに Status / Trophy / Hourglass / +N/wk+⋮ の 4 段縦積みで配置。すべて `items-end` で右端揃え。\n4. **カードサイズ固定**: Trophy / Hourglass / +N/wk が無いカードでも `invisible` placeholder 行を入れてカード高を一定に。\n5. **Trophy → 動画スクロール復旧**: Next.js 16 の遷移 auto-scroll-to-top が `scrollIntoView` を上書きしていた問題に対応。`router.push(url, { scroll: false })` を指定 + `videos-list.tsx` の delay を 50ms → 300ms + `requestAnimationFrame` 2 段で安定化。",
      },
      {
        title: "🛠 メンテに「全部実行」追加 + Trophy バッジを Status と同列に移設",
        body: "ユーザー要望:\n1. メンテナンスメニューの 3 つの主要操作 (Discord 取り込み / 動画メタデータ / クリア再計算) を 1 ボタンで一括実行したい。\n2. カードのクリア日 (Trophy) ボタン → クリア日動画への遷移が壊れている。\n3. クリア日 (Trophy) は Status (クリア済バッジ) と右端を揃えた位置に移動したい。\n4. YouTube から duration / uploadDate が取れず、累計クリア時間が計算できていない疑い。\n\n対応:\n1. メンテに「全部実行」項目を追加 — `Discord 取り込み → 動画メタデータ (force=false) → クリア日時/時間再計算 (force=true)` を順次実行し、各サブ結果を 1 パネルに積み上げ表示。トリガラベルが「全部 ① 取り込み中…」「全部 ② 動画時間 X/Y」「全部 ③ クリア再計算…」と進行表示に切替。共通ロジックは `runVideoMetaPhase` ヘルパーに抽出。\n2. Trophy ボタンを `category-list.tsx` の中段 `<Link>` 内ネストから右カラム (Status と同列) へ移設。Next.js 16 ルーターの `<Link>` 内ネストボタン挙動が回避されるため、ナビゲーション regression が解消。`e.preventDefault()` も不要になった (`e.stopPropagation()` のみ残置)。\n3. 右カラム inner div を `items-start` → `items-end` に変更し、Status / Trophy / +N/wk+⋮ の 3 段すべてを右端揃え。\n4. 「全部実行」結果パネルで YouTube が 0 件しか取得できなかった場合、Vercel 側 bot 検出 / consent / sign-in ウォールの可能性に言及するヒントバナーを表示し、`YouTube 取得テスト` への誘導を出す。\n\n注: クリア累計時間が計算されない問題自体は、duration_seconds が NULL のままの動画が多いことが直接原因と推定される。本 PR では原因切り分けの導線を整えただけ。診断結果次第では YouTube Data API キー導入や Discord embed metadata 利用の代替経路を検討。",
      },
      {
        title: "🩹 posted_at の取得元を YouTube uploadDate 優先に反転 (TODO #22 追加対応)",
        body: "ユーザー指摘: タイトルに日付が無い動画でも、`posted_at` が Discord メッセージ時刻でセットされていれば紐付きはするが、古い動画 (例: 2023 年録画) を 2026 年に Discord に貼った場合 posted_at = 2026 になり、結局 2026 年の直近セッションに誤紐付けする穴が残る。\n\n対応: 旧設計の「Discord 時刻が真、YouTube uploadDate は NULL のときだけ補完」を反転し、**YouTube uploadDate が取得できれば常に上書き** に変更。\n\n変更箇所:\n1. `enrichVideoLinkDuration` (link form 経由の手動追加): `is(\"posted_at\", null)` ガードを撤去、常に上書き。\n2. `backfillVideoDurations` / `backfillVideoDurationsChunk` (バルクメンテナンス): in-loop の `needsPostedAt` 判定から `row.posted_at === null` を撤去。\n3. メンテナンスメニューに「投稿日時を YouTube から再取得 (全動画)」項目を追加。`backfillVideoDurationsChunk({ forceRefresh: true })` を呼び、SQL の `posted_at IS NULL` フィルタを外して全 video 行を再スキャン。Discord 時刻で既に埋まっている誤値も YouTube uploadDate で全件修正できる。\n4. force refresh モード時は後段の `backfillPostedAtFromDiscordChannels` を呼ばない (Discord 時刻フォールバックが趣旨に反するため)。通常モードでは「YouTube 失敗行を Discord 時刻で埋める」フォールバックとして引き続き動作。\n\nこれで Discord に古い動画リンクを貼っても、YouTube が真の uploadDate を返す限りスケジュール紐付けが正しく動く。タイトル日付なし & YouTube 取得失敗 & posted_at NULL の動画はこれまで通りスキップ (`session-video-link.ts`)。",
      },
      {
        title: "🎯 スケジュール↔動画の紐付けをタイトル日付ベースに (TODO #22)",
        body: "ユーザー報告: 古い動画 (例: 2023 年録画) を後から DB に追加すると、`posted_at` (= 追加投稿時刻) ベースの ±36h ウィンドウが、無関係な直近セッションを掴んで誤紐付けしていた。\n\n修正: `src/lib/server/session-video-link.ts` のマッチ方式を「動画日付 == セッション JST 同日」に変更。日付の解決優先度:\n1. `extractDateFromTitle(title)` — タイトル内に書かれた raid date (「【2026/04/01】」「2026 04 01」「4月1日」「20260401」「【0401】」等) を最優先。ユーザーが手で打つので最も信頼できる。\n2. `posted_at` の JST 日付 — タイトル日付が抜けている動画でも、YouTube/Discord 取得済みの実投稿日が当日 or 翌日朝のことが多いので fallback として許容 (ユーザー追記要望)。\n3. 上記いずれも取れない動画は **スキップ** (`created_at` は単なる DB 行作成時刻なので使わない)。\n\n副次効果:\n- 過去動画の詳細表 / 簡易チップで、何年も前にアップした動画が直近セッションのアイコンに化けて出る現象が消える。\n- ±36h ウィンドウが消えたので、本当に当日 22:00 開始 → 当日中アップロードのケースだけが紐付き、夜跨ぎで翌朝アップした動画は (タイトルに前日日付が書いてあれば) 前日セッションへ正しく付く。\n- 同日複数試合に複数動画がある場合は `posted_at asc` 順で early bird が勝つ仕様 (used-set で取り合いを防止)。",
      },
      {
        title: "🔧 2 ヶ月畳みのスクロール挙動を再修正 (視点保存方式へ)",
        body: "ユーザー報告 (PR #8 リリース後): 「2 ヶ月以上前を表示」ボタン押下時、画面が下方向に大きく動き、最古の日程まで飛んでしまう (例: 2/28 で押すと 2/9 まで移動)。\n\n原因: PR #8 では「ボタンの rect.top を固定」する scrollBy 補正にしていたが、展開時はボタンが下方へ移動するため、その差分だけページが下スクロール = ユーザの見ていた行が画面外に追い出されていた。\n\n再修正: トグル時に `window.scrollY` (= ユーザの絶対視点) を控え、状態更新後 (rAF 2 段) に同じ scrollY へ復元する方式に変更。これで展開しても畳んでも、ユーザが見ていた絶対位置はそのまま。展開行 (olderPast) は画面外下方に挿入されるので、ユーザはスクロールダウンで読みに行く。\n\nまた、押下後にボタンへフォーカスが残ると一部ブラウザが auto-scroll で介入してくるため、明示的に `.blur()` してから scrollY 復元することで競合も抑止。",
      },
      {
        title: "🔁 2 ヶ月畳みボタン押下時のスクロール固定 + サインアウトを設定ダイアログ内に移設",
        body: "ユーザー報告 + 要望: (1) 「2 ヶ月以上前を表示」ボタン押下時、展開された行が大量に挿入されてボタンが画面外 (下方) に流されてしまい、その後の操作 (例: 畳む) に再スクロールが必要だった。(2) サインアウトボタンは頻度が低いのでヘッダーに常駐するほどではなく、設定ダイアログの中に入れたい。\n\n修正:\n1. `schedule-list.tsx`: トグル前にボタンの `getBoundingClientRect().top` を控え、状態更新後 (rAF 2 段) で再取得し差分を `window.scrollBy({ behavior: 'instant' })` で当てる。展開時 = 上に行が積まれてもボタンの画面 Y 位置は不変、畳み時 = 上の行が消えてもボタンの画面 Y 位置は不変、というアンカー挙動。\n2. `settings-dialog.tsx` のフッター (Changelog / Source / Lodestone と同じ行) に `<form action='/auth/sign-out'>` のサインアウトボタンを追加。誤クリック防止の confirm を `onSubmit` で挟む。色は rose 系で「破壊的操作」感を出す。\n3. `site-header.tsx` から `<SignOutButton />` を撤去。`sign-out-button.tsx` ファイル自体も削除 (PR #6 で追加したばかりだが、本 PR で吸収)。",
      },
      {
        title: "📚 過去日程の詳細ログで 2 ヶ月以上前を畳む",
        body: "ユーザー要望: 過去詳細ログ (出欠表) は年月が経つほど縦に長くなるが、普段は最近の数試合分しか参照しないので、2 ヶ月以上前はデフォルト非表示にしてほしい。\n\n実装:\n1. `schedule-list.tsx` で `renderedPast` を `recentPast` (≤ 60 日) と `olderPast` (> 60 日) に split。閾値は `60 * 24 * 60 * 60 * 1000 ms` = 約 2 ヶ月。\n2. `recentPast` は常時テーブルに描画。`olderPast` は state `showOlderPast` (default false) で展開を制御。\n3. テーブル末尾に「2 ヶ月以上前を表示 (N 件)」ボタンを追加 (toggleable)。展開後は「畳む」表示に切り替え + ChevronUp / ChevronDown でアフォーダンス。\n4. ヘッダーの件数表示は `直近 X 件 / 全 Y 件` (畳まれた状態) と `Y 件` (展開状態) で切替。\n\n2 ヶ月以下の過去ログだけのときはボタンも出ない (= 全件表示で従来 UX)。",
      },
      {
        title: "🔁 カテゴリ編集後の UI 即時反映 + サインアウト確認ダイアログ",
        body: "ユーザー報告 (PR #5 リリース後): (1) 編集ダイアログで保存しても、ロール制限の追加/解除が UI に即時反映されず F5 (page reload) しないと変化が見えない、(2) サインアウトボタンが誤タップで一発サインアウトしてしまう。\n\n修正:\n1. `categories-actions.ts` の Server Action 群すべてで `revalidatePath('/category')` + `revalidatePath('/')` を呼ぶ helper を追加。Server Action 経由になって以降 Realtime に頼り切れていなかった部分を明示的に invalidate。\n2. `category-form-dialog.tsx` の保存成功時、および `category-list.tsx` の `onChangeStatus` 後に `router.refresh()` を呼んで RSC を再実行。Realtime + revalidate + router.refresh の三重で UI 即時反映を担保。\n3. SiteHeader のサインアウトボタンを client component (`sign-out-button.tsx`) に切り出し、`onSubmit` で `window.confirm('サインアウトしますか?')` を挟む。OK で /auth/sign-out POST、Cancel で何も起こらない。JS 無し環境でも form action は機能する progressive enhancement。",
      },
      {
        title: "👑 admin ロール持ちのみカテゴリ編集可に (TODO #21)",
        body: "現状は guild メンバー全員がカテゴリの編集 (作成/更新/削除/並び替え/ステータス変更) と Discord 取り込み等の保守操作を実行できてしまっており、ロール制限を付けたカードを誰でも解除可能だった。env `DISCORD_ADMIN_ROLE_IDS` (カンマ区切り role ID) を導入し、その指定ロールいずれか 1 つを持つメンバーのみが編集可能な状態にした。\n\n実装:\n1. `DISCORD_ADMIN_ROLE_IDS` env を `.env.local.example` に追加。空 / 未設定 = 全員 admin (後方互換)、設定後はそのロール持ちのみ admin。\n2. `src/lib/server/auth.ts` に `getAdminRoleIds()` / `userIsAdmin(roles)` / `getCurrentUserCanEdit()` / `requireAdmin()` / `assertAdminResult()` を追加。Server Action 用は `assertAdminResult()` (リダイレクトせず `{ok: false, reason: 'not_admin'}` を返す)。\n3. 旧来 anon key で直接 supabase に書いていた `categories-client.ts` の write 関数群を、Server Action (`createCategoryAction` / `updateCategoryAction` / `deleteCategoryAction` / `setCategoryOrderAction` / `updateCategoryStatusAction`) 経由に切り替え。各 Action で `assertAdminResult()` を呼んで gate。`maybeSetFirstClearAt` だけは「クリア動画追加で誰でもクリア日記録できる」性質のため admin 不要。\n4. `/category` index で `userIsAdmin(roles)` を計算し、非 admin には「+コンテンツ追加」「MaintenanceMenu」「DnD ハンドル」「⋮ メニュー」を非表示。`StatusBadge` も `readOnly` モードに切り替え。\n5. `/auth/denied?reason=not_admin` の UX を「管理者ロール付与を依頼」+「スケジュールへ戻る」/「別アカでログイン」に。\n\n注意点 (限界):\n- Supabase RLS は依然 anon フル open のままなので、決定的な攻撃者は REST API を直接叩いて bypass できる。本気の防御が必要なら別 PR で RLS を `auth.uid() の admin role 判定` に締めること。\n- 今回 admin gate されないもの: スケジュール page の各種 (settings dialog 内の URL 設定 / FFLogs OAuth / 募集テンプレート編集等)。これらも admin 限定にするかは別判断 (ユーザーごとの memo 等は逆に全員 OK にすべき)。",
      },
    ],
  },
  {
    version: "2.0",
    date: "2026-04-29",
    parts: [
      {
        title: "🔓 ロール制限カテゴリの「戻せない」問題を解消 + 拒否ページの折返し修正",
        body: "ユーザー報告 (PR #3 リリース後): (1) 自分が持っていないロールを設定して保存すると、そのカードが /category 一覧から消えて編集ダイアログに到達できなくなる「詰み」状態 (= ロール制限を後で undo できない)、(2) /auth/denied の「メンバー限定です。」が幅 max-w-md で 2 行折返しになり「です。」だけが孤立して見栄えが悪い。\n\n修正:\n1. /category index ページは「管理ビュー」と位置付け、ロール制限の有無に関わらず**全カテゴリを表示**する方針に変更 (page.tsx で `filterVisibleCategories` 呼び出しを撤去)。MainTabs ドロップダウン / カテゴリ subpage 直アクセスはこれまで通りロールで gate。\n2. category-list.tsx で自分が見えないカードに **🔒 + 制限ロール ID 数バッジ**を表示し、`opacity-70 + ring-amber-400/30` で視覚的にロック中を示す。クリックすれば /auth/denied に飛ぶが、編集メニュー (⋮ → 編集) は常時アクセス可能なので必ず undo できる。\n3. denied ページの 1 行目の文末「です」を取り、「このコンテンツは特定の Discord ロールを持つメンバー限定。」と言い切り型に変更。max-w-md の 2 行折返しでも見映えが崩れない。\n\n既知の限界 (TODO #21 として記録): カテゴリ編集自体は誰でもできるため、ゲストでもダイアログから `required_role_ids` を空にして閲覧可能化できる = 現状のロール制御は「視認性によるソフト制限」止まり。本格運用には DISCORD_ADMIN_ROLE_IDS env と admin 限定の編集ガードが必要。",
      },
    ],
  },
  {
    version: "2.0",
    date: "2026-04-28",
    parts: [
      {
        title: "🛡️ ロール単位のページ閲覧制御 (TODO #19)",
        body: "Discord サーバー内の権限階層 (本垢 / サブ垢 / ゲスト等) に合わせて、コンテンツカード単位で「特定ロール持ちのみ閲覧可」を設定できるようにした。\n\n実装:\n1. `categories.required_role_ids text[]` カラムを追加 (空 / NULL = 全メンバー閲覧可、非空 = 指定ロールのいずれか 1 つ持っていれば閲覧可)。`Category.requiredRoleIds: string[]` を types に追加。\n2. `src/lib/server/discord-roles.ts` で bot token を使い `GET /guilds/{id}/roles` を取得 (React.cache で同一リクエスト内シェア)。Server Action `fetchAvailableGuildRoles()` から CategoryFormDialog に流す。\n3. `CategoryFormDialog` に「閲覧可能ロール」セクションを追加。チェックボックス UI でロールを選択 + Discord のロール色を `<span>` でプレビュー、managed (bot) ロールは badge で示す。空選択でクリアボタン。\n4. `src/lib/category-visibility.ts` に `filterVisibleCategories(cats, userRoleIds)` ヘルパー。MainTabs / CategorySwitcher (realtime 後) / category index / 募集ポップオーバー / Ultimate clear 集計の全ヶ所で適用。\n5. defense-in-depth: `/category/[slug]/layout.tsx` で `requireDiscordRoles(category.requiredRoleIds)` を呼び、URL 直アクセスでもガード。`requiredRoleIds = []` のときはスルー。\n6. `/auth/denied?reason=missing_role` のメッセージを「ロール付与を管理者に依頼」「別アカでログイン」「スケジュールへ戻る」へ条件分岐。\n7. `supabase/schema.sql` 再適用が必要。",
      },
      {
        title: "🔐 サイト全体を Discord メンバー限定に (PR #1)",
        body: "URL を知っている人なら誰でも見られた状態を解消し、Discord 指定 guild のメンバーのみがログインできるアクセスゲートを追加。\n\n実装:\n1. Next.js 16 の `proxy.ts` (旧 `middleware.ts` 名) でサイト全体のリクエストをゲート。Supabase Discord OAuth でログイン → `/auth/callback` で bot token を使い対象 guild の membership + roles を取得 → service-role で `auth.users.app_metadata` (`discord_guild_member`, `discord_roles`) に書き込み → JWT を refresh、というフロー。proxy 自体は cookie 内 JWT の `app_metadata` を見るだけなので毎リクエストで Discord API は叩かない。\n2. 公開ルート (proxy で素通し): `/login`, `/auth/{callback,denied,sign-out}`, `/api/cron/*`, `/api/health`。それ以外 (`/api/*` 含む) は全部ゲート対象。\n3. SiteHeader にサインアウトアイコン追加。`requireDiscordMember()` / `requireDiscordRoles()` ヘルパー (`src/lib/server/auth.ts`) を Server Action / Route Handler 用 defense-in-depth として併設。\n4. 必要 env: `SUPABASE_SERVICE_ROLE_KEY`, `DISCORD_GUILD_ID`, `DISCORD_BOT_TOKEN` (+ Supabase の Discord プロバイダ有効化、Discord Developer Portal で Redirects に Supabase callback 登録、Supabase Authentication の Site URL / Redirect URLs を本番 + ローカル両方に設定)。詳細は `.env.local.example`。",
      },
    ],
  },
  {
    version: "1.9",
    date: "2026-04-28",
    parts: [
      {
        title: "📤 コンテンツカード背景画像にローカルアップロードを追加 + 文字埋もれ修正",
        body: "ユーザー報告: (1) 既存環境で「保存失敗: Could not find the 'background_image_url' column of 'categories' in the schema cache」 — schema.sql 未適用で起こる症状、Dashboard SQL Editor で `ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS background_image_url text;` + `NOTIFY pgrst, 'reload schema';` を実行すれば解消。(2) 背景設定後、文字やアイコンが薄くなる。\n対応:\n1. `category-form-dialog.tsx` に「アップロード」ボタンを追加。Supabase Storage `category-backgrounds` バケット (public, 5MB 上限, 画像 MIME 限定) に直接 upload → public URL を取得して `backgroundImageUrl` state に流し込む。URL 直入力との併用可。クリアボタンも併設。\n2. `schema.sql` に `category-backgrounds` バケットと anon 用 RLS policy (read/insert/update/delete 全部 bucket_id 縛り) を追加。冪等。\n3. `category-list.tsx` の Card 内コンテンツ (drag handle / 中央列 / 右列) すべてに `relative z-10` を付与。これまで absolute な image / gradient overlay が paint order で content の上に来てしまい、`from-background/55 via-background/30 to-background/55` gradient が文字を半透明に覆っていた。z-index で content を上層に持ち上げて根治。",
      },
      {
        title: "🖼️ コンテンツカードに背景画像を設定可能にする (TODO #17)",
        body: "コンテンツ一覧 (/category) の各カードにカテゴリ別の背景画像を設定できるようにした。コンテンツ編集ダイアログに「背景画像URL」フィールドを追加し、http(s) URL を入力するとカード背景に `bg-cover bg-center` で表示される。\n実装:\n1. `categories.background_image_url text` カラムを追加 (idempotent migration)。`Category.backgroundImageUrl: string | null` を types に追加。\n2. `CategoryFormDialog` に URL 入力欄 + 入力中の小プレビュー (h-20) を追加。`validateUrl` で http(s) のみ許可、create 時は followUp update で適用。\n3. `category-list.tsx` の Card 内に `pointer-events-none absolute inset-0 bg-cover bg-center opacity-40` の image layer + `bg-gradient-to-r from-background/55 via-background/30 to-background/55` の dark gradient overlay を挿入し、テキスト・チップの可読性を確保。`isSafeUrl` で `javascript:` / `data:` URL を弾く。\n4. 空欄でリセット可能 (NULL → 背景画像なしに戻る)。supabase schema.sql の再適用が必要。",
      },
      {
        title: "🚚 募集文テンプレの DnD をカテゴリブロック単位の sortable に再設計 (TODO #16)",
        body: "前回 (3bc7a32) は drop 時に内部でブロック並び替えを再計算する方式だったが、ユーザー指摘の通り「DnD 中に元カテゴリ section が追従しない (drop の後に付いてくる)」UX 上の問題があった。SortableContext を child template 単位 → カテゴリブロック (group key) 単位に再設計し、各 section 自体が `useSortable` する形に変更。\n実装:\n1. SortableContext.items を group key 配列 (`categoryId ?? '__none__'`) に変更。\n2. 新コンポーネント `SortableCategorySection` でカテゴリブロックを丸ごと sortable 単位として扱う。section ヘッダー左に grip ハンドルを追加。\n3. 子募集文 (`TemplateRow`) の grip も親 section の `useSortable` listeners を prop drilling して接続。子の grip を掴んでも親 section ごとドラッグされる → 中の複数募集文が全部一緒に追従。\n4. `onDragEnd`: arrayMove(grouped, oldIndex, newIndex) → flatMap で template id 列にしてから `setRecruitmentTemplateOrder` に渡す。category_id は変更しない。\n5. popover 内では intra-category 並び替えは行わない (per-category マクロページに譲る) — popover はカテゴリ全体のグローバル順序の調整に専念。",
      },
      {
        title: "🎬 過去日程の動画アイコンを直接外部リンクへ (詳細表 + 簡易チップ両方、Logs と同じ挙動)",
        body: "出欠表 (Past) の Film アイコンは従来ポータル内の動画ページ (`/category/{slug}/videos?focus=...`) に飛んでいたが、ユーザー要望で過去日程に限り外部の動画 URL (YouTube / Twitch / niconico / X 等) を直接新規タブで開く挙動に変更 — Logs アイコンと同じ感覚で扱える。\n適用先: (a) `schedule-list.tsx` 詳細テーブル (Past) の Film slot、(b) `schedule-past-simple.tsx` 簡易チップの Film アイコン。簡易チップ側は表示時点で過去日程のみ抽出済みなので無条件で外部リンクに切替、詳細表側は `isPast=true` のときのみ切替して upcoming は引き続きポータル動画ページへ。\n実装: `SessionVideoLink` に `url: string` フィールドを追加し、`buildSessionVideoLinkMap` の SELECT に `category_links.url` を追加して伝播。両ファイルで `<a href={safeHref(videoLink.url)} target=\"_blank\">` を採用、`safeHref` が http(s) 以外を弾くので不正 URL 無効。`url` が空の古いデータに備えて従来 `<Link href={videoLink.href}>` への fallback も保持。",
      },
      {
        title: "🔔 各人のコメントに更新があった場合、ヘッダーの吹き出しアイコンを amber でハイライト (TODO #14)",
        body: "スケジュール取り込み時、各ユーザーのコメント (一言) が前回見たときから変わっていれば、ヘッダー名の右にある吹き出しアイコンの枠 / 背景を amber 化し、右上に小さな amber ドットを表示。クリック (popover を開く操作) で「確認済み」とみなし highlight を解除する。確認しない限り継続表示。\n判定は `timestamp + body` の連結 fingerprint を `localStorage` に user.userId 別に保存して比較。初回表示 (stored が null) はノイズ抑制のため silent baseline として現値だけ保存し、その後の変化のみ highlight する。localStorage 不可環境 (private mode 等) では何もしない。",
      },
      {
        title: "↩️ 動画ページの theater mode (ポップアップ拡大) を撤去 — シンプルなカード内 inline 再生に戻す",
        body: "theater mode 化 (fixed overlay でポップアップ拡大) は数回の修正を経ても再生中マウスホバーで再生不能になる挙動が解消できなかったため断念し、旧来のシンプルなカード内 inline 再生に戻した。autoplay=1 は維持してクリック 1 回で再生開始できる。`activeVideoId` を親 `VideosList` に lift する設計はそのまま残し、別カードで再生 → 前のカードの iframe が unmount = 動画停止 (1 ページ 1 アクティブ) は維持。lazy thumbnail (`IntersectionObserver`) も維持。今後フルスクリーン化はユーザーが YouTube プレーヤーの右下ボタンで対応する想定。",
      },
      {
        title: "🎬 ポップアップ後 play 方式に変更 + 別動画を開くと前を自動 close",
        body: "ユーザー報告: (a) 再生開始時に動画の左上が拡大されたよう (前回の aspect-ratio 修正でも改善せず)、(b) 別の動画を開いたら前のは閉じてほしい。\n(1) **autoplay=1 を撤回**: autoplay 中の YouTube プレーヤーは初期描画時に小さなビューポートでロードされ、その後拡大される過程で「左上だけクロップ拡大されたように見える」glitch を起こすことがある。ポップアップが完全に開いてからユーザーが YouTube の play ボタンを押す方式 (= autoplay 無し) にすれば、プレーヤーは正しい目標サイズで初期化される。\n(2) **activeVideoId を VideosList に lift**: 各 `YouTubePreview` の局所 `active` state を撤去し、親 `VideosList` で「いま再生中の動画 id」を 1 つだけ保持するよう再設計。`isActive` / `onActivate` / `onClose` 経由で各カードに伝播。新しいカードの play を押すと親の `activeVideoId` が更新 → 旧カードの `isActive=false` で iframe が unmount = 動画停止。理論上 1 ページ 1 アクティブのみ。\nなお iframe 内の YouTube プレーヤー UI (画面下部のコントロールバー / hover 時に出る各種オーバーレイ) は cross-origin 制約で portal 側からは隠せない。気になる場合は YouTube プレーヤー右下のフルスクリーンボタンで対応可。",
      },
      {
        title: "🎯 theater mode のアスペクト比崩れと背景透けを根治",
        body: "ユーザー報告: (a) マウスホバー時に横に黒いバーが何本も出る、(b) 再生開始時に動画の左上が拡大されたように見える。原因は theater mode 内側枠を `aspect-video w-[min(90vw,1400px)] max-h-[85vh]` で 3 制約 (w / max-h / aspect) を同時指定していたこと。狭高 viewport では max-h が支配して幅は 16:9 由来でなくなり、結果として iframe ボックスが 16:9 でない長方形となって中の YouTube プレーヤーが letterbox 風に左上クロップ表示されていた。さらに backdrop が `bg-black/85` (15% 透過) だったため、背景カードの hover translate animation が透けて「横の黒バー」に見えていた。\n修正: 内側枠を `style={{ width: 'min(90vw, calc(90vh * 16/9), 1400px)', aspectRatio: '16 / 9' }}` の 1 次元計算に統一 — 幅が w / h 両方の制約を同時に満たすよう min() で決まり、aspectRatio で高さを導出するので二重制約が発生しない。backdrop は `bg-black/95` で実質不透明に。`ring-1 ring-white/10` で枠も明示しポップアップ感を強化。preview 計測でアスペクト比 1.778 (= 16/9) を確認。",
      },
      {
        title: "🪟 theater mode を 3 件改善 (上部見切れ修正 + 自動サイズ調整 + ちらつき解消)",
        body: "ユーザー報告: (a) 上部の操作ボタンが見切れる、(b) ブラウザ幅で自動調整したい、(c) 再生後に画面がちらついて操作不能になる。\n(1) **上部見切れ修正**: 操作ボタン (YouTube リンク + × 閉じる) を `-top-10 right-0` (iframe の枠外上) → `top-2 right-2 z-10` (iframe 上にオーバーレイ) へ移動。viewport 上端で切れる問題が解消。\n(2) **ブラウザ幅で自動サイズ**: 内側枠を `max-w-6xl` 固定 → `w-[min(90vw,1400px)]` に変更。広い画面 (>1556px) では最大 1400px、狭い画面では viewport の 90% を採用。`max-h-[85vh]` で縦長 portrait viewport でもはみ出さない。`aspect-video` で 16:9 維持。グリッドのカード幅 (sm:cols-2 ≈ 640px) より少し大きい〜2x の theater 表示に。\n(3) **ちらつき解消**: 原因は `document.body.style.overflow = 'hidden'` でスクロールバー幅 (~15px) が出入りし viewport 幅が瞬間変化 → カード grid 全体が再レイアウトされていたこと。background scroll の抑止を撤回し、ESC リスナーのみ残す。`backdrop-blur-sm` も重い repaint を誘発するため削除。`bg-black/85` だけのシンプルな backdrop に。",
      },
      {
        title: "🎭 動画ページ内再生を theater mode で拡大表示 (sticky header に被らない)",
        body: "PC で動画をページ内再生したときに上部の固定 header / nav に被って小さく窮屈に見えていたため、再生時は viewport を覆う backdrop 上に iframe を最大表示する theater mode を採用。`fixed inset-0 z-50` の dialog 内に iframe を配置し、`max-w-6xl aspect-video` で 16:9 を維持しつつ大きく描画。本体カードには「再生中…」プレースホルダだけ残してレイアウトシフトを抑制。閉じる手段は (1) `Escape` キー (2) 背景 (backdrop) クリック (3) 右上 × ボタン の 3 系統。再生中は `document.body.style.overflow = 'hidden'` で背景スクロールを抑止。`aria-modal=\"true\"` + `role=\"dialog\"` を付与してアクセシビリティ確保。",
      },
      {
        title: "🩹 動画 embed エラー 153 を Zenn 記事準拠で再修正 + 強調表示の挙動統合",
        body: "(1) **YouTube エラー 153 の再修正**: 前回の `youtube-nocookie.com` 切替だけでは不十分で再生不能のままだったため、参考記事 ([zenn.dev/tsubo_tsubo](https://zenn.dev/tsubo_tsubo/articles/zenn-youtube-embed)) に従い iframe 属性を YouTube 公式 share コードと同等に揃える: `referrerPolicy=\"strict-origin-when-cross-origin\"` を明示 (前は `no-referrer` で Referer 完全ブロック → embed 許可判定で「未知のサイトから」扱いとなっていた)、`allow` に `web-share` を追加、`frameBorder=\"0\"` も付与。さらに `?origin=` パラメタは外して URL を YouTube share コード相当のシンプルな形に。\n(2) **強調表示の auto-off を URL 経由 focus にも統合**: コンテンツカードのクリア日時 (?focusDate=) リンクから飛んだ場合も Trophy ボタン経由と同じく「次の操作 (枠外クリック / スクロール) で枠強調を off」する挙動に変更。`focusActive` state を追加し、Trophy 由来 (`manualFocusId`) と URL 由来 (`focus` / `focusDate`) を区別せず一律 dismiss 対象に。1.5s ガード後の `window.scroll` / `document.click` (focused 要素外) で `setFocusActive(false)`。\n(3) **強調表示の pulse animation を削除**: `animate-[pulse_1.4s_ease-out_2]` を撤去し、`ring-2 ring-[var(--neon-cyan)]/60 ring-offset-2` のみで控えめに。ちらつきが嫌というユーザー指示。`transition-shadow` を付けて off 時のフェードを滑らかに。",
      },
      {
        title: "🎥 動画ページに 3 件追加改善 (embed 救済 + 余白クリック遷移 + 強調 auto-off)",
        body: "(1) **YouTube エラー 153 の救済**: `youtubeEmbedUrl` を `youtube.com/embed/` から `youtube-nocookie.com/embed/?rel=0&modestbranding=1&playsinline=1` に変更。`-nocookie` 系は uploader 側の embed 制限が緩い場合があり、エラー 153 (動画プレーヤーの設定エラー) で再生できなかった一部動画が直る可能性がある。それでも再生不能な動画 (uploader が embed 完全無効化) 向けに、iframe アクティブ時の右上に「YouTube で開く」フォールバックボタン (ExternalLink + 'YouTube' ラベル) を常時表示 — 押下で外部タブへ即逃げられる。\n(2) **カード余白クリック → 動画 URL を新規タブで開く**: `VideoCard` ルートに `onClick` を追加し、`closest('a, button, [data-card-no-nav]')` で interactive 要素上のクリックは bail out、それ以外 (説明文・枠余白など) では `window.open(videoHref, '_blank', 'noopener,noreferrer')`。`cursor-pointer` も付与してクリック可能であることを示唆。selectMode 中はカード全体が選択トグルなので無効化。\n(3) **クリア日時バッジ強調を auto-off**: TODO #10 で実装した「Trophy → ring 強調」は永続表示だったが、ユーザーが次の操作 (枠外クリック / スクロール) をしたら強調を解除する挙動に変更。1.5s 間 (smooth scroll の settle 余裕) は dismiss を armed=false でガードし、その後 `window.scroll` / `document.click` (focused 要素外) で `setManualFocusId(null)`。`?focus=` / `?focusDate=` URL params 経由の強調は永続表示のまま (戻る → 復帰時に強調が残ってほしい想定)。",
      },
      {
        title: "🎬 動画ページに 3 件改善 (TODO #10 anchor jump + カスタム逆順修正 + 通信量削減)",
        body: "(1) **TODO #10 完了**: ヘッダーの初クリア (Trophy) バッジを `<button>` 化し、クリックで該当動画へ smooth scroll + ring 強調。`findVideoIdByDate(YYYY-MM-DD)` ヘルパーを切り出して URL `?focusDate=` 経由フローと共通化。連打しても scroll が再発火するよう `manualFocusKey` カウンターを `useEffect` deps に追加。\n(2) **カスタム並び替えの逆順表示を修正**: DB の `sort_order` は ASC で挿入順 (古い順) のため、これまで「日付順 → カスタム」に切替えると先頭が逆になっていた。`useMemo` で custom mode 時は `[...live].reverse()` し、日付順と同じ「新しい順」を初期表示に。DnD onDragEnd は表示順を反転して `setCategoryLinkOrder` に渡し、DB 側 `sort_order` ASC 規約も維持。\n(3) **サムネイルを viewport 近接時のみロード**: `YouTubePreview` に `IntersectionObserver` (rootMargin 200px) を追加し、画面外のサムネイルは `<Image>` を描画せず gradient プレースホルダのみ表示。スマホで縦長スクロールする際の通信量を大幅削減。観察対象が viewport 200px 以内に入ったら 1 度だけ `<Image>` を mount してそれ以後は維持 (再 fetch は browser cache に任せる)。`IntersectionObserver` 非対応環境では即座に画像を描画する fallback も用意。",
      },
      {
        title: "🧹 Suspense streaming + skeleton を一旦撤去 (体感比較のため)",
        body: "ユーザー指示「いったんスケルトン待ち時間をなくしてみてほしい」。`SchedulePage` から `<Suspense>` ラッパーと `<ScheduleContent>` 中継を削除して旧来の同期 server-render に戻し、`SchedulePageSkeleton` コンポーネント自体も削除。skeleton → 実コンテンツの swap UX より「全部待つが一発で完成形が出る」体感の方が良いか比較する。Vercel Region を Tokyo (hnd1) に寄せた効果と合わせて評価予定。",
      },
      {
        title: "🌏 Vercel Function の Region を Tokyo (hnd1) に固定 (USA → JP) ",
        body: "`vercel.json` に `regions: [\"hnd1\"]` を追加。これまで Hobby tier のデフォルトである `iad1` (Washington DC) で Node Function が動作していた (Edge Runtime の `/` ページは無関係 — ユーザー最寄り POP で動作)。Supabase が Tokyo region のため、`/category/*` 系 (server component → デフォルト Node) と `/api/cron/*` `/api/auth/fflogs/*` `/api/page-title` は US ↔ JP の片道 ~150ms RTT がクエリ毎に発生していた。Tokyo Function に切替で 1 リクエスト内の DB 往復が ~10ms に短縮、cron 実行も Supabase 隣接で安定。FFLogs API (EU/US) は Tokyo → 海外 ~150ms と元の US → 海外より少し遅くなるが OAuth callback は 1 往復のみで影響軽微。",
      },
      {
        title: "🩹 Suspense streaming スケルトンのボタン枠ズレを修正",
        body: "ユーザー報告: 「Loading 時に表示される文字が枠からずれている」。原因: `SchedulePageSkeleton` のヘッダー右側 4 ボタンの 4 つ目を `h-8 w-24` (96px) で placeholder していたため、実 layout (4 つすべて `h-8 w-8` = 32px) に切り替わる瞬間に 64px の横方向シフトが発生していた。さらに `items-baseline gap-3` を実 layout の `items-center gap-2` に揃え、左側 heading placeholder にも `min-w-0 flex-1` を付与。次回開催日 card も `px-4 py-5` → `p-3 sm:p-4`、icon `h-9 w-9` → `h-8 w-8` で実 `NextSessionCard` の Frame と一致させ、行ごとの 6 chip 装飾は狭幅 viewport では実際には見えないため簡素な 1 placeholder に変更。これでスケルトン → 実コンテンツの swap 時の layout shift がほぼゼロに。",
      },
      {
        title: "🔢 バージョン管理体系を MAJOR.MINOR (YYYY-MM-DD) 方式へ移行",
        body: "これまでは 1 コミット = 1 patch で運用し 1.9 系が 38 patch まで肥大していたため、これ以降は `MAJOR.MINOR (YYYY-MM-DD)` 方式に移行 (patch 廃止)。現状の 1.9 を据え置きで継続し、バグ修正・小規模調整は同じ MAJOR.MINOR で日付のみ更新、機能追加で MINOR 上げ (1.9 → 1.10)、破壊的変更で MAJOR 上げ (1.x → 2.0)。ヘッダーバッジも `v1.9 (2026-04-28)` 形式に。",
      },
      {
        title: "📝 マクロ未登録時のプレースホルダー文を簡潔化",
        body: "「戦闘中に使う `/p` `/say` 系のマクロや、戦術コールのテンプレ等を...」→「攻略に用いる戦術のテンプレ等を...」に変更。マクロ用途を「戦闘中の `/p` `/say` 系」に限定せず、攻略全般の戦術テンプレ用途を含む簡潔な表現に。",
      },
      {
        title: "🔗 攻略リンクのアイコンをサイト種別で色分け (Web / 動画 / X)",
        body: "これまで全リンクが magenta の `ExternalLink` 単一表示だったのを、URL host から「Web (`Globe` / magenta) / 動画 (`Video` / cyan) / X (Twitter) (X ロゴ SVG / foreground)」の 3 区分に判定して描画。共通基盤として `src/lib/link-site.ts` (host → 種別判定) と `src/components/portal/link-site-icon.tsx` (coarse / fine 切替可能) を追加。",
      },
      {
        title: "🎬 動画リンクのアイコンを 5 種に細分化 (YouTube / Twitch / ニコニコ / X / Web)",
        body: "攻略リンクの 3 区分 (web/動画/X) より細かい 5 区分に分け、YouTube → 赤 (`text-red-500`)、Twitch → 紫 (`text-violet-400`)、ニコニコ動画 → 橙 (`text-orange-300`)、X (Twitter) → X ロゴ SVG、その他 → magenta `Globe` で描画。動画カードの (1) 非 YouTube 用プレースホルダーの `Film` アイコン + 「External Video」ラベルを `LinkSiteIcon variant=\"fine\"` + サイト名ラベル (例: TWITCH / NICONICO / X / Web) に、(2) フッターの URL 行先頭 `ExternalLink` を `LinkSiteIcon variant=\"fine\"` に置換。",
      },
      {
        title: "📐 動画カードの高さばらつきを 44px → 5px に圧縮",
        body: "description / title / footer URL の長さ差で生じていた不揃いを line-clamp + min-h で吸収: タイトル `line-clamp-2` + 行コンテナ `min-h-[2.625rem]` で常に 2 行分確保、description は条件レンダリングを廃止し常時 `<p min-h-[2.4375rem] line-clamp-2>` (空文字でも 2 行分の領域を予約)、badges 行 (FFLogs / Duration) も常時レンダリングで `min-h-[1.75rem]` を確保、URL footer は `break-all` を廃止し `truncate min-w-0` で 1 行省略表示 + `title` 属性で full URL を tooltip 表示。サイズ計測 (49 件) で全カード 349-354px に収束。",
      },
      {
        title: "📏 動画カードを更に縦に 35px 圧縮 (350px → 315px)",
        body: "Discord 取り込みバッジと FFLogs ボタンの間の余白が広すぎたため、(1) section gap を `gap-2` → `gap-1` に、(2) description の確保高を 2 行 → 1 行 (`min-h-[1.21875rem]`) に縮小。中身が 2 行に達した場合のみ `line-clamp-2` で 2 行まで伸びる挙動。range 5px の均一性は維持。",
      },
      {
        title: "🚦 ヘッダーバッジに「デプロイ識別色」を導入 (7 色サイクル)",
        body: "ヘッダーのバージョン + STAGE 表示に `VERCEL_GIT_COMMIT_SHA` (Vercel ビルド時に埋め込まれる commit SHA) を seed としたハッシュ → cyan / amber / emerald / rose / violet / orange / fuchsia の 7 色のいずれかを割当。push 後にページを再読込した時点で色が変わっていれば deploy が反映済みと目視確認できる。Vercel 以外 (ローカル dev 等) では `JSON.stringify(RELEASES[0])` を seed にフォールバックするので、changelog の最新エントリーを編集すれば色が変わる。テーマ切替で意味が変わらないよう Tailwind 標準色から選定。",
      },
      {
        title: "🗂 更新履歴を折りたたみ + コミット単位の part 分け表示に",
        body: "1 日に多数のコミットを積む新スキーム運用ではエントリーが縦長になりがちなため、(1) 各リリースを `<details>` で折りたたみ可能に (最新のみ default open)、(2) 1 リリース内の長文 notes を「コミット単位の part」(`title` + `body`) に分割し、part 単位でも個別に開閉できるようにした。`ReleaseEntry` 型に `parts?: ReleasePart[]` を追加 (`notes?: string[]` と排他、UI 側で優先表示)。旧エントリー (`1.9.38` 以前) は `notes` のまま動作。",
      },
      {
        title: "🔀 マクロページの募集文テンプレに DnD 並び替え追加 (トップページ連動)",
        body: "TODO #6 完了。これまでマクロページの募集文テンプレ一覧は順序固定で、並び替えはトップ (スケジュールページ) の管理ダイアログのみだったが、マクロページでも DnD 可能にした。`SortableTemplateRow` 内に `useSortable` + ドラッグハンドル (`<GripVertical>`) を追加。drag end 時はカテゴリ内の新順を arrayMove → グローバル `allLive` を走査して該当カテゴリの slot に新順を流し込む形で `setRecruitmentTemplateOrder` 呼出 → 他カテゴリの絶対位置は不変、グローバル sort_order も整合性維持。先頭テンプレ (= トップページ「募集」ボタンのコピー対象) には `★ Top` バッジ + cyan ring を表示、reorder で別の行に Top が移れば自動で badge も移動。トップページの `RecruitmentTopCopyButton` は realtime 購読しているので即時反映。",
      },
      {
        title: "📦 更新履歴に「もっと見る」ボタン (5 件以降は省略)",
        body: "新スキーム移行で changelog エントリーが増えると設定ダイアログのレイアウトが縦に間延びするため、初期表示は最新 5 件に制限。`▼ もっと見る (残り N 件)` ボタンで全件展開、`▲ 最新 5 件まで折りたたむ` で再収納できる。ローカル state なのでダイアログ閉じ → 再度開いた際は default の 5 件表示に戻る。",
      },
      {
        title: "📋 トップの「テンプレ」ポップアップに DnD + カテゴリ折りたたみ + マクロページリンク",
        body: "これまでは `DropdownMenu` ベースの単純なリスト + 別ダイアログ (`ManageDialog`) で並び替え/編集/削除を行っていたが、ポップアップ内で完結する形に統合。(1) 内部を `Popover` ベースに切替え、ドロップダウンメニュー特有の auto-close 制約を解消。(2) DnD を popup 内に直接配置 — `setRecruitmentTemplateOrder` 呼出で global sort_order に即時反映、`★ Top` バッジも自動連動。(3) カテゴリごとに collapsible (`★` を含むカテゴリのみ default open、それ以外は折りたたみ)、reorder で top カテゴリが入れ替わると新 top のカテゴリも自動展開。(4) 各カテゴリヘッダー右に `↗ ExternalLink` アイコンを追加 → `/category/{slug}/macros` で full CRUD (新規 / 編集 / 削除 + 全角→半角)。これに伴い不要になった `ManageDialog` および「テンプレートを編集 / 並べ替え」ボタンは削除。slug 受け渡しのため `recruitmentCategoryOptions` 型を `{ id, name }` → `{ id, name, slug }` に拡張。",
      },
      {
        title: "🌅 ヘッダー色を日付跨ぎでデフォルト (cyan) にリセット",
        body: "デプロイ識別色 (7 色サイクル) が「今日 deploy したかどうか」を視覚的に伝えるよう、`RELEASES[0].date` (= 当日エントリーの日付) と JST 現在日付が一致する間のみハッシュ色を表示し、翌日になったら `DEPLOY_COLORS[0]` (cyan) に戻す挙動に変更。実装: 新規クライアントコンポーネント `<DeployColorBadge>` を追加し、`useEffect` + 60s 間隔の `setInterval` で JST 日付を再評価 → `releaseDate !== today` なら default 色に切替え。SSR 初期色は server side で `Intl.DateTimeFormat` (Asia/Tokyo) を使って同じロジックで計算 → hydration mismatch なし。Next.js 16 の制約で client component の非コンポーネント export は server から呼べないため、`pickInitialColor` ロジックは site-header.tsx に inline 配置。",
      },
      {
        title: "🏷 過去活動履歴の見出し名を「簡易ログ / 詳細ログ」に差別化",
        body: "TODO #15 完了。これまで簡易表示の section header が `Past · 過去の活動`、詳細表示が `Past · 過去の予定` と微差で紛らわしかったため、それぞれ `Past · 簡易ログ (日付チップ)` / `Past · 詳細ログ (出欠表)` に変更。中身の内容を補助ラベルで明示することで、見出しだけ見れば「何が表示されているか」が分かるように。",
      },
      {
        title: "✏️ 運用ルール popup を inline 編集 + オリジナル/編集後トグルに刷新",
        body: "TODO #12 完了 (再修正版)。当初 iframe 経由で元サイトを開く方式に実装したが、ユーザー意図と異なり「popup 内のテキストをその場で編集 + 同期で上書きされない」必要があったため再設計。新規ストア `lib/schedule-top-text-store.ts` を追加し、Supabase `app_settings.schedule_top_text_override` キーに portal 側 override を保存。表示優先度は override > scraped。popup には (1) Pencil ボタン → textarea + 保存/キャンセル の inline 編集モード、(2) override 設定中はヘッダーに `[オリジナル] / [編集後]` トグルタブを表示し scraped と override を切り替え参照可能 (同期で上書きされた scraped と編集後の差分を確認できる)、(3) override クリア用の `RotateCcw` ボタン (確認ダイアログ付き)、(4) override 設定中は ルールバッジ右に小さい cyan dot で「編集済み」表示。サーバ側は `page.tsx` で `fetchAppSetting(SCHEDULE_TOP_TEXT_OVERRIDE_KEY)` を並列フェッチし `SchedulePageBody` → `ScheduleList` → `Legend` まで scraped と override の両方を別 props で渡す。",
      },
      {
        title: "🩹 運用ルール popup の保存後フリッカー / トグル非表示 / 反映遅延を修正 (3 件)",
        body: "TODO #12 の挙動修正。報告: (a) 編集して保存すると一瞬テキストが消える、(b) 保存後トグルボタンが見当たらない、(c) 更新を掛けるまで編集前のものが表示される。原因はいずれも `router.refresh()` 完了 (= prop 更新) までの間 UI に新しい override 値が無いこと。新規ローカル state `optimisticOverride` (`undefined | null | string`) を追加し、save 直後にローカルへ即時反映 → effectiveOverride を `optimisticOverride ?? topTextOverride` で算出 → prop 更新を `useEffect` で検知して楽観 state を破棄。save 中もタブ / dot / クリアボタンの表示判定は `effectiveOverride` 基準に統一。clear 操作も同様に `setOptimisticOverride(null)` で即時 UI 反映。失敗時は `setOptimisticOverride(undefined)` で即座に prop 値へ revert。",
      },
      {
        title: "🔄 同期 (refresh) 後も override が保持されるよう view 自動同期を強化",
        body: "ユーザー報告: 「同期すると編集後のテキストが消えているように見える。同期時はオリジナルの文面を変更して、編集後のものはそのままにする。」。実装上 override は同期 (`router.refresh`) で touch されないが、view state がトグル位置にあると見え方が混乱する場合があったため、view を `effectiveOverride` の null/non-null 遷移にだけ自動追従させるロジックを追加 (`prevHasOverrideRef`)。同値の更新 (= 同期で同じ override が再取得) では view を変えずユーザー選択を維持、null → non-null (新規保存) では view を `edited` に、non-null → null (完全クリア) では `scraped` にフリップ。さらにトグルタブ「編集後」のラベル先頭に `★` を付与し、override が存在することを視覚的に強調。preview で end-to-end 検証 — save → 即時表示 → タブ / dot 出現 → 同期後も維持 → クリアで scraped に戻ることを確認。",
      },
      {
        title: "🐛 運用ルール override が DB に保存できていなかったバグを修正 (Server Reference proxy 化問題)",
        body: "ユーザー報告: 「編集後、ページ更新を掛けても編集後の文言が消えてオリジナル表記だけになる」。原因: `SCHEDULE_TOP_TEXT_OVERRIDE_KEY` 定数を `\"use client\"` 指令付きの `schedule-top-text-store.ts` から server component (`page.tsx`) 経由で import していた。Next.js 16 の RSC では client モジュールからの非コンポーネント export は Server Reference proxy に変換されるため、文字列キーが Function オブジェクトとして渡り、`fetchAppSetting()` の `.eq(\"key\", <function>)` で常に 0 件マッチ → null が返ってきていた (= 表示時に override 無し扱い)。書込み (client→DB) は実際には成功していたため optimistic state では一見動いて見えたが、F5 で optimistic が消えると override も消えたように見える挙動になっていた。修正: 定数を独立 module `src/lib/schedule-top-text-keys.ts` (`\"use client\"` 無し) に切り出し、server / client 双方からそこを import するように変更。デバッグログ (`fetchAppSetting` 戻り値) で `key=[Function (anonymous)]` を観測して原因特定 → 修正後は F5 reload + popup open で `★編集後` タブ + cyan dot + saved override 正常表示を確認。`optimisticOverride` の reset 条件も「prop が optimistic と一致した時のみ」に変更し、不慮の null 戻りでも編集後テキストが消えないよう防御。",
      },
      {
        title: "🛡 楽観 state の reset 条件を厳格化 (prop 不一致時は保持)",
        body: "上記 bug 修正の副次対応。`optimisticOverride` の reset を従来の「`topTextOverride` 変化時に問答無用 undefined」から「`optimisticOverride === topTextOverride` の時のみ undefined」に変更。これにより同期で server が予期せず別値 (典型的には null) を返してきても、ユーザーの編集後テキストを画面から消さずに保持する。RLS / ネットワーク不安定時の保険。",
      },
      {
        title: "🔗 設定ダイアログに FF14 Lodestone (公式) リンクを追加",
        body: "TODO #18 完了。出欠 / 装備チェック / Mog ステーション等で頻繁にアクセスする FF14 公式 Lodestone (https://jp.finalfantasyxiv.com/lodestone/) への外部リンクを設定ダイアログのフッターに追加。GitHub Source の隣に並べて、`Link2` アイコン + 「Lodestone」ラベル + 「FF14 Lodestone (公式) を新しいタブで開く」tooltip。`target=\"_blank\" rel=\"noopener noreferrer\"` で安全に新規タブ開き。",
      },
      {
        title: "🔣 取り込み文字の HTML エンティティ decode を網羅化 (TODO #13)",
        body: "ユーザー報告: 「読み込んだ文字が文字コードのまま表示される」。実態は `&times;` などの名前付きエンティティが decoder の対象に含まれていなかったこと。3 箇所に散在していた不完全な decoder (`schedule/parse.ts` の `stripHtmlToText` と `decodeEntities`、`server/page-title.ts` の `decodeEntities`) を `src/lib/html-entities.ts` の単一実装 `decodeHtmlEntities()` に統合。`&times;` `&divide;` `&plusmn;` `&deg;` `&micro;` `&hellip;` `&mdash;` `&ndash;` `&middot;` `&bull;` `&laquo;` `&raquo;` `&lsquo;` `&rsquo;` `&ldquo;` `&rdquo;` `&sbquo;` `&bdquo;` `&sect;` `&para;` `&iexcl;` `&iquest;` `&larr;` `&uarr;` `&rarr;` `&darr;` `&harr;` `&yen;` `&pound;` `&euro;` `&cent;` `&copy;` `&reg;` `&trade;` `&hearts;` `&clubs;` `&spades;` `&diams;` 等を網羅。数値参照 (`&#NN;` / `&#xHH;`) と `&amp;` 先頭処理 (二重エンコード対応) も維持。preview で運用ルール popup の `&times;` → `×` 復号を確認。",
      },
      {
        title: "⚡ 重いダイアログ系を `next/dynamic` で別 chunk 化してリロード時間短縮 (TODO #11)",
        body: "ユーザー報告: 「全体的にページが重い、リロードに時間がかかる」。原因の一つ: `SettingsDialog` (~1601 行 + 内包する `MaintenanceMenu` ~880 行) が `site-header` 経由で全ページの初期 client bundle に常時混入していた。同様に `CategoryFormDialog` (~487 行) と `LinkFormDialog` (~338 行) も category 系ページに eager load されていた。それぞれ `*-lazy.tsx` の薄い wrapper で `next/dynamic({ ssr: false })` 化し、初期 paint の bundle から外して別 chunk で並行 fetch。ボタン表示は ms オーダーの遅延が出るが critical path 外なので許容。trigger ボタンが現れる前に「Settings/コンテンツ追加/リンク追加」を押す可能性は実質ゼロ。`page.tsx` (server component) からは `ssr: false` が使えないので静的 import のままだが、client 側の `category-list.tsx` / `strategy-list.tsx` / `videos-list.tsx` 経由分はすべて lazy 化された (chunk split は client 側 import の有無で判定されるため)。",
      },
      {
        title: "⚡ スケジュール page の memo を server prefetch して N 個の SELECT クエリを回避 (TODO #11)",
        body: "ユーザー報告: 「過去簡易ログのメモや動画アイコンが遅れて表示」。原因: 各 `<DateChip>` (簡易 ~7 件) と `<SessionRow>` (詳細 ~30+ 件) が個別に `useRealtimeScheduleMemos` を呼び、mount 時に SELECT クエリを発行していた。30+ 並列 SELECT のためメモバッジが順次表示されていた。修正: 新規 server-side `fetchScheduleMemosByDateBulk()` で全 memo を一括取得し、`page.tsx` の `Promise.all` に追加。`Record<rawDate, ScheduleSessionMemo[]>` を `SchedulePageBody` → `SchedulePastSimple` / `ScheduleList` に props で降して各 chip / row に渡す。クライアント hook は `initial.length === 0` の時だけ refetch するよう改修して N 並列 SELECT を撤廃。Realtime subscription は維持 (live 更新用) なので保存・更新後の同期動作は不変。",
      },
      {
        title: "🗂 更新履歴を最新 5 件のみに絞り、それ以前は GitHub commits リンクへ (bundle 軽量化)",
        body: "ユーザー提案: 「更新履歴に関しては直近5件のみでそれ以降は省略かどこかへのリンクでもいいかもしれない」。`changelog.ts` の `RELEASES` から古い 84 件 (1.9.34 ～ 1.0.0) を削除し最新 5 件のみ残置 — ファイル 984 → 179 行に縮小。SettingsDialog chunk のサイズが大幅に減るので、設定を開いた時の応答性も向上。古い履歴は GitHub commits ページ (`/commits/main`) に外部リンクで誘導 (各コミットメッセージに version + 内容が記録済みのため代替手段として十分)。`showAllReleases` state と `RELEASES_INITIAL_LIMIT` 定数も役目が無くなったので撤去。",
      },
      {
        title: "🚀 / ページを Edge Runtime 化 + 5 分毎の warm-up cron でコールドスタート抑制",
        body: "Vercel Free tier の Node.js Function は数分アクセスがないと sleep し、復帰に 500ms-1.5s かかってリロードの「引っ掛かり」体感の主因になっていた。対策 2 段:\n(1) `/` ルートを Edge Runtime に切替 (`export const runtime = \"edge\"`)。Edge Function は cold start ~50ms 程度で Node の数分の一。互換性のため `fflogs-oauth.ts` の `Buffer.from(...).toString(\"base64\")` を `btoa()` (Web 標準) に置換 — Node でも Edge でも動く。Build 検証で他の Node-only API は不在を確認。`/api/auth/fflogs/callback` 等の API ルートは Node Runtime のまま (route 単位で独立)。\n(2) `/api/health` を Edge で新設 (DB / 外部 fetch なし、軽量 JSON)。GitHub Actions ワークフロー `.github/workflows/warmup.yml` を追加し、5 分毎に repo secret `WARMUP_URL` (= `https://<deploy>/api/health`) を curl で叩く。これで `/` と同じ Function プールが常に warm。GitHub Actions Free tier は public repo で実質無料、月 8640 回のジョブも 1 回 ~10s で 2000 分以内に収まる。",
      },
      {
        title: "🌊 Suspense streaming で初期 paint を即時化 (TODO #11)",
        body: "ページ全体の `await Promise.all([...6 fetches])` で layout HTML すら 1.5s 待たされていた問題に対応。`SchedulePage` を 2 段構成に分割:\n(1) 外側 (server component): `getScheduleSourceUrl()` のみ await (~50ms、`React.cache` で deduped)。url 不在なら Onboarding を即返す。\n(2) 主データ取得を `<Suspense fallback={<SchedulePageSkeleton />}>` でラップした `<ScheduleContent>` 内に隔離。\nNext.js の streaming protocol により layout (header / nav) + skeleton が ~100ms で client に届き、その下で fetch が完了次第 streamed HTML chunk として実コンテンツに置換される。新規 `<SchedulePageSkeleton />` コンポーネントは next-session card / schedule list の概形をなぞる pulse animation 付きで、置換時のレイアウトシフトも抑制。",
      },
    ],
  },
  {
    version: "1.9.38",
    date: "2026-04-28",
    notes: [
      "🏳️ チップ縦中央の追求を断念し、シンプルな `inline-flex items-center py-1 leading-tight` に戻す。1.9.28-1.9.37 で試した h-6 + leading-6 / leading-none / asymmetric padding / translateY / inline-grid + place-items-center などのいずれも、Windows / Yu Gothic UI 環境での font metric 非対称を完全には吸収できず、副作用 (アイコンとのズレ) が出ていた。Windows ユーザーにはわずかな上寄りの空白が残るが、アイコン整列が崩れないことを優先",
    ],
  },
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
];
