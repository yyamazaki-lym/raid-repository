/**
 * 出欠催促 (未入力者へのメンション) の `app_settings` キー定数
 * (2026-08-30、調査 第3回 D-3「デイコードの核心価値 = 締切リマインド」)。
 *
 * `settings-keys.ts` と同じ理由の純定数モジュール: server-only からも
 * "use client" からも安全に import できるよう plain TS に置く。
 *
 * 設計方針:
 * - **既定 OFF**。メンションは人に直接飛ぶ副作用なので、明示的に ON に
 *   するまで 1 通も送らない (ユーザー指定)。
 * - 送信先 (チャンネル) とメンション先 (表示名 → Discord ユーザー ID) は
 *   別概念。sync モードでは character-sheets の表示名しか無く Discord ID を
 *   持たないため、対応表を設定として持つ (native モードは
 *   `native_schedule_members.discord_user_id` を自動で使う)。
 * - 「常に未入力のメンバー」は除外リストに入れる (ユーザー指定)。除外者は
 *   集計にも出さない = 催促の対象外。
 */

/** 'true' / 'false'。既定 false (未設定 = OFF)。 */
export const REMINDER_ENABLED_KEY = "attendance_reminder_enabled";

/**
 * 投稿先チャンネル ID。空なら native スケジュール通知のチャンネル
 * (`native_schedule_discord_notify_channel_id`) を流用する。
 */
export const REMINDER_CHANNEL_KEY = "attendance_reminder_channel_id";

/** 何日前に送るか (0 = 当日、1 = 前日)。既定 1。 */
export const REMINDER_LEAD_DAYS_KEY = "attendance_reminder_lead_days";

/** 送信する目標時刻 (JST の hour, 0-23)。既定 21。 */
export const REMINDER_HOUR_KEY = "attendance_reminder_hour";

/**
 * 表示名 → Discord ユーザー ID の対応表 (JSON オブジェクト)。
 * 例: `{"makiton":"123456789012345678"}`
 * 未登録の名前はメンションせず、プレーンテキストの名前で並べる。
 */
export const REMINDER_MEMBER_MAP_KEY = "attendance_reminder_member_map";

/**
 * 催促対象から常に外す表示名の配列 (JSON)。
 * 「常に未入力のようなメンバー」を静かに落とすための設定 (ユーザー指定)。
 */
export const REMINDER_EXCLUDED_KEY = "attendance_reminder_excluded";

/**
 * 直近に催促を送ったセッションの rawDate。同じ開催日に二重送信しない
 * ための dedup。native 側の `last_notified_at` に相当するが、sync /
 * native の両モードで同じ仕組みが使えるよう app_settings に持つ。
 */
export const REMINDER_LAST_SENT_KEY = "attendance_reminder_last_sent_date";

/** 送信本文テンプレート (空なら既定フォーマット)。 */
export const REMINDER_TEMPLATE_KEY = "attendance_reminder_template";

export const REMINDER_DEFAULT_HOUR = 21;
export const REMINDER_DEFAULT_LEAD_DAYS = 1;

/**
 * 既定テンプレート。`{mentions}` は未入力者のメンション列、`{names}` は
 * 表示名だけの列、`{date}` `{day}` `{time_start}` `{time_end}` は対象日、
 * `{site_url}` は portal の URL。
 */
export const REMINDER_DEFAULT_TEMPLATE = `{mentions}
⏰ {date} ({day}) の出欠が未入力です

🕘 {time_start} 〜 {time_end}
{site_url}`;
