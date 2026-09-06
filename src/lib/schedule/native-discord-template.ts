/**
 * 2.1 (2026-05-12) PR3-A: native Discord 通知 message template の既定値。
 *
 * server-only な native-schedule-discord.ts と client-side の admin UI
 * (native-discord-notify-section.tsx) の両方で参照したいため、constants だけを
 * client-safe な location に分離する。
 *
 * 実際の message 生成 (placeholder 置換) は server-only な buildMessage() で行い、
 * 本ファイルは template 文字列の **形** のみを共有する。
 *
 * Placeholder 一覧:
 *   {mention}    : roleId 設定時 `<@&{roleId}> `、未設定時は空文字
 *   {date}       : `raw_date` (例 `2026/05/13(水) 21:00~23:00`)
 *   {day}        : `day_of_week` (例 `水`)
 *   {time_start} : 開始時刻 HH:MM (NULL なら default で COALESCE 済)
 *   {time_end}   : 終了時刻 HH:MM (NULL なら default で COALESCE 済)
 *   {note}       : session.note (空のとき空文字)
 *   {note_block} : note ありなら `📝 {note}\n`、なしなら空文字 (行ごと省略用)
 *   {attendance} : 出欠一覧 (改行を含む複数行ブロック)
 *   {site_url}   : `NEXT_PUBLIC_SITE_URL` (未設定なら空文字)
 *   {discord_time}     : Discord のタイムスタンプ `<t:unix:F>` (閲覧者の
 *                        タイムゾーンで「9月8日(火) 21:00」と描画。2026-09-06 W-14)
 *   {discord_relative} : 同 `<t:unix:R>` (「3 時間後」などの相対表記)。
 *                        日付が解釈できないときはどちらも空文字
 *   {discord_relative_block} : ` ({discord_relative})` — 相対表記を括弧付きで、
 *                        解釈できないときは行ごと空 (括弧だけ残らない。
 *                        {note_block} と同じ「有無で出現/省略」型)
 */
export const NATIVE_DISCORD_DEFAULT_TEMPLATE = [
  "{mention}本日の固定活動予定日です",
  "",
  "📅 {date} ({day})",
  "🕘 {time_start} 〜 {time_end}{discord_relative_block}",
  "{note_block}",
  "{attendance}",
  "",
  "{site_url}",
].join("\n");
