import type { Locale } from "./locales";

/**
 * UI 文言の辞書 (2026-09-06、第 1 段)。
 *
 * 日本語 (`ja`) を正とし、`en` は同じ形 (`Messages` 型) を満たすことを
 * コンパイラに保証させる。キーは画面単位に寄せる (login / denied / header /
 * nav / schedule / settings)。数や名前を埋め込むものは関数にする。
 *
 * 追加するときは ja に書いてから en を足す (en が欠けると型エラーになる)。
 * 第 2 段以降で他画面を移す際も同じファイルに追記していく想定だが、
 * 画面数が増えて重くなったら画面ごとに分割する。
 */
const ja = {
  common: {
    appName: "RAID REPOSITORY",
    cancel: "キャンセル",
    save: "保存",
    saving: "保存中…",
    settings: "設定",
    language: "表示言語",
  },
  login: {
    title: "ログイン",
    kicker: "FFXIV STATIC PORTAL",
    taglineLine1: "スケジュール・軽減表・ロット・攻略・",
    taglineLine2: "動画・練習ログを、固定の 8 人で 1 か所に。",
    memberOnlyLine1: "このポータルは Discord サーバーのメンバー限定です。",
    memberOnlyLine2: "参加済みの Discord アカウントでログインしてください。",
    featuresAria: "ポータルに含まれる機能",
    features: {
      schedule: "スケジュール",
      mitigation: "軽減表",
      loot: "ロット",
      guide: "攻略",
      video: "動画",
      logs: "練習ログ",
    },
    button: "Discord でログイン",
    buttonBusy: "Discord へ移動中…",
    errorMissingCode: "認可コードが届きませんでした。もう一度お試しください。",
    errorExchangeFailed: "Supabase とのセッション交換に失敗しました。",
    errorGeneric: (code: string) => `エラー: ${code}`,
  },
  denied: {
    title: "アクセス権がありません",
    notAdminLine1: "この操作は管理者ロールを持つメンバー限定。",
    notAdminLine2: "サーバー管理者に管理者ロール付与を依頼してください。",
    missingRoleLine1: "このコンテンツは特定の Discord ロールを持つメンバー限定。",
    missingRoleLine2: "サーバー管理者にロール付与を依頼してください。",
    notMemberLine1: "このポータルは指定 Discord サーバーのメンバー限定です。",
    notMemberLine2: "対象サーバーに参加してから、もう一度ログインしてください。",
    backToSchedule: "スケジュールへ戻る",
    loginAsOther: "別アカでログイン",
    backToLogin: "ログインに戻る",
  },
  header: {
    homeAria: "Raid Repository ホーム",
    onlineAria: (n: number) => `オンライン ${n} 人`,
    onlineTitle: (n: number) => `現在 ${n} 人がオンライン`,
    deployTitle:
      "デプロイ識別色: 当日の最新コミットから派生 (7 色サイクル)。日付が変わったら default の cyan にリセット",
    themeAria: "テーマを切り替え",
  },
  nav: {
    mainAria: "メインナビゲーション",
    subAria: "コンテンツ内ナビゲーション",
    schedule: "スケジュール",
  },
  schedule: {
    nextLabel: "次回開催日",
    fetchFailed: "取得失敗",
    reasonNoUrl: "NEXT_PUBLIC_SCHEDULE_URL が未設定です",
    reasonFetchFailed: "スケジュールサイトに接続できませんでした",
    reasonParseFailed: "ページ構造の解析に失敗しました",
    undecided: "未確定",
    undecidedSub: "「日程確定」マークが付いた予定が見つかりませんでした",
    decided: "確定",
    decidedAria: "日程確定",
    inSession: "挑戦中",
    today: "本日",
    tomorrow: "明日",
    inDays: (n: number) => `あと ${n} 日`,
    calendarAria: "この予定を Google カレンダーに追加",
    calendarTitle: "Google カレンダーに追加",
    calendarEventTitle: (rawDate: string) => `固定活動 ${rawDate}`,
    countdownTitle: "開始までの残り時間 (30 秒ごとに更新)",
    // 予定表
    listFetchFailed: "スケジュール取得失敗",
    listReasonNoUrl: "NEXT_PUBLIC_SCHEDULE_URL が設定されていません。",
    listReasonFetchFailed: "スケジュールサイトに接続できませんでした。",
    listReasonParseFailed: "ページ構造の解析に失敗しました。",
    emptyTitle: "予定なし",
    emptyDescription: "表示できる予定が見つかりませんでした。",
    colDate: "日程",
    noUpcoming: "今後の予定はありません",
    pastDetailSub: "· 詳細ログ (出欠表)",
    countAll: (n: number) => `${n} 件`,
    countRecent: (recent: number, all: number) => `直近 ${recent} 件 / 全 ${all} 件`,
    foldOlder: "2 ヶ月以上前を畳む",
    unfoldOlder: (n: number) => `2 ヶ月以上前を表示 (${n} 件)`,
    decidedTitleScroll: (date: string) => `日程確定 — クリックで ${date} の行までスクロール`,
    undecidedTitleScroll: (date: string) => `未確定 — クリックで ${date} の行までスクロール`,
    openSourceRowAria: (date: string) => `スケジュール元サイトの ${date} の行を開く`,
    scheduleRowDialogTitle: (date: string) => `スケジュール (${date} の行へ移動)`,
    editAttendanceDialog: (name: string) => `${name} の出欠を編集`,
    editAttendanceTitle: (name: string) => `${name} の出欠をその場で編集`,
    editAttendanceDialogIncluding: (name: string, date: string) =>
      `${name} の出欠を編集 (${date} を含む)`,
    editAttendanceTitleIncluding: (name: string, date: string) =>
      `${name} の出欠をその場で編集 (${date} を含む全日程)`,
    commentEdit: (name: string) => `${name} のコメントを編集`,
    commentView: (name: string) => `${name} のコメントを表示`,
    // ページ上部のトグル
    pastSimpleShow: "過去の活動 (簡易)",
    pastSimpleHide: "過去の活動 (簡易) を隠す",
    pastSimpleTitleOn: "過去の活動 (簡易) — 表示中",
    pastSimpleTitleOff: "過去の活動 (簡易) — 直近の日付チップ",
    pastDetailShow: "過去の活動 (詳細)",
    pastDetailHide: "過去の活動 (詳細) を隠す",
    pastDetailTitleOn: "過去の活動 (詳細) — 表示中",
    pastDetailTitleOff: "過去の活動 (詳細) — 出席者付きの全件表",
    openSource: "元サイトを開く",
  },
  settings: {
    aria: "設定",
    description: "この設定は固定の全員に共有されます",
    readOnlyNotice:
      "スケジュール / FFLogs / DB 編集系の設定は ADMIN ロールを持つユーザーのみ操作できます。閲覧専用モードで表示中です。",
    languageTitle: "表示言語",
    languageDescription:
      "この端末 (ブラウザ) だけの設定です。ログイン画面・ヘッダー・スケジュール画面が切り替わります (他の画面は順次対応)。",
    languageSwitchAria: "表示言語を切り替え",
  },
} as const;

/** ja と同じ形。関数の引数も揃える。 */
export type Messages = DeepWiden<typeof ja>;

const en: Messages = {
  common: {
    appName: "RAID REPOSITORY",
    cancel: "Cancel",
    save: "Save",
    saving: "Saving…",
    settings: "Settings",
    language: "Language",
  },
  login: {
    title: "Sign in",
    kicker: "FFXIV STATIC PORTAL",
    taglineLine1: "Schedule, mitigation sheets, loot, guides,",
    taglineLine2: "videos and practice logs, in one place.",
    memberOnlyLine1: "This portal is for members of the Discord server only.",
    memberOnlyLine2: "Sign in with the Discord account that has joined the server.",
    featuresAria: "What's inside the portal",
    features: {
      schedule: "Schedule",
      mitigation: "Mitigation",
      loot: "Loot",
      guide: "Guides",
      video: "Videos",
      logs: "Practice logs",
    },
    button: "Sign in with Discord",
    buttonBusy: "Redirecting to Discord…",
    errorMissingCode: "No authorization code was received. Please try again.",
    errorExchangeFailed: "Failed to exchange the session with Supabase.",
    errorGeneric: (code) => `Error: ${code}`,
  },
  denied: {
    title: "Access denied",
    notAdminLine1: "This action is limited to members with the admin role.",
    notAdminLine2: "Ask a server administrator to grant you the admin role.",
    missingRoleLine1: "This content is limited to members with a specific Discord role.",
    missingRoleLine2: "Ask a server administrator to grant you the role.",
    notMemberLine1: "This portal is limited to members of the designated Discord server.",
    notMemberLine2: "Join the server, then sign in again.",
    backToSchedule: "Back to schedule",
    loginAsOther: "Sign in with another account",
    backToLogin: "Back to sign-in",
  },
  header: {
    homeAria: "Raid Repository home",
    onlineAria: (n) => `${n} online`,
    onlineTitle: (n) => `${n} member${n === 1 ? "" : "s"} online now`,
    deployTitle:
      "Deploy color: derived from today's latest commit (7-color cycle). Resets to the default cyan the next day",
    themeAria: "Switch theme",
  },
  nav: {
    mainAria: "Main navigation",
    subAria: "Section navigation",
    schedule: "Schedule",
  },
  schedule: {
    nextLabel: "Next session",
    fetchFailed: "Fetch failed",
    reasonNoUrl: "NEXT_PUBLIC_SCHEDULE_URL is not set",
    reasonFetchFailed: "Could not reach the schedule site",
    reasonParseFailed: "Could not parse the page structure",
    undecided: "Not decided",
    undecidedSub: "No session is marked as decided yet",
    decided: "Decided",
    decidedAria: "Date decided",
    inSession: "In progress",
    today: "Today",
    tomorrow: "Tomorrow",
    inDays: (n) => `in ${n} day${n === 1 ? "" : "s"}`,
    calendarAria: "Add this session to Google Calendar",
    calendarTitle: "Add to Google Calendar",
    calendarEventTitle: (rawDate) => `Static raid ${rawDate}`,
    countdownTitle: "Time until start (updates every 30 s)",
    listFetchFailed: "Failed to load the schedule",
    listReasonNoUrl: "NEXT_PUBLIC_SCHEDULE_URL is not set.",
    listReasonFetchFailed: "Could not reach the schedule site.",
    listReasonParseFailed: "Could not parse the page structure.",
    emptyTitle: "No sessions",
    emptyDescription: "There are no sessions to show.",
    colDate: "Date",
    noUpcoming: "No upcoming sessions",
    pastDetailSub: "· attendance table",
    countAll: (n) => `${n} session${n === 1 ? "" : "s"}`,
    countRecent: (recent, all) => `recent ${recent} / all ${all}`,
    foldOlder: "Hide sessions older than 2 months",
    unfoldOlder: (n) => `Show sessions older than 2 months (${n})`,
    decidedTitleScroll: (date) => `Decided — click to scroll to the ${date} row`,
    undecidedTitleScroll: (date) => `Not decided — click to scroll to the ${date} row`,
    openSourceRowAria: (date) => `Open the ${date} row on the schedule source site`,
    scheduleRowDialogTitle: (date) => `Schedule (jump to ${date})`,
    editAttendanceDialog: (name) => `Edit ${name}'s attendance`,
    editAttendanceTitle: (name) => `Edit ${name}'s attendance in place`,
    editAttendanceDialogIncluding: (name, date) =>
      `Edit ${name}'s attendance (including ${date})`,
    editAttendanceTitleIncluding: (name, date) =>
      `Edit ${name}'s attendance in place (all dates, including ${date})`,
    commentEdit: (name) => `Edit ${name}'s comment`,
    commentView: (name) => `Show ${name}'s comment`,
    pastSimpleShow: "Past sessions (compact)",
    pastSimpleHide: "Hide past sessions (compact)",
    pastSimpleTitleOn: "Past sessions (compact) — shown",
    pastSimpleTitleOff: "Past sessions (compact) — recent date chips",
    pastDetailShow: "Past sessions (detailed)",
    pastDetailHide: "Hide past sessions (detailed)",
    pastDetailTitleOn: "Past sessions (detailed) — shown",
    pastDetailTitleOff: "Past sessions (detailed) — full table with attendees",
    openSource: "Open the source site",
  },
  settings: {
    aria: "Settings",
    description: "These settings are shared with everyone in the static",
    readOnlyNotice:
      "Schedule / FFLogs / database settings can only be changed by users with the ADMIN role. Showing read-only mode.",
    languageTitle: "Language",
    languageDescription:
      "Applies to this device (browser) only. Switches the sign-in page, header and schedule page (other pages will follow).",
    languageSwitchAria: "Switch language",
  },
};

export const MESSAGES: Record<Locale, Messages> = { ja, en };

/**
 * `as const` で literal 化した ja の型を、en が別の文字列を入れられる形に
 * 広げる (文字列 literal → string、関数はそのまま)。
 */
type DeepWiden<T> = T extends string
  ? string
  : T extends (...args: infer A) => infer R
    ? (...args: A) => R
    : { [K in keyof T]: DeepWiden<T[K]> };
