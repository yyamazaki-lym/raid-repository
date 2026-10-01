import type { ServerTextDictRaw } from "./server-text";

/**
 * Server Action の日本語の失敗理由 → 英語 (2026-10-01 監査 U-6)。
 *
 * 英語表示のときだけ遅延で読み込む (日本語表示の利用者には配らない)。
 * キーはソースの文字列と完全一致させること。新しい日本語の理由を足したら
 * ここにも足す (`scripts/check-server-text.mjs` が抜けを CI で止める)。
 * 使われなくなったキーは残っていても害はないが、検査が一覧に出す。
 */
export const SERVER_TEXT_EN: ServerTextDictRaw = {
  exact: {
    "1 レポートに紐づけられる動画は 12 本までです":
      "Up to 12 videos can be linked to one report",
    "ADMIN ロールが必要です":
      "The ADMIN role is required",
    "BiS の ID が不正です":
      "Invalid BiS ID",
    "CANDIDATE ではない":
      "Not a candidate",
    "CSV 取得に対応しない URL 形式":
      "This URL format does not support CSV export",
    "Channel ID は 17〜20 桁の数字です":
      "A channel ID is a 17–20 digit number",
    "DISCORD_BOT_TOKEN 未設定":
      "DISCORD_BOT_TOKEN is not set",
    "Discord CDN URL ではありません":
      "Not a Discord CDN URL",
    "Discord 画像取得失敗 (不正な redirect Location)":
      "Failed to fetch the Discord image (invalid redirect location)",
    "Discord 画像取得失敗 — URL 期限切れ / タイムアウトの可能性 (":
      "Failed to fetch the Discord image — the URL may have expired or timed out (",
    "Discord 画像取得失敗 — redirect ループ":
      "Failed to fetch the Discord image — redirect loop",
    "Discord 画像取得失敗 — redirect 先が Discord CDN 以外でした":
      "Failed to fetch the Discord image — redirected outside the Discord CDN",
    "FFLOGS_API_KEY が無効です — fflogs.com/profile の Web API セクションで v1 Public Key を確認、Vercel に設定後 redeploy":
      "FFLOGS_API_KEY is invalid — check the v1 public key in the Web API section of fflogs.com/profile, set it in Vercel, and redeploy",
    "FFLOGS_API_KEY 未設定":
      "FFLOGS_API_KEY is not set",
    "FFLogs OAuth が未接続です — 設定ダイアログから接続すると pull 単位のログを取り込めます":
      "FFLogs OAuth is not connected — connect it in the settings dialog to import per-pull logs",
    "FFLogs OAuth が未接続です — 設定ダイアログから接続すると死亡の直前を読めます":
      "FFLogs OAuth is not connected — connect it in the settings dialog to read the moments before each death",
    "FFLogs OAuth が未接続です — 設定ダイアログから接続すると軽減表の雛形を作れます":
      "FFLogs OAuth is not connected — connect it in the settings dialog to draft a mitigation sheet",
    "FFLogs OAuth トークンが無効です — 設定で再認証してください":
      "The FFLogs OAuth token is invalid — re-authenticate in settings",
    "FFLogs URL は http:// か https:// で始めてください":
      "The FFLogs URL must start with http:// or https://",
    "FFLogs URL を入力してください":
      "Enter an FFLogs URL",
    "FFLogs access_token を暗号化保存できませんでした: ":
      "Could not store the FFLogs access_token encrypted: ",
    "FFLogs refresh_token を暗号化保存できませんでした: ":
      "Could not store the FFLogs refresh_token encrypted: ",
    "FFLogs から取得できませんでした":
      "Could not fetch from FFLogs",
    "FFLogs のレート制限 (429)":
      "FFLogs rate limit (429)",
    "FFLogs ソースが設定されていません — 表示名 (v1)、OAuth、Cookie のいずれかを設定してください":
      "No FFLogs source is configured — set a display name (v1), OAuth, or a cookie",
    "FFLogs レポート URL を入力してください (例: https://www.fflogs.com/reports/abc123)":
      "Enter an FFLogs report URL (e.g. https://www.fflogs.com/reports/abc123)",
    "Google フォトの共有 URL もしくは画像直リンクを入力してください":
      "Enter a Google Photos share URL or a direct image link",
    "Logs URL は http:// または https:// で始まる正しい URL である必要があります":
      "The Logs URL must be a valid URL starting with http:// or https://",
    "OAuth クライアント未設定 — Vercel の環境変数 FFLOGS_OAUTH_CLIENT_ID / FFLOGS_OAUTH_CLIENT_SECRET を設定して redeploy してください":
      "The OAuth client is not configured — set FFLOGS_OAUTH_CLIENT_ID / FFLOGS_OAUTH_CLIENT_SECRET in Vercel and redeploy",
    "OAuth クライアント未設定 — fflogs.com/api/clients/ で OAuth クライアントを作成し、Vercel の環境変数 FFLOGS_OAUTH_CLIENT_ID / FFLOGS_OAUTH_CLIENT_SECRET に設定して redeploy してください":
      "The OAuth client is not configured — create an OAuth client at fflogs.com/api/clients/, set FFLOGS_OAUTH_CLIENT_ID / FFLOGS_OAUTH_CLIENT_SECRET in Vercel, and redeploy",
    "OAuth クライアント認証失敗 — fflogs.com/api/clients/ で client_id / client_secret が正しいか、Public Client にチェックが入っていないかを確認してください":
      "OAuth client authentication failed — check the client_id / client_secret at fflogs.com/api/clients/ and make sure Public Client is not checked",
    "Role ID は 17〜20 桁の数字です":
      "A role ID is a 17–20 digit number",
    "SECRET_ENCRYPTION_KEY 未設定":
      "SECRET_ENCRYPTION_KEY is not set",
    "SUPABASE_SERVICE_ROLE_KEY 未設定":
      "SUPABASE_SERVICE_ROLE_KEY is not set",
    "Storage クライアント初期化失敗 — SUPABASE_SERVICE_ROLE_KEY 未設定の可能性 (":
      "Failed to initialize the storage client — SUPABASE_SERVICE_ROLE_KEY may not be set (",
    "URL から表示名を抽出できませんでした":
      "Could not extract a display name from the URL",
    "URL が不正":
      "Invalid URL",
    "URL が不正です":
      "Invalid URL",
    "URL が空です":
      "The URL is empty",
    "URL が長すぎます":
      "The URL is too long",
    "URL の形式が正しくありません":
      "The URL format is not valid",
    "URL は http:// または https:// で始まる正しい URL である必要があります":
      "The URL must be a valid URL starting with http:// or https://",
    "URL を入力してください":
      "Enter a URL",
    "URL を指定してください":
      "Specify a URL",
    "URL 形式不正":
      "Invalid URL format",
    "URL 末尾の数字 ID は API で使えません — fflogs.com/profile で表示名を確認してください":
      "The numeric ID at the end of the URL cannot be used with the API — check your display name on fflogs.com/profile",
    "XivGear から取得できませんでした":
      "Could not fetch from XivGear",
    "XivGear の共有 URL ではありません":
      "Not an XivGear share URL",
    "discord_schedule_channel_id 未設定 — 設定 dialog でチャンネル ID を登録してください":
      "discord_schedule_channel_id is not set — register the channel ID in the settings dialog",
    "fights が取得できません (形式不一致)":
      "Could not read the fights (unexpected format)",
    "guild ID が数値ではありません":
      "The guild ID is not a number",
    "guild ID は数字のみで入力してください (URL ではありません)":
      "Enter the guild ID as digits only (not a URL)",
    "http:// または https:// で始めてください":
      "Start with http:// or https://",
    "id が空です":
      "The id is empty",
    "mode は sync / native / disabled のいずれかです":
      "mode must be one of sync / native / disabled",
    "nativeSessionId が空です":
      "nativeSessionId is empty",
    "pull の指定が不正です":
      "Invalid pull",
    "pull の詳細を取得できませんでした":
      "Could not fetch the pull details",
    "rawDate が空です":
      "rawDate is empty",
    "scrape-proxy がレート制限中 (429) — 1 分ほど待って再実行してください":
      "scrape-proxy is rate limited (429) — wait about a minute and try again",
    "session cookie が無効の可能性 (要再登録)":
      "The session cookie may be invalid (register it again)",
    "sessionId が空です":
      "sessionId is empty",
    "status は CANDIDATE / DECISION / CANCELLED のいずれかです":
      "status must be one of CANDIDATE / DECISION / CANCELLED",
    "token レスポンスが想定外の形式です":
      "The token response has an unexpected format",
    "v1 レスポンス形式不正":
      "Unexpected v1 response format",
    "この Discord ID はすでに登録済みです":
      "This Discord ID is already registered",
    "この pull はレポート開始時刻を保存できていません (同期をもう一度実行してください)":
      "This pull has no saved report start time (run the sync again)",
    "この pull は取り込まれていません":
      "This pull has not been imported",
    "このアドレスへは接続できません":
      "Cannot connect to this address",
    "このシートでチェック列が見つかっていないため、アイコン行を特定できません。":
      "No check column was found in this sheet, so the icon row cannot be identified.",
    "この動画はすでに紐づいています":
      "This video is already linked",
    "そのタグは既に付いています":
      "That tag is already attached",
    "その期間に該当する曜日がありません (期間と曜日を確認してください)":
      "No matching weekdays in that period (check the period and the weekdays)",
    "アイコンは見つかりましたが、どれもこのシートのチェック列と重なりませんでした。別シートのアイコンを誤って並べないよう、採用を見送りました。":
      "Icons were found, but none overlapped this sheet's check columns. They were not used, to avoid placing icons from another sheet.",
    "アイコンを読み取れませんでした。共有設定が「リンクを知っている全員が閲覧可」になっているか確認してください。":
      "Could not read the icons. Check that sharing is set to \"Anyone with the link can view\".",
    "アクティブメンバーなし":
      "No active members",
    "アルバムが見つかりません":
      "Album not found",
    "オフセットは ±24 時間以内で指定してください":
      "The offset must be within ±24 hours",
    "カテゴリ ID が不正です":
      "Invalid category ID",
    "キャラクター名は 64 文字以内です":
      "The character name must be 64 characters or fewer",
    "コメントは 500 文字以内で入力してください":
      "The comment must be 500 characters or fewer",
    "コンテンツの指定が不正です":
      "Invalid content",
    "シート URL が未設定です":
      "The sheet URL is not set",
    "シートが大きすぎます":
      "The sheet is too large",
    "シートが空です":
      "The sheet is empty",
    "シートが非公開です（CSV ではなく HTML が返りました）":
      "The sheet is private (HTML was returned instead of CSV)",
    "シート取得に失敗しました":
      "Failed to fetch the sheet",
    "ジョブの指定が不正です":
      "Invalid job",
    "スケジュールが見つかりません (URL を確認してください)":
      "Schedule not found (check the URL)",
    "スケジュール機能が無効です":
      "The schedule feature is disabled",
    "セッションが見つかりません":
      "Session not found",
    "セッション不明":
      "Unknown session",
    "セット情報を解釈できませんでした":
      "Could not parse the gear set",
    "タグの指定が不正です":
      "Invalid tag",
    "タグは 24 文字以内です":
      "Tags must be 24 characters or fewer",
    "タグを入力してください":
      "Enter a tag",
    "タグを指定してください":
      "Specify a tag",
    "チャンネル ID は 17〜20 桁の数字です":
      "A channel ID is a 17–20 digit number",
    "テンプレートが長すぎます (最大 2000 文字)":
      "The template is too long (max 2000 characters)",
    "テンプレートは 4000 文字以内で入力してください":
      "The template must be 4000 characters or fewer",
    "デモ表示中はコメントを編集できません":
      "Comments cannot be edited in the demo",
    "デモ表示中は利用できません":
      "Not available in the demo",
    "デモ表示中は変更できません":
      "Changes are disabled in the demo",
    "デモ表示中は既読を変更できません":
      "Read status cannot be changed in the demo",
    "データセンター名は 20 文字以内です":
      "The data center name must be 20 characters or fewer",
    "ページが大きすぎます":
      "The page is too large",
    "ページを取得できませんでした":
      "Could not fetch the page",
    "マクロの指定が不正です":
      "Invalid macro",
    "メンバーキーが不正です":
      "Invalid member key",
    "メンバー一覧にあなたの行がありません (幹部に追加を依頼してください)":
      "You are not in the member list (ask an officer to add you)",
    "リンクの ID が不正です":
      "Invalid link ID",
    "レスポンスが大きすぎます":
      "The response is too large",
    "レポート URL が見つかりませんでした":
      "No report URL was found",
    "レポート URL が見つかりませんでした — https://www.fflogs.com/reports/... を含むテキストを貼り付けてください":
      "No report URL was found — paste text that contains https://www.fflogs.com/reports/...",
    "レポートが取得できません":
      "Could not fetch the report",
    "レポートコードが不正です":
      "Invalid report code",
    "レポート開始時刻が取得できません":
      "Could not get the report start time",
    "ロールの指定が不正です":
      "Invalid role",
    "不正な発見元です":
      "Invalid discovery source",
    "並び順は数値で指定してください":
      "The sort order must be a number",
    "予定時刻は HH:MM で入力してください":
      "Enter the scheduled time as HH:MM",
    "保存できませんでした":
      "Could not save",
    "備考は 200 文字以内で入力してください":
      "The note must be 200 characters or fewer",
    "催促の頻度の指定が不正です":
      "Invalid reminder frequency",
    "先に一覧へ登録してください":
      "Register it in the list first",
    "先に他経路が更新済み":
      "Already updated by another process",
    "入力の形式が正しくありません":
      "The input format is not valid",
    "凡例を 1 つ以上指定してください":
      "Specify at least one legend entry",
    "出席サマリーの取得に失敗しました":
      "Failed to load the attendance summary",
    "別の FFLogs 同期が実行中です — 数分後にもう一度実行してください":
      "Another FFLogs sync is running — try again in a few minutes",
    "動画の ID が不正です":
      "Invalid video ID",
    "同じ URL が既に紐付いています":
      "The same URL is already linked",
    "同じレポートの URL が既に紐付いています (#fight 等の表記違いは同一レポート扱いです)":
      "A URL for the same report is already linked (variants such as #fight count as the same report)",
    "同じ日時の候補日がすでにあります":
      "A candidate date with the same date and time already exists",
    "同じ日時の候補日が追加されたところです。もう一度お試しください":
      "A candidate date with the same date and time was just added. Please try again",
    "名前を入力してください":
      "Enter a name",
    "対象が正しくありません":
      "Invalid target",
    "対象が見つかりませんでした":
      "The target was not found",
    "対象の候補日が見つかりませんでした":
      "The candidate date was not found",
    "対象の日程が見つかりませんでした":
      "The session was not found",
    "対象の行が見つかりませんでした":
      "The row was not found",
    "対象の過去予定が見つかりませんでした — 先にスナップショットを取るか、セッション情報を含めて再度お試しください":
      "The past session was not found — take a snapshot first, or try again with the session details",
    "対象の過去日程が見つかりませんでした — セッション情報を含めて再度お試しください":
      "The past session was not found — try again with the session details",
    "層タブは 20 件までです":
      "Up to 20 floor tabs are allowed",
    "帰属の指定が不正です":
      "Invalid attribution",
    "必要人数は 1〜24 で指定してください":
      "The required headcount must be between 1 and 24",
    "手順の指定が不正です":
      "Invalid step",
    "投稿先チャンネル ID 未設定":
      "The target channel ID is not set",
    "数値 ID ではなく表示名を入力してください（fflogs.com/profile の見出しに記載）":
      "Enter your display name, not the numeric ID (shown in the heading of fflogs.com/profile)",
    "数値 ID ではなく表示名（display name）を入力してください":
      "Enter your display name, not the numeric ID",
    "既定のスケジュールは削除できません":
      "The default schedule cannot be deleted",
    "日付が空です":
      "The date is empty",
    "日数は 0〜14 で指定してください":
      "The number of days must be between 0 and 14",
    "日時情報が不足しています":
      "Date and time information is missing",
    "時刻は 0〜23 で指定してください":
      "The hour must be between 0 and 23",
    "時刻は HH:MM 形式で入力してください":
      "Enter the time as HH:MM",
    "暗号化保存に失敗: ":
      "Failed to store encrypted: ",
    "曜日の指定が不正です":
      "Invalid weekday",
    "更新項目がありません":
      "Nothing to update",
    "有志練習 (自動確定の対象外)":
      "Optional session (not auto-confirmed)",
    "未入力のメンバーがいる":
      "Some members have not answered",
    "注釈の指定が不正です":
      "Invalid note",
    "注釈を保存できませんでした":
      "Could not save the note",
    "注釈を削除できませんでした":
      "Could not delete the note",
    "注釈を取得できませんでした":
      "Could not load the notes",
    "無効 (OFF)":
      "Disabled (OFF)",
    "状態の指定が不正です":
      "Invalid status",
    "現在のユーザー情報が取得できません — OAuth scope が view-user-profile を含んでいるか確認してください":
      "Could not get the current user — check that the OAuth scope includes view-user-profile",
    "画像が見つかりませんでした。アルバムが公開設定になっているかご確認ください":
      "No images were found. Check that the album is shared publicly",
    "画像サイズが 5MB を超えています":
      "The image is larger than 5 MB",
    "登録できる URL がありませんでした":
      "There were no URLs to register",
    "目標時刻前":
      "Before the target time",
    "知らないジョブです":
      "Unknown job",
    "空文字は受け付けません":
      "Empty text is not accepted",
    "終了時刻は HH:MM 形式で入力してください":
      "Enter the end time as HH:MM",
    "自分が付けた注釈だけ削除できます":
      "You can only delete notes you added",
    "表示中のスケジュールは削除できません":
      "The schedule being shown cannot be deleted",
    "表示名は 40 文字以内です":
      "The display name must be 40 characters or fewer",
    "表示名を入力してください":
      "Enter a display name",
    "解除できませんでした（権限がない可能性があります）":
      "Could not remove it (you may not have permission)",
    "通知の種類が不正です":
      "Invalid notification type",
    "通知先チャンネル ID 未設定":
      "The notification channel ID is not set",
    "通知時刻は 0〜23 の整数です":
      "The notification hour must be an integer from 0 to 23",
    "週の指定が不正です":
      "Invalid week",
    "進捗を保存できませんでした":
      "Could not save the progress",
    "進捗を取得できませんでした":
      "Could not load the progress",
    "進行モデルの指定が不正です":
      "Invalid progression model",
    "部位の指定が不正です":
      "Invalid gear slot",
    "開始と終了が同じ時刻です":
      "Start and end are the same time",
    "開始・終了時刻は両方指定するか、両方 default に戻してください":
      "Set both the start and end times, or reset both to default",
    "開始時刻と終了時刻が同じです":
      "The start and end times are the same",
    "開始時刻は HH:MM 形式で入力してください":
      "Enter the start time as HH:MM",
    "難易度は 0〜1000 の整数で指定してください":
      "The difficulty must be an integer from 0 to 1000",
  },
  templates: {
    "${row} 行目: 日時の形式が不正です":
      "Row {0}: invalid date/time format",
    "${row} 行目: 終了が開始より前になっています":
      "Row {0}: the end is before the start",
    "${row} 行目: 開始と終了を入力してください":
      "Row {0}: enter a start and an end",
    "Discord 画像取得失敗 (HTTP ${res.status}) — URL 期限切れの可能性":
      "Failed to fetch the Discord image (HTTP {0}) — the URL may have expired",
    "FFLogs から取得できませんでした (${res.status})":
      "Could not fetch from FFLogs ({0})",
    "Storage アップロード失敗: ${upErr.message}":
      "Storage upload failed: {0}",
    "fflogs HTML scrape ${data.status} (page ${page}, edge 経由)":
      "fflogs HTML scrape {0} (page {1}, via edge)",
    "fflogs internal ${data.status} (edge 経由)":
      "fflogs internal {0} (via edge)",
    "gid「${gid}」は数字で指定してください":
      "gid \"{0}\" must be a number",
    "scrape-proxy がレート制限中 (429, page ${page}) — 連動が同時に複数走っていないか確認し、1 分ほど待って再実行してください":
      "scrape-proxy is rate limited (429, page {0}) — make sure several syncs are not running at once, wait about a minute, and try again",
    "token 交換失敗 (HTTP ${res.status}) — Vercel ログで詳細を確認してください":
      "Token exchange failed (HTTP {0}) — check the Vercel logs for details",
    "「${name}」の ID が不正です (17〜20 桁の数字)":
      "The ID for \"{0}\" is invalid (17–20 digits)",
    "アルバムの取得に失敗しました: ${msg}":
      "Failed to fetch the album: {0}",
    "ジョブは ${MAX_JOBS_PER_SCOPE} 件までにしてください":
      "Choose up to {0} jobs",
    "タグは 1 リンクにつき ${LINK_TAG_MAX_PER_LINK} 個までです":
      "Up to {0} tags per link",
    "プレビュー失敗: ${String(e)}":
      "Preview failed: {0}",
    "ユーザー「${username}」が見つかりません":
      "User \"{0}\" was not found",
    "一言は ${NOTE_MAX} 文字以内で入力してください":
      "The note must be {0} characters or fewer",
    "予定が ${count} 件残っています (先に空にしてください)":
      "{0} sessions remain (empty it first)",
    "参加可能 ${available} 人 < 必要 ${minAvailable} 人":
      "{0} available < {1} required",
    "参加可能 ${available} 人で自動確定":
      "Auto-confirmed with {0} available",
    "取得に失敗しました (HTTP ${res.status})":
      "Fetch failed (HTTP {0})",
    "本文が長すぎます (最大 ${MAX_TOP_TEXT_LEN} 文字)":
      "The text is too long (max {0} characters)",
    "消化ウィンドウは 1〜${LOOT_WINDOW_WEEKS_MAX} 週で指定してください":
      "The window must be 1 to {0} weeks",
    "画像 MIME (${contentType || \"unknown\"}) は許可されていません":
      "Image MIME type ({0}) is not allowed",
    "登録できるのは ${MAINTENANCE_MAX_WINDOWS} 件までです":
      "Up to {0} entries can be registered",
    "登録できるのは ${MAX_NATIVE_SCHEDULES} 件までです":
      "Up to {0} entries can be registered",
    "登録できるのは ${MAX_REGISTERED_SCHEDULES} 件までです":
      "Up to {0} entries can be registered",
    "短時間に何度も取得しています。${rl.retryAfterSeconds} 秒ほど待ってから試してください":
      "Too many requests in a short time. Wait about {0} seconds and try again",
    "設定の取得に失敗しました: ${String(e)}":
      "Failed to load the settings: {0}",
    "難易度ラベルは ${DIFFICULTY_LABEL_MAX_LENGTH} 文字以内です":
      "The difficulty label must be {0} characters or fewer",
  },
  labels: {
    "${step.table} 削除":
      "delete {0}",
    "BiS リンク作成":
      "create the BiS link",
    "BiS リンク削除":
      "delete the BiS link",
    "BiS リンク更新":
      "update the BiS link",
    "BiS 部位の保存":
      "save the BiS slots",
    "Channel ID 保存":
      "save the channel ID",
    "Channel ID 削除":
      "delete the channel ID",
    "FFLogs ユーザー名保存":
      "save the FFLogs user name",
    "FFLogs ユーザー名削除":
      "delete the FFLogs user name",
    "FFLogs 連携解除":
      "disconnect FFLogs",
    "Role ID 保存":
      "save the role ID",
    "Role ID 削除":
      "delete the role ID",
    "URL 保存":
      "save the URL",
    "guild ID 保存":
      "save the guild ID",
    "logs URL 削除":
      "delete the Logs URL",
    "logs URL 追加":
      "add the Logs URL",
    "logs 取得":
      "load Logs",
    "native logs 取得":
      "load Logs",
    "native 重複 logs 削除":
      "delete duplicate Logs",
    "pull の再分類":
      "reclassify the pull",
    "pull の割り当て":
      "assign the pull",
    "pull 削除":
      "delete the pull",
    "secret 保存":
      "save the secret",
    "secret 削除":
      "delete the secret",
    "status 更新":
      "update the status",
    "お気に入り更新":
      "update the favorite",
    "アルバム作成":
      "create the album",
    "アルバム削除":
      "delete the album",
    "ウェイマーク作成":
      "create the waymark",
    "ウェイマーク削除":
      "delete the waymark",
    "ウェイマーク更新":
      "update the waymark",
    "カテゴリ作成":
      "create the content",
    "カテゴリ削除":
      "delete the content",
    "カテゴリ取得":
      "load the content",
    "カテゴリ更新":
      "update the content",
    "クリア日更新":
      "update the clear date",
    "クリア日確認":
      "check the clear date",
    "コメント更新":
      "update the comment",
    "スケジュールの確認":
      "check the schedule",
    "スケジュール一覧の保存":
      "save the schedule list",
    "スケジュール削除":
      "delete the schedule",
    "スケジュール取り込み":
      "import the schedule",
    "スケジュール名の更新":
      "rename the schedule",
    "スケジュール数の確認":
      "count the schedules",
    "スケジュール追加":
      "add the schedule",
    "ステータス更新":
      "update the status",
    "スナップショット保存":
      "save the snapshot",
    "タグ削除":
      "delete the tag",
    "タグ取得":
      "load the tags",
    "タグ追加":
      "add the tag",
    "チャンネル ID 保存":
      "save the channel ID",
    "チャンネル ID 削除":
      "delete the channel ID",
    "デフォルト時刻保存":
      "save the default time",
    "マクロ作成":
      "create the macro",
    "マクロ削除":
      "delete the macro",
    "マクロ更新":
      "update the macro",
    "メンテ日程保存":
      "save the maintenance schedule",
    "メンバー削除":
      "delete the member",
    "メンバー更新":
      "update the member",
    "メンバー追加":
      "add the member",
    "モード保存":
      "save the mode",
    "リンク並び替え":
      "reorder the links",
    "リンク作成":
      "create the link",
    "リンク削除":
      "delete the link",
    "リンク取得":
      "load the links",
    "リンク更新":
      "update the link",
    "ルールクリア":
      "clear the rule",
    "ルール保存":
      "save the rule",
    "並び替え":
      "reorder",
    "並び順計算":
      "compute the order",
    "予定の確認":
      "check the sessions",
    "候補日の一括追加":
      "add the candidate dates",
    "候補日削除":
      "delete the candidate date",
    "候補日追加":
      "add the candidate date",
    "備考更新":
      "update the note",
    "催促設定の保存":
      "save the reminder settings",
    "凡例保存":
      "save the legend",
    "凡例削除":
      "delete the legend",
    "出欠保存":
      "save the attendance",
    "出欠削除":
      "delete the attendance",
    "列名の保存":
      "save the column names",
    "動画 logs_url クリア":
      "clear the video's Logs URL",
    "動画オフセット保存":
      "save the video offset",
    "動画リンク削除":
      "delete the video link",
    "動画一覧取得":
      "load the videos",
    "動画検索":
      "search the videos",
    "動画行取得":
      "load the video",
    "募集文作成":
      "create the recruitment text",
    "募集文削除":
      "delete the recruitment text",
    "募集文更新":
      "update the recruitment text",
    "名前の変更":
      "rename",
    "定期枠の保存":
      "save the recurring slots",
    "層タブ保存":
      "save the floor tabs",
    "必要人数の保存":
      "save the required headcount",
    "採用中の切り替え":
      "switch the current one",
    "攻略リンク一覧取得":
      "load the strategy links",
    "新規画像追加":
      "add the new image",
    "既存候補日の確認":
      "check existing candidate dates",
    "既存画像削除":
      "delete the existing image",
    "既存画像取得":
      "load the existing images",
    "既読の保存":
      "save the read status",
    "既読の取り消し":
      "undo the read status",
    "日程の中止":
      "cancel the session",
    "時刻更新":
      "update the time",
    "有志練習の切替":
      "toggle the optional session",
    "消化ウィンドウ保存":
      "save the loot window",
    "消化チェック更新":
      "update the weekly check",
    "画像登録":
      "register the image",
    "画像追加":
      "add the image",
    "発見元 保存":
      "save the discovery source",
    "確定時自動通知 ON/OFF 保存":
      "save the auto-notify-on-confirm setting",
    "自動確定 ON/OFF 保存":
      "save the auto-confirm setting",
    "自動連動 ON/OFF 保存":
      "save the auto-sync setting",
    "表示スケジュールの切替":
      "switch the displayed schedule",
    "通知 ON/OFF 保存":
      "save the notification setting",
    "通知 template 保存":
      "save the notification template",
    "通知 template 削除":
      "delete the notification template",
    "通知時刻保存":
      "save the notification time",
    "通知時刻削除":
      "delete the notification time",
    "通知設定保存":
      "save the notification settings",
    "過去ログからの除外":
      "remove it from the past log",
    "過去予定 logs_url クリア":
      "clear the past session's Logs URL",
    "過去予定件数取得":
      "count the past sessions",
    "過去予定削除":
      "delete the past session",
    "過去予定登録":
      "register the past session",
    "重複 logs 削除":
      "delete duplicate Logs",
    "除外 URL 取得":
      "load the excluded URLs",
    "除外 URL 登録":
      "add the excluded URL",
    "除外 URL 解除":
      "remove the excluded URL",
    "除外の解除":
      "remove the exclusion",
    "除外登録":
      "add the exclusion",
    "除外解除":
      "remove the exclusion",
    "難易度設定の保存":
      "save the difficulty setting",
  },
};
