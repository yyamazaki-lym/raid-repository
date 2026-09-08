import type { DeepWiden } from "../widen";

/**
 * 練習ログ (logs-view) / サブタブ / カテゴリ一覧の文言 (第 3 段、2026-09-07)。
 * 書き方は `./core.ts` と同じ: ja を正 (`as const`)、en は同じ形を型で強制。
 * セクション名は core / settings / content と重複させない。
 *
 * - `logs`           練習ログ本体 (見出し / タイル / 到達度 / 振り返り / pull 行)
 * - `logsEmpty`      練習ログの空状態
 * - `logsSync`       同期ボタン / 同期結果 toast / レポート削除
 * - `logsImport`     URL 貼り付けインポートのダイアログ
 * - `logsDifficulty` 取り込み難易度の下限ダイアログ
 * - `logsOffset`     動画オフセットのダイアログ
 * - `categoryStatus` ステータスバッジ (DB の値 → 表示名)
 * - `categoryList`   /category のカード一覧
 *
 * 層 / フェーズ / ワイプ原因の「不明」など、純粋関数側で組み立てるラベルは
 * 辞書を import せず locale 引数で切り替える (`fflogs-progress.ts` /
 * `fflogs-fight-detail.ts` / `duration-format.ts` / `sub-tab-defs.ts`)。
 * 複数行 JSX から移した文は、JSX の空白畳み込み後の描画結果と同じ文字列に
 * してある (行の継ぎ目の半角スペースは元の描画通り)。
 */
export const ja = {
  logs: {
    title: "練習ログ",
    notFound: "コンテンツが見つかりませんでした。",
    savingDots: "保存中...",
    saveFailed: (reason: string) => `保存失敗: ${reason}`,
    pulls: (n: number) => `${n} pull`,
    // サマリータイル
    statTotalPulls: "総 pull",
    statRecentShown: (n: number) => `直近 ${n} 件を表示`,
    statPracticeDays: "練習日数",
    daysValue: (n: number) => `${n} 日`,
    statBest: "最深到達",
    kill: "討伐",
    hpLeft: (pct: string) => `残 ${pct}`,
    hpLeftCompact: (pct: string) => `残${pct}`,
    statClear: "クリア",
    statFloorClear: (floor: string) => `${floor}クリア`,
    clearCount: (n: number) => `${n} 回`,
    fastestClear: (dur: string) => `最速 ${dur}`,
    firstClear: (date: string) => `初クリア ${date}`,
    // 日ごとの到達度
    timelineTitle: "日ごとの到達度",
    timelineLegend: "バー = ベスト到達度 / 右端の旗 = 記録更新",
    recordFlagTitle: "この日にそれまでの自己ベストを更新しました",
    firstKillFlagTitle: "この日が初討伐です",
    phaseFirstReachTitle: "初到達まで",
    phaseFirstReachHint:
      "各フェーズに初めて到達した pull までの累計戦闘時間 (その pull を含む)。カッコ内は何本目の pull か",
    phaseFirstReachAria: "各フェーズへの初到達",
    // L-1 (2026-09-08): 零式の層ごとの初討伐。絶の「初到達まで」の層版。
    floorClearTitle: "各層の初討伐",
    floorClearHint:
      "その層を初めて討伐した pull までの、その層だけの累計戦闘時間 (その pull を含む)。「N pull」はその層で何本目か、「通算 N」はティア開始から数えて何本目か。初討伐の日時は各行の hover で表示",
    floorClearAria: "各層の初討伐",
    floorClearOverall: (n: number) => `通算 ${n}`,
    floorClearHover: (date: string, time: string, overall: number) =>
      `初討伐 ${date} ${time} 開始の pull (ティア通算 ${overall} pull 目)`,
    timelineLegendFloors: " / 縦線 = 層の境目",
    timelineLegendPhases: " / 縦線 = フェーズの境目",
    openDayTitle: (date: string) => `${date} のセッション振り返りを開く`,
    dayBestTitle: "その日のベスト到達",
    firstKillAria: "初討伐",
    recordAria: "自己ベスト更新",
    showRecentOnly: "直近 10 日だけ表示",
    showRemainingDays: (n: number) => `残り ${n} 日を表示`,
    // セッション振り返り
    sessionsTitle: "セッション振り返り",
    allFloors: "全層",
    floorFilterTitle: (floor: string) => `${floor}の pull だけ表示`,
    floorShort: (n: number) => `${n}層`,
    floorRange: (from: number, to: number) => `${from}-${to}層`,
    // 日の行
    combatTime: (dur: string) => `戦闘 ${dur}`,
    dayDeathsTitle: "この日の死亡数 (取得済みの pull の合計)",
    dayDeathsMissing: "この日の死亡数は未取得です",
    difficultyTitle: "コンテンツの難易度 (コンテンツ編集で変更できます)",
    videoOffset: "動画オフセット",
    setVideoOffsetTitle: "この report の動画とオフセットを設定",
    editVideoTitle: "この動画の URL とオフセットを編集",
    addVideo: "動画を追加",
    addVideoTitle: "この report にもう 1 本の動画を紐づける (オフセットは動画ごと)",
    videoNth: (n: number) => `動画 ${n}`,
    deleteReport: "ログ削除",
    deleteReportAria: (code: string) => `レポート ${code} を練習ログから削除`,
    deleteReportTitle: "このレポートを練習ログから削除 (以後も取り込まない)",
    dayWipeCausesTitle:
      "この日の wipe で最初に落ちた人の致命の一撃 (技名) を数えたもの",
    wipeCauses: "ワイプ原因",
    // pull 行
    pullIndexTitle: (n: number) => `この日の ${n} 番目の pull`,
    startTimeTitle: "戦闘開始時刻 (JST)",
    durationTitle: "戦闘時間",
    partyDpsTitle: "PT 合計 DPS (個人の内訳は保存していません)",
    partyDpsMissing: "PT 合計 DPS は未取得です",
    deathsTitle: "死亡数",
    deathsMissing: "死亡数は未取得です",
    wipeFirstDeath: (t: string) => `最初の死亡: ${t}`,
    wipeCluster: (n: number) => ` / 10 秒以内に ${n} 人`,
    wipeDeaths: (n: number) => ` / 死亡 ${n}`,
    openFflogsTitle: "FFLogs でこの pull を開く",
    deathsViewTitle: "この pull の死亡一覧 (死亡直前の被ダメ / 回復) を開く",
    deathsViewAria: "死亡一覧を開く",
    damageTakenTitle: "この pull の被ダメージ (何で削られたか) を開く",
    damageTakenAria: "被ダメージを開く",
    xivAnalysisTitle: "XIVAnalysis でこの pull を解析する",
    videoMomentTitle: "動画のこの瞬間から再生",
    videoMomentTitleNamed: (name: string) => `${name} のこの瞬間から再生`,
    video: "動画",
    // 総 pull の内訳チップ
    breakdownAria: "pull 数の内訳",
    breakdownTitleTruncated: "表示中の明細の内訳 (古い pull は含まれません)",
    breakdownTitle: "層 / フェーズごとの pull 数",
    // ワイプ原因カード
    wipeCausesHint:
      "各 wipe で最初に落ちた人の致命の一撃 (killing blow) を技名で数えています。DoT や遅れて倒れた場合は真因と一致しないことがあります",
    wipeCausesSub: (n: number) => `初死亡の技 / ${n} wipe`,
    shownOnly: " (表示中の分)",
    wipeCausesAria: "ワイプ原因の内訳",
    wipePhaseAria: "初死亡が起きたフェーズ",
    wipePhaseTitle: "最初の死亡が起きたフェーズごとの wipe 数",
    // フェーズ滞在時間カード
    phaseTimeTitle: "フェーズ滞在時間",
    phaseTimeTotal: (t: string) => `合計 ${t}`,
    phaseTimeAll: (n: number) => ` (登録ログ全 ${n} pull)`,
    phaseTimePartial: (n: number, total: number) =>
      ` (フェーズ情報のある ${n} / 全 ${total} pull)`,
    phaseTimePartialTitle:
      "フェーズ遷移は 2026-09-06 以降に FFLogs v2 (OAuth) 経路で取得した pull にだけ入ります。古い pull は同期の取り直し (1 回 40 レポート) で順に埋まりますが、unlisted / private で v1 経路になったレポートには入りません (同期結果の「経路」を参照)",
    phaseTimeAria: "フェーズごとの滞在時間",
    phaseSpanAria: (label: string) => `フェーズ滞在: ${label}`,
    // 取り込めていないレポート
    failedTitle: "取り込めていないレポート",
    unassigned: "コンテンツ未割当",
  },
  logsEmpty: {
    title: "練習ログがまだありません",
    intro:
      "FFLogs のレポートを取り込むと、pull 数・到達度・残 HP% がここに並びます。取り込み方は 2 つです。",
    syncStrong: "「ログを同期」を押す",
    syncText:
      "— 動画に FFLogs の URL が紐づいているか、コンテンツ編集で zone ID / マッチワードを設定してあるか、レポートの zone 名が 一致すれば、このコンテンツのログとして取り込まれます。",
    importStrong: "「URL から取り込む」に貼る",
    importText:
      "— 一覧に出てこない unlisted (限定公開) のレポートは、URL を直接貼れば取り込めます。",
    privateNote:
      "private (非公開) のレポートだけは、FFLogs の公開設定を unlisted 以上に変えるか、本人の FFLogs 連携が必要です。",
    dataSource: "データ元:",
    analysis: " / 解析: ",
  },
  logsSync: {
    button: "ログを同期",
    buttonBusy: "同期中...",
    toastDone: (reports: number, pulls: number) =>
      `同期完了 — ${reports} レポート / ${pulls} pull`,
    reattributed: (n: number) => ` / 再分類 ${n}`,
    videosBridged: (n: number) => ` / 動画に紐づけ ${n}`,
    failedSuffix: (n: number) => ` (失敗 ${n} — 理由は下に表示)`,
    truncatedSuffix: " ※途中まで",
    routeSuffix: (v2: number, fallback: number) =>
      ` / 経路: v2 ${v2} 件・代替 ${fallback} 件 (代替経路はフェーズ・死亡情報なし)`,
    remainingSuffix: (n: number) =>
      ` ※残り ${n} レポートは次回 — もう一度「ログを同期」を押すと続きを取得します`,
    // W-5 (2026-09-07): 自動発見の結果。
    discovered: (n: number): string => `自動発見: 新しいレポート ${n} 件を候補に追加しました`,
    discoveryNote: (reason: string): string => `自動発見: ${reason}`,
    failuresTitle: (n: number) =>
      `今回の同期で取得できなかったレポート (${n} 件)`,
    // レポート削除
    deleteConfirmTitle: (code: string) =>
      `レポート ${code} を練習ログから削除しますか？`,
    deleteConfirmDescription:
      "このレポートの pull をすべて削除し、以後の同期でも取り込まないようにします (設定から解除できます)。",
    deleteFailed: (reason: string) => `削除失敗: ${reason}`,
    deleted: (n: number) => `${n} pull を削除し、今後は取り込みません`,
  },
  logsImport: {
    button: "URL から取り込む",
    title: "レポート URL から取り込む",
    descA:
      "unlisted (限定公開) レポートは一覧からの自動発見ができないため、 URL を貼り付けて取り込みます (1 回につき最大 25 件)。",
    descLink: "FFLogs",
    descB:
      "の一覧ページはリンク文字にしか名前が出ず、通常のコピーでは URL が 取れないため、下の",
    descStrong: "抽出ブックマークレット",
    descC: "を使うのが 最短です。",
    bookmarkletTitle: "一覧から URL を一括コピーする (初回のみ設定)",
    step1: "下のボタンで抽出コードをコピー",
    step2:
      "ブラウザで新しいブックマークを作り、URL 欄に貼り付けて保存 (名前は「FFLogs URL 抽出」など)",
    step3: "FFLogs のレポート一覧ページを開いた状態でそのブックマークをクリック",
    step4: "「N 件のレポート URL をコピーしました」と出たら、下の欄に貼り付け",
    copyBookmarklet: "抽出ブックマークレットをコピー",
    toastCopied: "抽出ブックマークレットをコピーしました",
    toastCopyFailed: "コピー失敗（ブラウザの権限を確認してください）",
    pasteLabel: "貼り付け",
    pastePlaceholder: "https://www.fflogs.com/reports/... (改行区切りで複数可)",
    detected: (n: number) => `${n} 件のレポートを検出しました`,
    notDetected: "レポート URL が未検出です",
    submit: (n: number) => `${n} 件を取り込む`,
    submitBusy: "取り込み中...",
    // 2026-09-07: 診断 / 手動割り当て
    diagnose: "診断",
    diagnosing: "診断中...",
    diagHint:
      "取り込んだのに出ないときは「診断」で、台帳 (取得できたか / zone) と pull の保存先を確認できます。",
    diagNotInLedger: "台帳に無い — まだ取り込まれていません (このダイアログから取り込んでください)",
    diagBlocked: "除外リストに入っています (誤取り込みとして削除済み)",
    diagFailed: (reason: string) => `取得失敗: ${reason}`,
    diagOk: (zone: string, title: string, cat: string) =>
      `取得済み — zone: ${zone} / タイトル: ${title} / 台帳のカテゴリ: ${cat}`,
    diagZoneCategory: (cat: string) => `zone から決まるコンテンツ: ${cat}`,
    diagNone: "(なし)",
    diagFights: (total: number, here: number, other: number, none: number) =>
      `pull ${total} 件 — このコンテンツ ${here} / 別コンテンツ ${other} / 未分類 ${none}`,
    diagName: (name: string, count: number, resolved: string) =>
      `${name} × ${count} → 分類器: ${resolved}`,
    diagProgress: (kills: number, noPct: number, noPhase: number) =>
      `到達度: クリア ${kills} / 残 HP% 未取得 ${noPct} / フェーズ未取得 ${noPhase}`,
    diagProgressRaw: (min: number, max: number) => ` · 残 HP% の生値 ${min}〜${max}`,
    diagDates: (dates: string) => `日付: ${dates}`,
    diagUnresolved: "決められない",
    diagUnnamed: "(名前なし)",
    recategorize: "いまの分類器で再分類",
    recategorizeBusy: "再分類中...",
    recategorized: (moved: number, unchanged: number) =>
      moved > 0
        ? `${moved} pull を正しいコンテンツへ移しました (${unchanged} pull は変更なし)`
        : `移動が必要な pull はありませんでした (${unchanged} pull を確認)`,
    assign: (n: number) => `残り ${n} pull をこのコンテンツに割り当て`,
    assignBusy: "割り当て中...",
    assigned: (reports: number, fights: number) =>
      `${reports} レポート / ${fights} pull をこのコンテンツに割り当てました`,
    toastDone: (reports: number, pulls: number) =>
      `取り込み完了 — ${reports} レポート / ${pulls} pull`,
  },
  logsDifficulty: {
    button: "取り込み設定",
    buttonTitle: "取り込む難易度の下限を設定 (ノーマル混入の防止)",
    title: "取り込む難易度の下限",
    descA:
      "ノーマルなど別難易度のレポートを取り込まないようにできます。 FFLogs の難易度は数値で、コンテンツ種別によって値が変わります (公開された対応表がありません)。",
    descStrong: "下の実測値を見て",
    descB: "、残したい難易度の最小値を 入れてください。空にすると制限なしに戻ります。",
    observedTitle: "取り込み済みの難易度",
    observedEmpty: "難易度が記録された pull がまだありません",
    minLabel: "下限 (空 = 制限なし)",
    minPlaceholder: "例: 101",
    hint:
      "既に取り込んだ pull はこの設定では消えません。個別のレポートは 日ごとの一覧にあるゴミ箱から削除してください。",
    errNotNumber: "数値で入力してください",
    toastCleared: "難易度の制限を解除しました",
    toastSet: (value: number) => `難易度 ${value} 未満を取り込まないようにしました`,
  },
  /** W-3 セッションサマリー (2026-09-07)。 */
  sessionSummary: {
    label: "セッション",
    title: "この日の拘束時間・実戦闘時間・平均プル長 (最初の pull の開始から最後の pull の終了まで)",
    span: (dur: string) => `拘束 ${dur}`,
    fight: (dur: string) => `戦闘 ${dur}`,
    downtime: (dur: string, pct: number) => `戦闘外 ${dur} (${pct}%)`,
    downtimeTitle:
      "拘束時間から実戦闘時間を引いた値です。休憩・解説・作戦会議・リセット待ちを含みます (「無駄な時間」ではありません)。",
    avgPull: (dur: string) => `平均 ${dur}`,
    killWipe: (kills: number, wipes: number) => `討伐 ${kills} / ワイプ ${wipes}`,
  },
  /** W-31 チーム実績バッジ (2026-09-07)。 */
  teamBadges: {
    title: "チーム実績",
    label: (kind: string): string =>
      kind === "firstClear"
        ? "初討伐"
        : kind === "flawless"
          ? "ノーデス討伐"
          : kind === "fastestClear"
            ? "最速討伐"
            : "討伐回数",
    hint: (kind: string): string =>
      kind === "firstClear"
        ? "最初に討伐した日 (登録ログのうち時系列で最初の討伐)"
        : kind === "flawless"
          ? "誰も倒れずに討伐した回があります (死亡数を取得できた討伐のみ判定)"
          : kind === "fastestClear"
            ? "討伐のうち戦闘時間が最短だったもの"
            : "登録ログに入っている討伐の回数",
    times: (n: number) => `${n} 回`,
  },
  /** W-4 進行トレンド (2026-09-07)。 */
  trend: {
    title: "進行トレンド",
    sessions: (n: number) => `${n} セッション`,
    cumulative: (n: number) => `累計 ${n} pull`,
    truncated: "表示中の明細のみ",
    chartAria: (sessions: number, best: number) =>
      `${sessions} セッションの到達度の推移 (最高 ${best}%)`,
    bestProgress: (pct: number) => `最高到達 ${pct}%`,
    pace: (sessions: number, pulls: number) =>
      `この調子ならあと ${sessions} セッション / ${pulls} pull (目安)`,
    paceTitle:
      "直近 5 セッションの伸びをそのまま延長した目安です。到達度は線形に伸びないので (最後のフェーズで止まるのが普通)、あくまで参考値として見てください。",
    noPace: "ペースの目安は出せません",
    noPaceTitle:
      "直近のセッションで最高到達が伸びていない (または既にクリア済み / セッションが 3 回未満) ため、延長する意味のある数字が出せません。",
  },
  logsOffset: {
    title: "動画オフセットの設定",
    descA: "動画上で",
    descStrong: "最初の pull (一覧の #1) の戦闘が始まる時刻 (秒)",
    descB:
      "を 1 回だけ入れておくと、以降その日の全 pull の動画内 時刻が自動計算されます。例: 動画の 0:56 で #1 が始まるなら 「56」。",
    videoUrlLabel: "動画 URL",
    autofill: "自動入力",
    offsetLabel: "オフセット（秒）",
    offsetPlaceholder: "例: 56（動画の 0:56 で #1 の戦闘が始まる）",
    errOffset: "オフセットは秒数で入力してください",
    toastSaved: "保存しました",
    errNoVideo: "この report に紐づいた動画が見つかりませんでした",
    titleAdd: "動画の追加",
    multiHint:
      "同じ日に複数の動画 (前半/後半・視点違いなど) を紐づけられます。オフセットは動画ごとに別なので、投稿ごとに入れてください。",
    labelLabel: "表示名（任意）",
    labelPlaceholder: "例: 前半 / ヒラ視点",
    deleteVideo: "この動画を外す",
    toastDeleted: "動画の紐づけを外しました",
    // W-11 動画で合わせる (2026-09-07)。
    syncTitle: "動画を見ながら合わせる",
    syncHint:
      "動画を再生して、基準にする pull の戦闘開始の瞬間で止めてから「いまの位置を基準にする」を押すと、オフセットを秒数を数えずに決められます。",
    syncAnchorLabel: "基準にする pull",
    // 前半が映っていない動画では #1 を基準にできないため、映っている pull を選べる。
    // 番号は出さない (レポート内連番と pull 行の日単位連番が食い違うため)。
    syncAnchorOption: (clock: string): string => `${clock} の戦闘開始`,
    syncPick: "いまの位置を基準にする",
    syncSeek: "推定位置へ移動",
    syncCurrent: (clock: string): string => `動画の現在位置 ${clock}`,
    syncWaiting: "プレーヤーの再生位置を待っています (一度再生すると取れます)",
    syncUnavailable:
      "この動画では再生位置を読み取れません。オフセットは手入力してください。",
    syncYoutubeOnly:
      "動画を見ながらの調整は YouTube の URL のときだけ使えます (Google フォト / ニコニコ動画は再生位置を外から読めません)。",
    syncNoAnchor: "このレポートに pull がまだありません",
    syncNudgeMinus: "1 秒戻す",
    syncNudgePlus: "1 秒進める",
    syncPicked: (seconds: number): string => `オフセットを ${seconds} 秒にしました`,
    // 2026-09-07 実機: 数字だけでは正しいか判断できず、基準の pull を
    // 取り違えたまま保存されていた。意味を実時刻で言い直す。
    explainFirst: (clock: string, videoClock: string): string =>
      `この値は「最初の pull (${clock}) が動画の ${videoClock}」という意味です`,
    explainFirstMissing: (clock: string, gap: string): string =>
      `この値は「動画が最初の pull (${clock}) の ${gap} 後から始まる」という意味です — 最初の pull は映っていません`,
    explainVisible: (index: number, clock: string, videoClock: string): string =>
      `動画に最初に映る pull: #${index} (${clock}) = 動画の ${videoClock}`,
    explainNoneVisible: "この値ではどの pull も動画に映らないことになります",
  },
  categoryStatus: {
    labels: {
      未着手: "未着手",
      練習中: "練習中",
      クリア済: "クリア済",
      休止中: "休止中",
    },
    changeAria: (label: string) => `ステータス: ${label} (クリックして変更)`,
  },
  categoryList: {
    pageTitle: "コンテンツ",
    pageDescription: "レイドコンテンツ単位で、軽減・ロット・攻略情報・動画などを切り替えます。",
    dbErrorTitle: "Supabase に接続できませんでした",
    dbErrorHint: "を Supabase Dashboard の SQL Editor で実行してください。詳細:",
    emptyTitle: "コンテンツがありません",
    emptyDescription: "右上の「コンテンツ追加」ボタンから登録できます。",
    statusUpdateFailed: (reason: string) => `ステータス更新失敗: ${reason}`,
    deleteConfirmTitle: (name: string) => `「${name}」を削除しますか？`,
    deleteConfirmDescription: "ロット管理・軽減表・攻略情報もすべて削除されます。",
    deleteFailed: (reason: string) => `削除失敗: ${reason}`,
    deleted: (name: string) => `「${name}」を削除しました`,
    dragHint: "· ドラッグで並び替え",
    timeToClear: "クリアまでの累計時間",
    timeSpent: "コンテンツ挑戦時間",
    dragHandleAria: (name: string) => `${name} の並び替えハンドル`,
    lockedTitle: (n: number) =>
      `このコンテンツは ${n} 個のロールに制限されています (あなたは閲覧不可)`,
    firstClearTitle: (date: string) =>
      `初クリア: ${date} (クリックでクリア日の動画へジャンプ)`,
    manualSuffix: " (手動入力)",
    recentImportsTitle: (n: number) => `過去7日で Discord から ${n} 件取り込み`,
    shortcutsAria: "サブページへのショートカット",
    menuAria: "コンテンツメニュー",
  },
} as const;

type LogsMessages = DeepWiden<typeof ja>;

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export const en: LogsMessages = {
  logs: {
    title: "Practice logs",
    notFound: "Content not found.",
    savingDots: "Saving...",
    saveFailed: (reason) => `Save failed: ${reason}`,
    pulls: (n) => `${n} ${plural(n, "pull", "pulls")}`,
    statTotalPulls: "Total pulls",
    statRecentShown: (n) => `Showing the last ${n}`,
    statPracticeDays: "Practice days",
    daysValue: (n) => `${n} ${plural(n, "day", "days")}`,
    statBest: "Best progress",
    kill: "Kill",
    hpLeft: (pct) => `HP ${pct}`,
    hpLeftCompact: (pct) => `HP ${pct}`,
    statClear: "Clears",
    statFloorClear: (floor) => `${floor} clears`,
    clearCount: (n) => `${n}`,
    fastestClear: (dur) => `Fastest ${dur}`,
    firstClear: (date) => `First clear ${date}`,
    timelineTitle: "Progress by day",
    timelineLegend: "Bar = best progress / flag = new record",
    recordFlagTitle: "A new personal best was set on this day",
    firstKillFlagTitle: "First clear was on this day",
    phaseFirstReachTitle: "First reached in",
    phaseFirstReachHint:
      "Cumulative fight time up to and including the pull that first reached each phase. The number in brackets is which pull it was",
    phaseFirstReachAria: "First time each phase was reached",
    floorClearTitle: "First clear per floor",
    floorClearHint:
      "Fight time spent on that floor up to and including the pull that first cleared it. \"N pull\" is which pull it was on that floor, \"total N\" counts from the start of the tier. Hover for the date and time",
    floorClearAria: "First clear of each floor",
    floorClearOverall: (n) => `total ${n}`,
    floorClearHover: (date, time, overall) =>
      `First cleared on the pull that started ${date} ${time} JST (pull ${overall} of the tier)`,
    timelineLegendFloors: " / lines = floor boundaries",
    timelineLegendPhases: " / lines = phase boundaries",
    openDayTitle: (date) => `Open the session review for ${date}`,
    dayBestTitle: "Best progress that day",
    firstKillAria: "First kill",
    recordAria: "New personal best",
    showRecentOnly: "Show only the last 10 days",
    showRemainingDays: (n) => `Show ${n} more ${plural(n, "day", "days")}`,
    sessionsTitle: "Session review",
    allFloors: "All floors",
    floorFilterTitle: (floor) => `Show only ${floor} pulls`,
    floorShort: (n) => `F${n}`,
    floorRange: (from, to) => `F${from}-${to}`,
    combatTime: (dur) => `Combat ${dur}`,
    dayDeathsTitle: "Deaths that day (sum of fetched pulls)",
    dayDeathsMissing: "Deaths not fetched for this day",
    difficultyTitle: "Content difficulty (change it in the content editor)",
    videoOffset: "Video offset",
    setVideoOffsetTitle: "Set the video and offset for this report",
    editVideoTitle: "Edit this video's URL and offset",
    addVideo: "Add video",
    addVideoTitle:
      "Link another video to this report (each video keeps its own offset)",
    videoNth: (n) => `Video ${n}`,
    deleteReport: "Remove log",
    deleteReportAria: (code) => `Remove report ${code} from practice logs`,
    deleteReportTitle:
      "Remove this report from practice logs (and skip it in future syncs)",
    dayWipeCausesTitle:
      "Counts the killing blow (ability) on the first death of each wipe that day",
    wipeCauses: "Wipe causes",
    pullIndexTitle: (n) => `Pull #${n} of the day`,
    startTimeTitle: "Start time (JST)",
    durationTitle: "Combat time",
    partyDpsTitle: "Party DPS (individual breakdown is not stored)",
    partyDpsMissing: "Party DPS not fetched",
    deathsTitle: "Deaths",
    deathsMissing: "Deaths not fetched",
    wipeFirstDeath: (t) => `First death: ${t}`,
    wipeCluster: (n) => ` / ${n} within 10 s`,
    wipeDeaths: (n) => ` / ${n} ${plural(n, "death", "deaths")}`,
    openFflogsTitle: "Open this pull in FFLogs",
    deathsViewTitle:
      "Open the deaths for this pull (damage taken / healing right before death)",
    deathsViewAria: "Open deaths",
    damageTakenTitle: "Open damage taken for this pull (what chipped you down)",
    damageTakenAria: "Open damage taken",
    xivAnalysisTitle: "Analyze this pull in XIVAnalysis",
    videoMomentTitle: "Play the video from this moment",
    videoMomentTitleNamed: (name) => `Play ${name} from this moment`,
    video: "Video",
    breakdownAria: "Pull breakdown",
    breakdownTitleTruncated:
      "Breakdown of the shown pulls (older pulls not included)",
    breakdownTitle: "Pulls per floor / phase",
    wipeCausesHint:
      "Counts the killing blow on the first person to die in each wipe, by ability. With DoTs or delayed deaths it may not match the real cause",
    wipeCausesSub: (n) => `First-death ability / ${n} ${plural(n, "wipe", "wipes")}`,
    shownOnly: " (shown pulls only)",
    wipeCausesAria: "Wipe cause breakdown",
    wipePhaseAria: "Phase of the first death",
    wipePhaseTitle: "Wipes per phase in which the first death happened",
    phaseTimeTitle: "Time in phase",
    phaseTimeTotal: (t) => `Total ${t}`,
    phaseTimeAll: (n) => ` (all ${n} logged pulls)`,
    phaseTimePartial: (n, total) => ` (${n} of ${total} pulls have phase data)`,
    phaseTimePartialTitle:
      "Phase transitions exist only for pulls fetched via the FFLogs v2 (OAuth) route since 2026-09-06. Older pulls fill in as sync re-fetches them (40 reports per run), but reports that fell back to the v1 route (unlisted / private) never get them (see the route breakdown in the sync result)",
    phaseTimeAria: "Time spent per phase",
    phaseSpanAria: (label) => `Time in phase: ${label}`,
    failedTitle: "Reports not imported",
    unassigned: "Unassigned",
  },
  logsEmpty: {
    title: "No practice logs yet",
    intro:
      "Import FFLogs reports and pull counts, progress and boss HP% will show up here. There are two ways to import.",
    syncStrong: "Press “Sync logs”",
    syncText:
      "— reports are imported for this content when a video has an FFLogs URL linked, a zone ID / match word is set in the content editor, or the report's zone name matches.",
    importStrong: "Paste into “Import from URL”",
    importText:
      "— unlisted reports don't show up in listings; paste their URLs directly to import them.",
    privateNote:
      "Only private reports need their FFLogs visibility changed to unlisted or above, or the uploader's FFLogs account linked.",
    dataSource: "Data:",
    analysis: " / analysis: ",
  },
  logsSync: {
    button: "Sync logs",
    buttonBusy: "Syncing...",
    toastDone: (reports, pulls) => `Synced — ${reports} reports / ${pulls} pulls`,
    reattributed: (n) => ` / reclassified ${n}`,
    videosBridged: (n) => ` / linked to videos ${n}`,
    failedSuffix: (n) => ` (${n} failed — reasons below)`,
    truncatedSuffix: " (partial)",
    routeSuffix: (v2, fallback) =>
      ` / routes: v2 ${v2}, fallback ${fallback} (fallback route has no phase / death data)`,
    remainingSuffix: (n) =>
      ` — ${n} report(s) left for next time; press "Sync logs" again to continue`,
    discovered: (n) => `Auto-discovery: added ${n} new report(s) as candidates`,
    discoveryNote: (reason) => `Auto-discovery: ${reason}`,
    failuresTitle: (n) => `Reports that failed in this sync (${n})`,
    deleteConfirmTitle: (code) => `Remove report ${code} from practice logs?`,
    deleteConfirmDescription:
      "Deletes every pull from this report and skips it in future syncs (can be undone in settings).",
    deleteFailed: (reason) => `Delete failed: ${reason}`,
    deleted: (n) =>
      `Removed ${n} ${plural(n, "pull", "pulls")}; the report will no longer be imported`,
  },
  logsImport: {
    button: "Import from URL",
    title: "Import from report URLs",
    descA:
      "Unlisted reports can't be discovered from listings, so paste their URLs here to import them (up to 25 at a time). ",
    descLink: "FFLogs",
    descB:
      " listing pages only show names as link text, so a plain copy doesn't give you the URLs — the ",
    descStrong: "extractor bookmarklet",
    descC: " below is the quickest way.",
    bookmarkletTitle: "Copy all URLs from a listing (one-time setup)",
    step1: "Copy the extractor code with the button below",
    step2:
      "Create a new bookmark in your browser, paste the code into its URL field and save (name it e.g. “FFLogs URL extractor”)",
    step3: "Open an FFLogs report listing page and click that bookmark",
    step4: "When it reports that N report URLs were copied, paste them into the field below",
    copyBookmarklet: "Copy extractor bookmarklet",
    toastCopied: "Extractor bookmarklet copied",
    toastCopyFailed: "Copy failed (check your browser permissions)",
    pasteLabel: "Paste",
    pastePlaceholder: "https://www.fflogs.com/reports/... (one per line for multiple)",
    detected: (n) => `${n} ${plural(n, "report", "reports")} detected`,
    notDetected: "No report URLs detected",
    submit: (n) => `Import ${n}`,
    submitBusy: "Importing...",
    diagnose: "Diagnose",
    diagnosing: "Diagnosing...",
    diagHint:
      "If imported reports do not show up, use Diagnose to see the ledger (fetched? zone) and where the pulls were stored.",
    diagNotInLedger: "Not in the ledger — not imported yet (import from this dialog)",
    diagBlocked: "On the exclusion list (deleted as a wrong import)",
    diagFailed: (reason) => `Fetch failed: ${reason}`,
    diagOk: (zone, title, cat) => `Fetched — zone: ${zone} / title: ${title} / ledger category: ${cat}`,
    diagZoneCategory: (cat) => `Content implied by the zone: ${cat}`,
    diagNone: "(none)",
    diagFights: (total, here, other, none) =>
      `${total} pulls — this content ${here} / other content ${other} / unassigned ${none}`,
    diagName: (name, count, resolved) => `${name} × ${count} → classifier: ${resolved}`,
    diagProgress: (kills, noPct, noPhase) =>
      `Progress: clears ${kills} / HP% missing ${noPct} / phase missing ${noPhase}`,
    diagProgressRaw: (min, max) => ` · stored HP% values ${min}-${max}`,
    diagDates: (dates) => `Dates: ${dates}`,
    diagUnresolved: "undecided",
    diagUnnamed: "(unnamed)",
    recategorize: "Re-classify with the current rules",
    recategorizeBusy: "Re-classifying...",
    recategorized: (moved, unchanged) =>
      moved > 0
        ? `Moved ${moved} pulls to the right content (${unchanged} unchanged)`
        : `No pulls needed moving (${unchanged} checked)`,
    assign: (n) => `Assign the remaining ${n} pulls to this content`,
    assignBusy: "Assigning...",
    assigned: (reports, fights) => `Assigned ${reports} report(s) / ${fights} pulls to this content`,
    toastDone: (reports, pulls) => `Imported — ${reports} reports / ${pulls} pulls`,
  },
  logsDifficulty: {
    button: "Import settings",
    buttonTitle: "Set the minimum difficulty to import (keeps Normal out)",
    title: "Minimum difficulty to import",
    descA:
      "Keep reports of other difficulties (e.g. Normal) from being imported. FFLogs difficulty is a number whose values vary by content type (there is no published mapping).",
    descStrong: "Check the observed values below",
    descB:
      " and enter the lowest difficulty you want to keep. Leave it empty to remove the limit.",
    observedTitle: "Imported difficulties",
    observedEmpty: "No pulls with a recorded difficulty yet",
    minLabel: "Minimum (empty = no limit)",
    minPlaceholder: "e.g. 101",
    hint:
      "Pulls already imported are not removed by this setting. Delete individual reports with the trash icon in the daily list.",
    errNotNumber: "Enter a number",
    toastCleared: "Difficulty limit removed",
    toastSet: (value) => `Pulls below difficulty ${value} will no longer be imported`,
  },
  sessionSummary: {
    label: "Session",
    title:
      "Time on task, time in combat and average pull length for this day (from the first pull's start to the last pull's end)",
    span: (dur) => `On task ${dur}`,
    fight: (dur) => `Combat ${dur}`,
    downtime: (dur, pct) => `Out of combat ${dur} (${pct}%)`,
    downtimeTitle:
      "Time on task minus time in combat. Includes breaks, explanations, planning and waiting for resets — it is not “wasted” time.",
    avgPull: (dur) => `Avg ${dur}`,
    killWipe: (kills, wipes) => `${kills} kill / ${wipes} wipe`,
  },
  teamBadges: {
    title: "Team achievements",
    label: (kind) =>
      kind === "firstClear"
        ? "First kill"
        : kind === "flawless"
          ? "Deathless kill"
          : kind === "fastestClear"
            ? "Fastest kill"
            : "Kills",
    hint: (kind) =>
      kind === "firstClear"
        ? "The first kill in the stored logs"
        : kind === "flawless"
          ? "A kill with nobody dying (only kills with fetched death counts are considered)"
          : kind === "fastestClear"
            ? "The kill with the shortest combat time"
            : "How many kills are in the stored logs",
    times: (n) => `${n}x`,
  },
  trend: {
    title: "Progress trend",
    sessions: (n) => `${n} sessions`,
    cumulative: (n) => `${n} pulls total`,
    truncated: "shown pulls only",
    chartAria: (sessions, best) =>
      `Progress over ${sessions} sessions (best ${best}%)`,
    bestProgress: (pct) => `Best ${pct}%`,
    pace: (sessions, pulls) =>
      `At this rate: ~${sessions} more sessions / ${pulls} pulls`,
    paceTitle:
      "Extrapolated from the last 5 sessions. Progress is not linear (runs usually stall on the final phase), so treat it as a rough guide only.",
    noPace: "No pace estimate",
    noPaceTitle:
      "Best progress has not improved over the recent sessions (or the content is already cleared / there are fewer than 3 sessions), so extrapolating would be meaningless.",
  },
  logsOffset: {
    title: "Video offset",
    descA: "Enter once the ",
    descStrong: "time (in seconds) in the video where the first pull (#1 in the list) starts",
    descB:
      ", and the video timestamp of every pull that day is computed automatically. E.g. if #1 starts at 0:56 in the video, enter “56”.",
    videoUrlLabel: "Video URL",
    autofill: "Auto-fill",
    offsetLabel: "Offset (seconds)",
    offsetPlaceholder: "e.g. 56 (pull #1 starts at 0:56 in the video)",
    errOffset: "Enter the offset in seconds",
    toastSaved: "Saved",
    errNoVideo: "No video linked to this report was found",
    titleAdd: "Add a video",
    multiHint:
      "You can link several videos to the same day (part 1 / part 2, different POVs). Each video keeps its own offset, so enter it per upload.",
    labelLabel: "Display name (optional)",
    labelPlaceholder: "e.g. Part 1 / Healer POV",
    deleteVideo: "Unlink this video",
    toastDeleted: "Unlinked the video",
    syncTitle: "Set it while watching",
    syncHint:
      "Play the video, pause at the moment the chosen pull starts, then press “Use current position” — no counting seconds.",
    syncAnchorLabel: "Reference pull",
    syncAnchorOption: (clock) => `Combat start at ${clock}`,
    syncPick: "Use current position",
    syncSeek: "Jump to estimate",
    syncCurrent: (clock: string): string => `Video position ${clock}`,
    syncWaiting: "Waiting for the player position (start playback once)",
    syncUnavailable:
      "The player position cannot be read for this video. Enter the offset manually.",
    syncYoutubeOnly:
      "Setting it while watching only works for YouTube URLs (Google Photos and Niconico do not expose the player position).",
    syncNoAnchor: "This report has no pulls yet",
    syncNudgeMinus: "Back 1 second",
    syncNudgePlus: "Forward 1 second",
    syncPicked: (seconds: number): string => `Offset set to ${seconds}s`,
    explainFirst: (clock: string, videoClock: string): string =>
      `This means “the first pull (${clock}) is at ${videoClock} in the video”`,
    explainFirstMissing: (clock: string, gap: string): string =>
      `This means “the video starts ${gap} after the first pull (${clock})” — the first pull is not in this video`,
    explainVisible: (index: number, clock: string, videoClock: string): string =>
      `First pull visible in the video: #${index} (${clock}) at ${videoClock}`,
    explainNoneVisible: "With this value, no pull would appear in the video",
  },
  categoryStatus: {
    labels: {
      未着手: "Not started",
      練習中: "In progress",
      クリア済: "Cleared",
      休止中: "On hold",
    },
    changeAria: (label) => `Status: ${label} (click to change)`,
  },
  categoryList: {
    pageTitle: "Contents",
    pageDescription: "Switch between raid contents — mitigation, loot, guides, videos and more.",
    dbErrorTitle: "Could not connect to Supabase",
    dbErrorHint: "in the Supabase Dashboard SQL Editor. Details:",
    emptyTitle: "No contents yet",
    emptyDescription: "Add one with the “Add content” button at the top right.",
    statusUpdateFailed: (reason) => `Status update failed: ${reason}`,
    deleteConfirmTitle: (name) => `Delete “${name}”?`,
    deleteConfirmDescription:
      "Its loot, mitigation and strategy data will be deleted as well.",
    deleteFailed: (reason) => `Delete failed: ${reason}`,
    deleted: (name) => `Deleted “${name}”`,
    dragHint: "· drag the handle to reorder",
    timeToClear: "Total time to clear",
    timeSpent: "Time spent on this content",
    dragHandleAria: (name) => `Reorder handle for ${name}`,
    lockedTitle: (n) =>
      `This content is restricted to ${n} ${plural(n, "role", "roles")} (you can't view it)`,
    firstClearTitle: (date) =>
      `First clear: ${date} (click to jump to the clear-day videos)`,
    manualSuffix: " (manual)",
    recentImportsTitle: (n) =>
      `${n} ${plural(n, "link", "links")} imported from Discord in the last 7 days`,
    shortcutsAria: "Sub-page shortcuts",
    menuAria: "Content menu",
  },
};
